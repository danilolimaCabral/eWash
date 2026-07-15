import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { payments } from '../db/schema.js';
import { requirePolicy } from '../middleware.js';
import { uid, now, bad, notFound, audit, fmtMoney } from '../util.js';
import { loadOrderDetail, recomputePaymentStatus } from './orders.js';
import { sendNotification, renderTemplate } from '../notify.js';
import { assertBranchAccess } from '../branchAccess.js';

export const paymentRoutes = new Hono();

async function notifyReceipt(c, db, tenant, detail, amountCents) {
  const fresh = await loadOrderDetail(db, tenant.id, detail.id);
  await sendNotification(db, c.env, {
    tenantId: tenant.id, orderId: detail.id, templateKey: 'payment_received',
    toPhone: detail.customer.phone,
    message: renderTemplate(tenant, 'payment_received', {
      amount: fmtMoney(amountCents, tenant.currency),
      order_code: detail.code,
      balance: fmtMoney(fresh.balanceCents, tenant.currency),
    }),
  });
}

// Record a payment. Cash and manual M-Pesa codes complete immediately;
// an STK push stays `pending` until the Daraja callback lands. Partial
// payments (deposits) are first-class — spec §5.
paymentRoutes.post('/orders/:id/payments', requirePolicy('payments.receive'), async (c) => {
  const db = c.get('db');
  const tenant = c.get('tenant');
  const user = c.get('user');
  const body = await c.req.json();
  const method = body.method;
  if (!['cash', 'mpesa_stk', 'mpesa_manual'].includes(method)) bad('Invalid payment method');
  if (method === 'mpesa_stk') bad('M-Pesa STK push is coming soon. Use a manual M-Pesa code or cash.');
  const amount = Math.round(body.amount_cents || 0);
  if (!(amount > 0)) bad('Payment amount must be positive');
  const { checkMoney, cleanStr } = await import('../security.js');
  checkMoney(amount, 'Payment amount');
  body.mpesa_ref = cleanStr(body.mpesa_ref, 40, 'M-Pesa code');
  if (method === 'mpesa_manual' && !body.mpesa_ref) bad('M-Pesa transaction code is required');

  const detail = await loadOrderDetail(db, tenant.id, c.req.param('id'));
  if (!detail) notFound('Order not found');
  assertBranchAccess(c, detail.branchId);
  if (detail.status === 'void') bad('Cannot take payment on a void order');
  if (amount > detail.balanceCents) bad(`Amount exceeds balance (${fmtMoney(detail.balanceCents, tenant.currency)})`);

  const id = uid();
  const completesNow = method !== 'mpesa_stk';
  await db.insert(payments).values({
    id, tenantId: tenant.id, orderId: detail.id, method,
    amountCents: amount,
    mpesaRef: body.mpesa_ref || null,
    status: completesNow ? 'completed' : 'pending',
    receivedBy: user.id,
  });
  await recomputePaymentStatus(db, detail.id);

  if (completesNow) await notifyReceipt(c, db, tenant, detail, amount);

  await audit(db, tenant.id, user.id, 'payment.receive', 'payments', id, {
    order_code: detail.code, method, amount_cents: amount, status: completesNow ? 'completed' : 'pending',
  });
  return c.json(await loadOrderDetail(db, tenant.id, detail.id), 201);
});

// Shared settlement path for a pending STK payment — used by the real Daraja
// callback and the policy-guarded sandbox simulator. Idempotent (spec §11).
async function settleStkPayment(db, env, payment, { success, mpesaRef }) {
  if (payment.status !== 'pending') return { ok: true, idempotent: true, status: payment.status };
  await db.update(payments).set({
    status: success ? 'completed' : 'failed',
    mpesaRef: mpesaRef || payment.mpesaRef,
    at: now(),
  }).where(eq(payments.id, payment.id));
  await recomputePaymentStatus(db, payment.orderId);

  if (success) {
    const { tenants } = await import('../db/schema.js');
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, payment.tenantId));
    const detail = await loadOrderDetail(db, payment.tenantId, payment.orderId);
    await sendNotification(db, env, {
      tenantId: tenant.id, orderId: payment.orderId, templateKey: 'payment_received',
      toPhone: detail.customer.phone,
      message: renderTemplate(tenant, 'payment_received', {
        amount: fmtMoney(payment.amountCents, tenant.currency),
        order_code: detail.code,
        balance: fmtMoney(detail.balanceCents, tenant.currency),
      }),
    });
  }
  return { ok: true, status: success ? 'completed' : 'failed' };
}

// Daraja callback — mounted PUBLICLY (Safaricom calls it without our JWT) but
// gated by a shared-secret token in the URL: without it anyone on the internet
// could mark payments as paid. Register the result URL with Safaricom as
// /api/payments/mpesa/callback/<MPESA_CALLBACK_SECRET>.
export const mpesaCallbackRoute = new Hono();
mpesaCallbackRoute.post('/payments/mpesa/callback/:token', async (c) => {
  const { getDb } = await import('../db/index.js');
  const { safeEqual } = await import('../security.js');
  const { ApiError } = await import('../util.js');
  if (!c.env.MPESA_CALLBACK_SECRET || !safeEqual(c.req.param('token'), c.env.MPESA_CALLBACK_SECRET)) {
    throw new ApiError(403, 'Invalid callback credentials');
  }
  const body = await c.req.json();
  const db = getDb(c.env);
  const paymentId = body.payment_id || body.CheckoutRequestID;
  if (!paymentId) bad('payment_id is required');
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId));
  if (!payment) notFound('Payment not found');
  const success = body.success !== false && (body.ResultCode === undefined || body.ResultCode === 0);
  return c.json(await settleStkPayment(db, c.env, payment, {
    success,
    mpesaRef: body.mpesa_ref || body.MpesaReceiptNumber,
  }));
});

// Sandbox: simulate the customer entering their M-Pesa PIN. Authenticated,
// tenant-scoped and policy-guarded — unlike the real callback, this cannot be
// reached anonymously.
paymentRoutes.post('/payments/:id/simulate', requirePolicy('payments.receive'), async (c) => {
  const db = c.get('db');
  const tenant = c.get('tenant');
  const [payment] = await db.select().from(payments)
    .where(and(eq(payments.tenantId, tenant.id), eq(payments.id, c.req.param('id'))));
  if (!payment) notFound('Payment not found');
  if (payment.method !== 'mpesa_stk') bad('Only STK payments can be simulated');
  const detail = await loadOrderDetail(db, tenant.id, payment.orderId);
  if (!detail) notFound('Order not found');
  assertBranchAccess(c, detail.branchId);
  const result = await settleStkPayment(db, c.env, payment, {
    success: true,
    mpesaRef: 'SBX' + uid().slice(0, 8).toUpperCase(),
  });
  await audit(db, tenant.id, c.get('user').id, 'payment.simulate_callback', 'payments', payment.id, {
    amount_cents: payment.amountCents,
  });
  return c.json(result);
});

paymentRoutes.post('/payments/:id/refund', requirePolicy('payments.refund'), async (c) => {
  const db = c.get('db');
  const tenant = c.get('tenant');
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const [payment] = await db.select().from(payments)
    .where(and(eq(payments.tenantId, tenant.id), eq(payments.id, c.req.param('id'))));
  if (!payment) notFound('Payment not found');
  if (payment.status !== 'completed') bad('Only completed payments can be refunded');
  const detail = await loadOrderDetail(db, tenant.id, payment.orderId);
  if (!detail) notFound('Order not found');
  assertBranchAccess(c, detail.branchId);
  await db.update(payments).set({ status: 'refunded' }).where(eq(payments.id, payment.id));
  await recomputePaymentStatus(db, payment.orderId);
  await audit(db, tenant.id, user.id, 'payment.refund', 'payments', payment.id, {
    order_code: detail.code, amount_cents: payment.amountCents, reason: body.reason || null,
  });
  return c.json({ ok: true });
});
