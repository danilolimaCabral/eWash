import { Hono } from 'hono';
import { eq, and, desc, sql, isNull, like, ne, gte, lte } from 'drizzle-orm';
import {
  expenses, expenseCategories, serviceProviders, orders, payments, branches, customers,
  billingInvoices, billingInvoiceItems, billingPayments,
} from '../db/schema.js';
import { requirePolicy } from '../middleware.js';
import { uid, bad, notFound, today, monthOf, audit } from '../util.js';
import { checkMoney, cleanStr, validMonth, validDate, LIMITS } from '../security.js';
import { assertBranchAccess, scopedBranchId } from '../branchAccess.js';

export const financeRoutes = new Hono();

financeRoutes.get('/expense-categories', async (c) => {
  const rows = await c.get('db').select().from(expenseCategories)
    .where(eq(expenseCategories.tenantId, c.get('tenant').id));
  return c.json(rows);
});

financeRoutes.post('/expense-categories', requirePolicy('expenses.create'), async (c) => {
  const { name } = await c.req.json();
  if (!name?.trim()) bad('Category name is required');
  const db = c.get('db');
  const tenantId = c.get('tenant').id;
  const row = { id: uid(), tenantId, name: name.trim(), isDefault: 0 };
  await db.insert(expenseCategories).values(row);
  return c.json(row, 201);
});

financeRoutes.get('/expenses', requirePolicy('expenses.create'), async (c) => {
  const db = c.get('db');
  const tenantId = c.get('tenant').id;
  const scoped = scopedBranchId(c);
  const month = validMonth(c.req.query('month'), null);
  // optional specific date range (YYYY-MM-DD, inclusive) — dates are stored
  // as plain YYYY-MM-DD text so string comparison is correct
  const from = validDate(c.req.query('from'), null);
  const to = validDate(c.req.query('to'), null);
  const conds = [eq(expenses.tenantId, tenantId)];
  if (scoped) conds.push(eq(expenses.branchId, scoped));
  if (month) conds.push(like(expenses.expenseDate, `${month}%`));
  if (from) conds.push(gte(expenses.expenseDate, from));
  if (to) conds.push(lte(expenses.expenseDate, to));
  // standard opt-in pagination: with `offset` the response becomes
  // { rows, total, limit, offset }; without it the legacy plain array remains
  const paginated = c.req.query('offset') != null;
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10) || 20, 100);
  const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10) || 0);
  const query = db
    .select({
      id: expenses.id, amountCents: expenses.amountCents, paidVia: expenses.paidVia,
      expenseDate: expenses.expenseDate, recurring: expenses.recurring,
      recurringSourceId: expenses.recurringSourceId, note: expenses.note,
      branchId: expenses.branchId, categoryId: expenses.categoryId,
      providerId: expenses.providerId, status: expenses.status,
      categoryName: expenseCategories.name,
      providerName: serviceProviders.name,
    })
    .from(expenses)
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .leftJoin(serviceProviders, eq(serviceProviders.id, expenses.providerId))
    .where(and(...conds))
    .orderBy(desc(expenses.expenseDate), desc(expenses.createdAt));
  if (!paginated) return c.json(await query);
  const rows = await query.limit(limit).offset(offset);
  const [{ count }] = await db.select({ count: sql`count(*)` }).from(expenses).where(and(...conds));
  return c.json({ rows, total: Number(count || 0), limit, offset });
});

financeRoutes.post('/expenses', requirePolicy('expenses.create'), async (c) => {
  const b = await c.req.json();
  const db = c.get('db');
  const tenant = c.get('tenant');
  const user = c.get('user');
  const amount = Math.round(b.amount_cents || 0);
  if (!(amount > 0)) bad('Amount must be positive');
  checkMoney(amount, 'Expense amount');
  b.note = cleanStr(b.note, LIMITS.note, 'Note');
  if (b.expense_date) validDate(b.expense_date);
  const [cat] = await db.select().from(expenseCategories)
    .where(and(eq(expenseCategories.tenantId, tenant.id), eq(expenseCategories.id, b.category_id)));
  if (!cat) bad('Unknown expense category');
  const branchId = scopedBranchId(c, b.branch_id || user.branchId);
  const [branch] = await db.select().from(branches)
    .where(and(eq(branches.tenantId, tenant.id), eq(branches.id, branchId)));
  if (!branch) bad('Unknown branch');

  const row = {
    id: uid(), tenantId: tenant.id, branchId, categoryId: cat.id,
    providerId: b.provider_id || null,
    amountCents: amount,
    paidVia: b.paid_via === 'mpesa' ? 'mpesa' : 'cash',
    expenseDate: b.expense_date || today(),
    recurring: b.recurring ? 1 : 0,
    note: b.note || null,
    receiptUrl: b.receipt_url || null,
    recordedBy: user.id,
  };
  await db.insert(expenses).values(row);
  await audit(db, tenant.id, user.id, 'expense.create', 'expenses', row.id, {
    category: cat.name, amount_cents: amount, recurring: !!b.recurring,
  });
  return c.json(row, 201);
});

financeRoutes.put('/expenses/:id', requirePolicy('finance.manage'), async (c) => {
  const b = await c.req.json();
  const db = c.get('db');
  const tenant = c.get('tenant');
  const [existing] = await db.select().from(expenses)
    .where(and(eq(expenses.tenantId, tenant.id), eq(expenses.id, c.req.param('id'))));
  if (!existing) bad('Expense not found');
  assertBranchAccess(c, existing.branchId);
  if (existing.status === 'void') bad('Voided expenses cannot be edited');
  const amount = Math.round(b.amount_cents);
  checkMoney(amount, 'Expense amount');
  if (!(amount > 0)) bad('Amount must be positive');
  validDate(b.expense_date);
  const patch = {
    categoryId: b.category_id, providerId: b.provider_id || null, amountCents: amount,
    paidVia: b.paid_via === 'mpesa' ? 'mpesa' : 'cash',
    expenseDate: b.expense_date, note: cleanStr(b.note, LIMITS.note, 'Note') || null,
    updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
  };
  await db.update(expenses).set(patch).where(eq(expenses.id, existing.id));
  await audit(db, tenant.id, c.get('user').id, 'expense.update', 'expenses', existing.id, {
    before: existing, after: patch,
  });
  return c.json({ ok: true });
});

financeRoutes.post('/expenses/:id/void', requirePolicy('finance.manage'), async (c) => {
  const db = c.get('db');
  const tenant = c.get('tenant');
  const [existing] = await db.select().from(expenses)
    .where(and(eq(expenses.tenantId, tenant.id), eq(expenses.id, c.req.param('id'))));
  if (!existing) bad('Expense not found');
  assertBranchAccess(c, existing.branchId);
  await db.update(expenses).set({ status: 'void', updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' ') })
    .where(eq(expenses.id, existing.id));
  await audit(db, tenant.id, c.get('user').id, 'expense.void', 'expenses', existing.id, { amount_cents: existing.amountCents });
  return c.json({ ok: true });
});

financeRoutes.get('/service-providers', requirePolicy('finance.view'), async (c) => {
  const db = c.get('db');
  const tenantId = c.get('tenant').id;
  const paginated = c.req.query('offset') != null;
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10) || 20, 100);
  const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10) || 0);
  const query = db.select().from(serviceProviders)
    .where(eq(serviceProviders.tenantId, tenantId)).orderBy(desc(serviceProviders.createdAt));
  if (!paginated) return c.json(await query);
  const rows = await query.limit(limit).offset(offset);
  const [{ count }] = await db.select({ count: sql`count(*)` }).from(serviceProviders)
    .where(eq(serviceProviders.tenantId, tenantId));
  return c.json({ rows, total: Number(count || 0), limit, offset });
});

// Delivery riders for the order-handoff flow: staff advancing orders may not
// have finance access, so this exposes only active delivery-type providers
// (name + phone, nothing financial)
financeRoutes.get('/service-providers/delivery', requirePolicy('orders.advance'), async (c) => {
  const rows = await c.get('db').select({
    id: serviceProviders.id, name: serviceProviders.name, phone: serviceProviders.phone,
  }).from(serviceProviders)
    .where(and(eq(serviceProviders.tenantId, c.get('tenant').id), eq(serviceProviders.active, 1),
      sql`lower(${serviceProviders.serviceType}) like '%deliver%'`))
    .orderBy(serviceProviders.name);
  return c.json(rows);
});

financeRoutes.post('/service-providers', requirePolicy('finance.manage'), async (c) => {
  const b = await c.req.json();
  const tenantId = c.get('tenant').id;
  const name = cleanStr(b.name, LIMITS.name, 'Provider name');
  const serviceType = cleanStr(b.service_type, 80, 'Service type');
  if (!name || !serviceType) bad('Provider name and service type are required');
  const row = {
    id: uid(), tenantId, name, serviceType,
    phone: cleanStr(b.phone, LIMITS.phone, 'Phone'), email: cleanStr(b.email, LIMITS.email, 'Email'),
    notes: cleanStr(b.notes, LIMITS.note, 'Notes'), active: 1,
  };
  await c.get('db').insert(serviceProviders).values(row);
  await audit(c.get('db'), tenantId, c.get('user').id, 'provider.create', 'service_providers', row.id, { name, service_type: serviceType });
  return c.json(row, 201);
});

financeRoutes.put('/service-providers/:id', requirePolicy('finance.manage'), async (c) => {
  const b = await c.req.json();
  const db = c.get('db');
  const tenantId = c.get('tenant').id;
  const [existing] = await db.select().from(serviceProviders)
    .where(and(eq(serviceProviders.tenantId, tenantId), eq(serviceProviders.id, c.req.param('id'))));
  if (!existing) bad('Provider not found');
  const patch = {
    name: cleanStr(b.name, LIMITS.name, 'Provider name') || existing.name,
    serviceType: cleanStr(b.service_type, 80, 'Service type') || existing.serviceType,
    phone: cleanStr(b.phone, LIMITS.phone, 'Phone'), email: cleanStr(b.email, LIMITS.email, 'Email'),
    notes: cleanStr(b.notes, LIMITS.note, 'Notes'), active: b.active === false ? 0 : 1,
  };
  await db.update(serviceProviders).set(patch).where(eq(serviceProviders.id, existing.id));
  await audit(db, tenantId, c.get('user').id, 'provider.update', 'service_providers', existing.id, { before: existing, after: patch });
  return c.json({ ok: true });
});

// The business's own eWash subscription invoices (created by the platform).
// Read-only for tenants; drafts stay platform-internal until issued.
financeRoutes.get('/billing/invoices', requirePolicy('finance.view'), async (c) => {
  const db = c.get('db');
  const tenant = c.get('tenant');
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '10', 10) || 10, 1), 100);
  const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10) || 0);
  const status = c.req.query('status');
  const conds = [eq(billingInvoices.tenantId, tenant.id), ne(billingInvoices.status, 'draft')];
  if (status && ['issued', 'partially_paid', 'paid', 'overdue', 'void'].includes(status)) {
    conds.push(eq(billingInvoices.status, status));
  }
  const [rows, [{ count }]] = await Promise.all([
    db.select({
      id: billingInvoices.id, number: billingInvoices.number, status: billingInvoices.status,
      currency: billingInvoices.currency, periodStart: billingInvoices.periodStart,
      periodEnd: billingInvoices.periodEnd, issuedAt: billingInvoices.issuedAt,
      dueAt: billingInvoices.dueAt, createdAt: billingInvoices.createdAt,
      totalCents: billingInvoices.totalCents,
      paidCents: sql`coalesce((select sum(p.amount_cents) from billing_payments p where p.invoice_id = ${billingInvoices}.id and p.status = 'completed'), 0)`,
    }).from(billingInvoices).where(and(...conds))
      .orderBy(desc(billingInvoices.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql`count(*)` }).from(billingInvoices).where(and(...conds)),
  ]);
  return c.json({ rows, total: Number(count || 0), limit, offset });
});

financeRoutes.get('/billing/invoices/:id', requirePolicy('finance.view'), async (c) => {
  const db = c.get('db');
  const tenant = c.get('tenant');
  const [invoice] = await db.select().from(billingInvoices).where(and(
    eq(billingInvoices.id, c.req.param('id')),
    eq(billingInvoices.tenantId, tenant.id),
    ne(billingInvoices.status, 'draft'),
  ));
  if (!invoice) notFound('Invoice not found');
  const [items, paymentRows] = await Promise.all([
    db.select().from(billingInvoiceItems).where(eq(billingInvoiceItems.invoiceId, invoice.id)),
    db.select({
      id: billingPayments.id, amountCents: billingPayments.amountCents,
      method: billingPayments.method, reference: billingPayments.reference, paidAt: billingPayments.paidAt,
    }).from(billingPayments)
      .where(and(eq(billingPayments.invoiceId, invoice.id), eq(billingPayments.status, 'completed')))
      .orderBy(desc(billingPayments.paidAt)),
  ]);
  const paidCents = paymentRows.reduce((sum, p) => sum + p.amountCents, 0);
  return c.json({ invoice: { ...invoice, paidCents }, items, payments: paymentRows });
});

financeRoutes.get('/credit-ledger', requirePolicy('finance.view'), async (c) => {
  const db = c.get('db');
  const tenantId = c.get('tenant').id;
  const scoped = scopedBranchId(c);
  const paginated = c.req.query('offset') != null;
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10) || 20, 100);
  const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10) || 0);
  const conds = [eq(orders.tenantId, tenantId), eq(orders.status, 'delivered'),
    sql`${orders.creditDueAt} is not null`,
    ...(scoped ? [eq(orders.branchId, scoped)] : [])];
  // paginated callers get only what is still owed — settled credit rows would
  // make page totals meaningless
  if (paginated) {
    conds.push(sql`${orders.totalCents} > coalesce((select sum(p.amount_cents) from payments p where p.order_id = ${orders.id} and p.status = 'completed'), 0)`);
  }
  const query = db.select({
    orderId: orders.id, code: orders.code, customerId: customers.id, customerName: customers.name,
    customerPhone: customers.phone, totalCents: orders.totalCents, creditDueAt: orders.creditDueAt,
    closedAt: orders.closedAt,
    paidCents: sql`coalesce((select sum(p.amount_cents) from payments p where p.order_id = ${orders.id} and p.status = 'completed'), 0)`,
  }).from(orders).innerJoin(customers, eq(customers.id, orders.customerId))
    .where(and(...conds))
    .orderBy(desc(orders.closedAt));
  if (!paginated) return c.json(await query);
  const rows = await query.limit(limit).offset(offset);
  const [{ count }] = await db.select({ count: sql`count(*)` }).from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId)).where(and(...conds));
  return c.json({ rows, total: Number(count || 0), limit, offset });
});

// Recurring expenses auto-post on view of the current month (and via cron):
// each recurring "source" entry gets one copy per month, flagged so the UI can
// show the nudge. Idempotent.
export async function postDueRecurring(db, tenantId, userIdForAudit = null) {
  const month = monthOf();
  const sources = await db.select().from(expenses)
    .where(and(eq(expenses.tenantId, tenantId), eq(expenses.recurring, 1), isNull(expenses.recurringSourceId)));
  const posted = [];
  for (const s of sources) {
    if (s.expenseDate.startsWith(month)) continue; // source itself is this month
    const [already] = await db.select({ id: expenses.id }).from(expenses)
      .where(and(eq(expenses.recurringSourceId, s.id), like(expenses.expenseDate, `${month}%`)));
    if (already) continue;
    const day = s.expenseDate.slice(8, 10);
    const row = {
      id: uid(), tenantId, branchId: s.branchId, categoryId: s.categoryId,
      amountCents: s.amountCents, paidVia: s.paidVia,
      expenseDate: `${month}-${day}` <= today() ? `${month}-${day}` : today(),
      recurring: 0, recurringSourceId: s.id,
      note: `${s.note ? s.note + ' ' : ''}(auto-posted monthly)`,
      recordedBy: userIdForAudit || s.recordedBy,
    };
    await db.insert(expenses).values(row);
    posted.push(row);
  }
  return posted;
}

// The whole P&L (spec §9.3): gross revenue from CLOSED orders − discounts &
// refunds = net revenue; − expenses by category = operating profit. Plus
// billed-vs-collected so revenue and cash never get confused.
// Monthly financial-health trend for the overview chart: money earned (net),
// money spent and profit per month, same definitions as /finance/pl
financeRoutes.get('/finance/trend', requirePolicy('finance.view'), async (c) => {
  const db = c.get('db');
  const tenant = c.get('tenant');
  const branchId = scopedBranchId(c, c.req.query('branch_id') || null);
  const span = Math.min(Math.max(parseInt(c.req.query('months') || '6', 10) || 6, 2), 12);
  const nowMonth = monthOf();
  const [ny, nm] = nowMonth.split('-').map(Number);
  const list = [];
  for (let i = span - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(ny, nm - 1 - i, 1));
    list.push(d.toISOString().slice(0, 7));
  }
  const start = list[0];

  const [revRows, refRows, expRows] = await db.batch([
    db.select({
      m: sql`substr(${orders.closedAt}, 1, 7)`.as('m'),
      gross: sql`coalesce(sum(${orders.subtotalCents} + ${orders.expressCents}), 0)`,
      discounts: sql`coalesce(sum(${orders.discountCents}), 0)`,
    }).from(orders).where(and(
      eq(orders.tenantId, tenant.id), eq(orders.status, 'delivered'),
      sql`substr(${orders.closedAt}, 1, 7) >= ${start}`,
      ...(branchId ? [eq(orders.branchId, branchId)] : []),
    )).groupBy(sql`m`),
    db.select({
      m: sql`substr(${payments.at}, 1, 7)`.as('m'),
      refunds: sql`coalesce(sum(${payments.amountCents}), 0)`,
    }).from(payments).where(and(
      eq(payments.tenantId, tenant.id), eq(payments.status, 'refunded'),
      sql`substr(${payments.at}, 1, 7) >= ${start}`,
    )).groupBy(sql`m`),
    db.select({
      m: sql`substr(${expenses.expenseDate}, 1, 7)`.as('m'),
      spent: sql`coalesce(sum(${expenses.amountCents}), 0)`,
    }).from(expenses).where(and(
      eq(expenses.tenantId, tenant.id), eq(expenses.status, 'active'),
      gte(expenses.expenseDate, `${start}-01`),
      ...(branchId ? [eq(expenses.branchId, branchId)] : []),
    )).groupBy(sql`m`),
  ]);

  const refMap = Object.fromEntries(refRows.map((r) => [r.m, Number(r.refunds)]));
  const expMap = Object.fromEntries(expRows.map((r) => [r.m, Number(r.spent)]));
  const points = list.map((m) => {
    const rev = revRows.find((r) => r.m === m);
    const earned = (rev ? Number(rev.gross) - Number(rev.discounts) : 0) - (refMap[m] || 0);
    const spent = expMap[m] || 0;
    return { month: m, earnedCents: earned, spentCents: spent, profitCents: earned - spent };
  });
  return c.json({ months: points });
});

financeRoutes.get('/finance/pl', requirePolicy('finance.view'), async (c) => {
  const db = c.get('db');
  const tenant = c.get('tenant');
  const month = validMonth(c.req.query('month'), monthOf());
  const branchId = scopedBranchId(c, c.req.query('branch_id') || null);

  const autoPosted = month === monthOf() ? await postDueRecurring(db, tenant.id, c.get('user').id) : [];

  const monthPl = async (m) => {
    const orderConds = [
      eq(orders.tenantId, tenant.id),
      eq(orders.status, 'delivered'),
      sql`substr(${orders.closedAt}, 1, 7) = ${m}`,
    ];
    if (branchId) orderConds.push(eq(orders.branchId, branchId));
    const expConds = [eq(expenses.tenantId, tenant.id), eq(expenses.status, 'active'), like(expenses.expenseDate, `${m}%`)];
    if (branchId) expConds.push(eq(expenses.branchId, branchId));

    // one D1 round trip per month
    const [[rev], [ref], [col], expByCat] = await db.batch([
      db.select({
        gross: sql`coalesce(sum(${orders.subtotalCents} + ${orders.expressCents}), 0)`,
        discounts: sql`coalesce(sum(${orders.discountCents}), 0)`,
        billed: sql`coalesce(sum(${orders.totalCents}), 0)`,
        count: sql`count(*)`,
        rewash: sql`coalesce(sum(case when ${orders.rewashOfOrderId} is not null then 1 else 0 end), 0)`,
      }).from(orders).where(and(...orderConds)),
      db.select({
        refunds: sql`coalesce(sum(${payments.amountCents}), 0)`,
      }).from(payments).where(and(
        eq(payments.tenantId, tenant.id),
        eq(payments.status, 'refunded'),
        sql`substr(${payments.at}, 1, 7) = ${m}`,
      )),
      // collected against closed orders (cash-flow view)
      db.select({
        collected: sql`coalesce(sum(${payments.amountCents}), 0)`,
      }).from(payments)
        .innerJoin(orders, eq(orders.id, payments.orderId))
        .where(and(
          eq(payments.tenantId, tenant.id),
          eq(payments.status, 'completed'),
          eq(orders.status, 'delivered'),
          sql`substr(${orders.closedAt}, 1, 7) = ${m}`,
          ...(branchId ? [eq(orders.branchId, branchId)] : []),
        )),
      db.select({
        category: expenseCategories.name,
        total: sql`sum(${expenses.amountCents})`,
      }).from(expenses)
        .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
        .where(and(...expConds))
        .groupBy(expenseCategories.name),
    ]);

    const grossCents = rev.gross;
    const discountsCents = rev.discounts;
    const refundsCents = ref.refunds;
    const netCents = grossCents - discountsCents - refundsCents;
    const expensesCents = expByCat.reduce((t, e) => t + e.total, 0);
    return {
      month: m,
      grossCents, discountsCents, refundsCents, netCents,
      expensesByCategory: expByCat.map((e) => ({ category: e.category, amountCents: e.total })),
      expensesCents,
      profitCents: netCents - expensesCents,
      marginPct: netCents > 0 ? Math.round(((netCents - expensesCents) / netCents) * 100) : 0,
      closedOrders: rev.count,
      rewashCount: rev.rewash,
      billedCents: rev.billed,
      collectedCents: col.collected,
      receivablesCents: Math.max(0, rev.billed - col.collected),
    };
  };

  const current = await monthPl(month);
  const [y, m] = month.split('-').map(Number);
  const prevMonth = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`;
  const previous = await monthPl(prevMonth);
  return c.json({ ...current, previous, autoPostedRecurring: autoPosted.length });
});
