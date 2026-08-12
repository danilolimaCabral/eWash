// LavTr data model (Drizzle ORM, SQLite/D1).
// Every row is tenant-scoped directly or through its parent. Money is integer cents.
// Order price fields on order_items / order_item_addons are snapshots taken at
// order creation — later catalog edits never mutate existing orders.
import { sqliteTable, text, integer, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const id = () => text('id').primaryKey();
const createdAt = () => text('created_at').notNull().default(sql`(datetime('now'))`);

export const tenants = sqliteTable('tenants', {
  id: id(),
  name: text('name').notNull(),
  plan: text('plan').notNull().default('starter'),
  currency: text('currency').notNull().default('BRL'),
  status: text('status').notNull().default('active'),
  billingEmail: text('billing_email'),
  trialEndsAt: text('trial_ends_at'),
  graceEndsAt: text('grace_ends_at'),
  suspendedAt: text('suspended_at'),
  cancelledAt: text('cancelled_at'),
  cancellationReason: text('cancellation_reason'),
  codePrefix: text('code_prefix').notNull().default('LV'),
  orderSeq: integer('order_seq').notNull().default(100),
  settings: text('settings').notNull().default('{}'),
  createdAt: createdAt(),
});

export const branches = sqliteTable('branches', {
  id: id(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  location: text('location'),
  active: integer('active').notNull().default(1),
  createdAt: createdAt(),
}, (t) => [index('idx_branches_tenant').on(t.tenantId)]);

export const roles = sqliteTable('roles', {
  id: id(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  isSystem: integer('is_system').notNull().default(0),
}, (t) => [index('idx_roles_tenant').on(t.tenantId)]);

export const rolePolicies = sqliteTable('role_policies', {
  id: id(),
  roleId: text('role_id').notNull().references(() => roles.id),
  policyKey: text('policy_key').notNull(),
  allow: integer('allow').notNull().default(1),
}, (t) => [uniqueIndex('uq_role_policy').on(t.roleId, t.policyKey)]);

export const users = sqliteTable('users', {
  id: id(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  branchId: text('branch_id').references(() => branches.id),
  roleId: text('role_id').notNull().references(() => roles.id),
  accessScope: text('access_scope', { enum: ['tenant', 'branch'] }).notNull().default('branch'),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email').notNull().unique(),
  // Google-only accounts carry the sentinel 'google-only' (never verifiable)
  passwordHash: text('password_hash').notNull(),
  googleSub: text('google_sub').unique(), // Google account id when linked
  status: text('status').notNull().default('active'),
  createdAt: createdAt(),
}, (t) => [index('idx_users_tenant').on(t.tenantId)]);

export const userPolicyOverrides = sqliteTable('user_policy_overrides', {
  id: id(),
  userId: text('user_id').notNull().references(() => users.id),
  policyKey: text('policy_key').notNull(),
  effect: text('effect', { enum: ['grant', 'deny'] }).notNull(),
}, (t) => [uniqueIndex('uq_user_policy').on(t.userId, t.policyKey)]);

export const customers = sqliteTable('customers', {
  id: id(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  phone: text('phone').notNull(),
  notes: text('notes'),
  creditEnabled: integer('credit_enabled').notNull().default(0),
  creditLimitCents: integer('credit_limit_cents').notNull().default(0),
  creditTermsDays: integer('credit_terms_days').notNull().default(30),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('uq_customer_phone').on(t.tenantId, t.phone),
  index('idx_customers_tenant').on(t.tenantId),
]);

export const serviceCategories = sqliteTable('service_categories', {
  id: id(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [index('idx_svc_cat_tenant').on(t.tenantId)]);

export const services = sqliteTable('services', {
  id: id(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  categoryId: text('category_id').notNull().references(() => serviceCategories.id),
  name: text('name').notNull(),
  pricingModel: text('pricing_model', { enum: ['PER_KG', 'PER_ITEM', 'FLAT', 'TIERED'] }).notNull(),
  baseRateCents: integer('base_rate_cents').notNull().default(0),
  minChargeCents: integer('min_charge_cents').notNull().default(0),
  expressPct: integer('express_pct').notNull().default(50),
  unit: text('unit', { enum: ['kg', 'item', 'flat'] }).notNull().default('kg'),
  active: integer('active').notNull().default(1),
  createdAt: createdAt(),
}, (t) => [index('idx_services_tenant').on(t.tenantId)]);

export const serviceVariants = sqliteTable('service_variants', {
  id: id(),
  serviceId: text('service_id').notNull().references(() => services.id),
  attribute: text('attribute').notNull().default('size'),
  label: text('label').notNull(),
  priceCents: integer('price_cents').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [index('idx_variants_service').on(t.serviceId)]);

export const pricingTiers = sqliteTable('pricing_tiers', {
  id: id(),
  serviceId: text('service_id').notNull().references(() => services.id),
  minQty: real('min_qty').notNull(),
  maxQty: real('max_qty'), // NULL = open-ended
  rateCents: integer('rate_cents'), // per-unit rate within the band (PER_KG tier breaks)
  bandPriceCents: integer('band_price_cents'), // flat price for the whole band (TIERED)
}, (t) => [index('idx_tiers_service').on(t.serviceId)]);

export const addonRules = sqliteTable('addon_rules', {
  id: id(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  parentServiceId: text('parent_service_id').notNull().references(() => services.id),
  addonServiceId: text('addon_service_id').notNull().references(() => services.id),
  overrideRateCents: integer('override_rate_cents'), // NULL = addon's standalone rate
  inheritQty: integer('inherit_qty').notNull().default(0),
}, (t) => [uniqueIndex('uq_addon_rule').on(t.parentServiceId, t.addonServiceId)]);

export const orders = sqliteTable('orders', {
  id: id(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  branchId: text('branch_id').notNull().references(() => branches.id),
  customerId: text('customer_id').notNull().references(() => customers.id),
  code: text('code').notNull(),
  status: text('status', { enum: ['received', 'washing', 'ironing', 'ready', 'delivered', 'void'] })
    .notNull().default('received'),
  paymentStatus: text('payment_status', { enum: ['unpaid', 'partially_paid', 'paid', 'refunded'] })
    .notNull().default('unpaid'),
  express: integer('express').notNull().default(0),
  subtotalCents: integer('subtotal_cents').notNull().default(0),
  expressCents: integer('express_cents').notNull().default(0),
  discountCents: integer('discount_cents').notNull().default(0),
  totalCents: integer('total_cents').notNull().default(0),
  notes: text('notes'),
  rewashOfOrderId: text('rewash_of_order_id'),
  confirmedAt: text('confirmed_at'),
  closedAt: text('closed_at'),
  handoffType: text('handoff_type', { enum: ['pickup', 'delivery'] }),
  collectedByName: text('collected_by_name'),
  collectedAt: text('collected_at'),
  creditDueAt: text('credit_due_at'),
  historical: integer('historical').notNull().default(0),
  dueAt: text('due_at'),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('uq_order_code').on(t.tenantId, t.code),
  index('idx_orders_status').on(t.tenantId, t.status),
  index('idx_orders_closed').on(t.tenantId, t.closedAt),
]);

export const orderItems = sqliteTable('order_items', {
  id: id(),
  orderId: text('order_id').notNull().references(() => orders.id),
  serviceId: text('service_id').notNull().references(() => services.id),
  variantId: text('variant_id').references(() => serviceVariants.id),
  serviceName: text('service_name').notNull(), // snapshot
  variantLabel: text('variant_label'), // snapshot
  qty: real('qty').notNull(),
  unit: text('unit').notNull(),
  unitPriceCents: integer('unit_price_cents').notNull(), // snapshot
  minApplied: integer('min_applied').notNull().default(0),
  lineTotalCents: integer('line_total_cents').notNull(), // snapshot
}, (t) => [
  index('idx_items_order').on(t.orderId),
  index('idx_items_service').on(t.serviceId), // revenue-by-category joins
]);

export const orderItemAddons = sqliteTable('order_item_addons', {
  id: id(),
  orderItemId: text('order_item_id').notNull().references(() => orderItems.id),
  addonServiceId: text('addon_service_id').notNull().references(() => services.id),
  addonName: text('addon_name').notNull(), // snapshot
  qty: real('qty').notNull(),
  qtyInherited: integer('qty_inherited').notNull().default(0),
  unit: text('unit').notNull(),
  unitPriceCents: integer('unit_price_cents').notNull(), // snapshot
  totalCents: integer('total_cents').notNull(), // snapshot
}, (t) => [
  index('idx_addons_item').on(t.orderItemId),
  index('idx_addons_service').on(t.addonServiceId), // rider revenue joins
]);

export const itemTags = sqliteTable('item_tags', {
  id: id(),
  orderItemId: text('order_item_id').notNull().references(() => orderItems.id),
  tagCode: text('tag_code').notNull().unique(),
  status: text('status').notNull().default('attached'),
});

export const orderStatusHistory = sqliteTable('order_status_history', {
  id: id(),
  orderId: text('order_id').notNull().references(() => orders.id),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  userId: text('user_id').notNull().references(() => users.id),
  at: text('at').notNull().default(sql`(datetime('now'))`),
}, (t) => [index('idx_hist_order').on(t.orderId)]);

export const payments = sqliteTable('payments', {
  id: id(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  orderId: text('order_id').notNull().references(() => orders.id),
  method: text('method', { enum: ['pix', 'pix_manual', 'card', 'cash'] }).notNull(),
  amountCents: integer('amount_cents').notNull(),
  pixRef: text('pix_ref'),
  status: text('status', { enum: ['pending', 'completed', 'failed', 'refunded'] }).notNull().default('pending'),
  receivedBy: text('received_by').notNull().references(() => users.id),
  at: text('at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_payments_order').on(t.orderId),
  index('idx_payments_tenant').on(t.tenantId, t.at),
]);

export const notifications = sqliteTable('notifications', {
  id: id(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  orderId: text('order_id').references(() => orders.id),
  channel: text('channel').notNull().default('sms'),
  templateKey: text('template_key').notNull(),
  toPhone: text('to_phone').notNull(),
  message: text('message').notNull(),
  status: text('status').notNull().default('queued'),
  sentAt: text('sent_at'),
}, (t) => [
  index('idx_notif_tenant').on(t.tenantId),
  index('idx_notif_order').on(t.orderId), // per-order notification lookups
]);

export const auditLog = sqliteTable('audit_log', {
  id: id(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  userId: text('user_id').notNull().references(() => users.id),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  payload: text('payload'),
  at: text('at').notNull().default(sql`(datetime('now'))`),
}, (t) => [index('idx_audit_tenant').on(t.tenantId, t.at)]);

export const expenseCategories = sqliteTable('expense_categories', {
  id: id(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  isDefault: integer('is_default').notNull().default(0),
}, (t) => [index('idx_excat_tenant').on(t.tenantId)]);

// Server-side sessions: access JWTs are short-lived and carry a session id;
// the opaque refresh token is stored hashed and rotates on every refresh
// (reuse of an old token revokes the whole session). last_seen_at heartbeats
// power online/offline presence across the platform.
export const sessions = sqliteTable('sessions', {
  id: id(),
  userId: text('user_id').notNull().references(() => users.id),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  refreshTokenHash: text('refresh_token_hash').notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: createdAt(),
  lastSeenAt: text('last_seen_at').notNull().default(sql`(datetime('now'))`),
  expiresAt: text('expires_at').notNull(),
  revokedAt: text('revoked_at'),
}, (t) => [
  index('idx_sessions_user').on(t.userId),
  index('idx_sessions_tenant').on(t.tenantId),
]);

// Fixed-window rate limiting for hostile-traffic endpoints (auth). D1-backed
// so limits hold across isolates, unlike in-memory counters.
export const rateLimits = sqliteTable('rate_limits', {
  key: text('key').primaryKey(), // e.g. "login:ip:1.2.3.4" or "login:email:x@y.z"
  windowStart: integer('window_start').notNull(), // epoch seconds
  count: integer('count').notNull().default(0),
});

export const passwordResetTokens = sqliteTable('password_reset_tokens', {
  id: id(),
  userId: text('user_id').notNull().references(() => users.id),
  tokenHash: text('token_hash').notNull().unique(),
  // one-time emailed tokens share this table; purpose keeps them unswappable
  purpose: text('purpose', { enum: ['password_reset', 'activation', 'invite'] }).notNull().default('password_reset'),
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at'),
  requestedIp: text('requested_ip'),
  createdAt: createdAt(),
}, (t) => [
  index('idx_password_reset_user').on(t.userId),
  index('idx_password_reset_expiry').on(t.expiresAt),
]);

export const serviceProviders = sqliteTable('service_providers', {
  id: id(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  serviceType: text('service_type').notNull(),
  phone: text('phone'),
  email: text('email'),
  notes: text('notes'),
  active: integer('active').notNull().default(1),
  createdAt: createdAt(),
}, (t) => [index('idx_providers_tenant').on(t.tenantId)]);

export const expenses = sqliteTable('expenses', {
  id: id(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  branchId: text('branch_id').notNull().references(() => branches.id),
  categoryId: text('category_id').notNull().references(() => expenseCategories.id),
  providerId: text('provider_id').references(() => serviceProviders.id),
  amountCents: integer('amount_cents').notNull(),
  paidVia: text('paid_via', { enum: ['cash', 'pix', 'card'] }).notNull().default('cash'),
  expenseDate: text('expense_date').notNull(),
  recurring: integer('recurring').notNull().default(0),
  recurringSourceId: text('recurring_source_id'), // set on auto-posted copies
  note: text('note'),
  receiptUrl: text('receipt_url'),
  recordedBy: text('recorded_by').notNull().references(() => users.id),
  status: text('status', { enum: ['active', 'void'] }).notNull().default('active'),
  updatedAt: text('updated_at'),
  createdAt: createdAt(),
}, (t) => [index('idx_expenses_tenant').on(t.tenantId, t.expenseDate)]);

// Platform control-plane records are deliberately separate from tenant users
// and sessions. Cross-tenant access is only available through platform routes.
export const platformUsers = sqliteTable('platform_users', {
  id: id(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['platform_owner', 'platform_admin', 'platform_billing'] }).notNull(),
  status: text('status', { enum: ['active', 'disabled'] }).notNull().default('active'),
  createdAt: createdAt(),
});

export const platformSessions = sqliteTable('platform_sessions', {
  id: id(),
  userId: text('user_id').notNull().references(() => platformUsers.id),
  refreshTokenHash: text('refresh_token_hash').notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: createdAt(),
  lastSeenAt: text('last_seen_at').notNull().default(sql`(datetime('now'))`),
  expiresAt: text('expires_at').notNull(),
  revokedAt: text('revoked_at'),
}, (t) => [index('idx_platform_sessions_user').on(t.userId)]);

export const platformAuditLog = sqliteTable('platform_audit_log', {
  id: id(),
  platformUserId: text('platform_user_id').notNull().references(() => platformUsers.id),
  tenantId: text('tenant_id').references(() => tenants.id),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  reason: text('reason'),
  payload: text('payload'),
  at: text('at').notNull().default(sql`(datetime('now'))`),
}, (t) => [index('idx_platform_audit_at').on(t.at)]);

export const plans = sqliteTable('plans', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  interval: text('interval', { enum: ['monthly'] }).notNull().default('monthly'),
  priceCents: integer('price_cents').notNull().default(0),
  currency: text('currency').notNull().default('BRL'),
  trialDays: integer('trial_days').notNull().default(14),
  active: integer('active').notNull().default(1),
  features: text('features').notNull().default('{}'),
  createdAt: createdAt(),
});

// Per-term monthly rates: the price/month a tenant pays when committing to
// termMonths upfront (longer terms cheaper). Edits only affect invoices
// generated after the change — issued invoices are snapshots.
export const planPrices = sqliteTable('plan_prices', {
  id: id(),
  planId: text('plan_id').notNull().references(() => plans.id),
  termMonths: integer('term_months').notNull(),
  priceCents: integer('price_cents').notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('uq_plan_price_term').on(t.planId, t.termMonths)]);

export const tenantSubscriptions = sqliteTable('tenant_subscriptions', {
  id: id(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  planId: text('plan_id').notNull().references(() => plans.id),
  status: text('status', { enum: ['trial', 'active', 'past_due', 'suspended', 'cancelled'] }).notNull().default('trial'),
  termMonths: integer('term_months').notNull().default(1),
  customPriceCents: integer('custom_price_cents'), // per-month override
  startedAt: text('started_at').notNull().default(sql`(datetime('now'))`),
  currentPeriodStart: text('current_period_start'),
  currentPeriodEnd: text('current_period_end'),
  cancelAtPeriodEnd: integer('cancel_at_period_end').notNull().default(0),
  endedAt: text('ended_at'),
  createdAt: createdAt(),
}, (t) => [
  index('idx_subscriptions_tenant').on(t.tenantId),
  index('idx_subscriptions_status').on(t.status),
]);

export const billingInvoices = sqliteTable('billing_invoices', {
  id: id(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  subscriptionId: text('subscription_id').references(() => tenantSubscriptions.id),
  number: text('number').notNull().unique(),
  status: text('status', { enum: ['draft', 'issued', 'partially_paid', 'paid', 'void', 'overdue'] }).notNull().default('draft'),
  currency: text('currency').notNull().default('BRL'),
  periodStart: text('period_start'),
  periodEnd: text('period_end'),
  issuedAt: text('issued_at'),
  dueAt: text('due_at'),
  subtotalCents: integer('subtotal_cents').notNull().default(0),
  taxCents: integer('tax_cents').notNull().default(0),
  totalCents: integer('total_cents').notNull().default(0),
  notes: text('notes'),
  createdBy: text('created_by').notNull().references(() => platformUsers.id),
  createdAt: createdAt(),
}, (t) => [
  index('idx_billing_invoices_tenant').on(t.tenantId),
  index('idx_billing_invoices_status').on(t.status, t.dueAt),
]);

export const billingInvoiceItems = sqliteTable('billing_invoice_items', {
  id: id(),
  invoiceId: text('invoice_id').notNull().references(() => billingInvoices.id),
  description: text('description').notNull(),
  quantity: integer('quantity').notNull().default(1),
  unitAmountCents: integer('unit_amount_cents').notNull(),
  lineTotalCents: integer('line_total_cents').notNull(),
}, (t) => [index('idx_billing_items_invoice').on(t.invoiceId)]);

export const billingPayments = sqliteTable('billing_payments', {
  id: id(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  invoiceId: text('invoice_id').notNull().references(() => billingInvoices.id),
  amountCents: integer('amount_cents').notNull(),
  method: text('method', { enum: ['cash', 'bank', 'pix_manual'] }).notNull(),
  reference: text('reference'),
  paidAt: text('paid_at').notNull(),
  recordedBy: text('recorded_by').notNull().references(() => platformUsers.id),
  status: text('status', { enum: ['completed', 'void'] }).notNull().default('completed'),
  createdAt: createdAt(),
}, (t) => [
  index('idx_billing_payments_invoice').on(t.invoiceId),
  index('idx_billing_payments_tenant').on(t.tenantId, t.paidAt),
]);
