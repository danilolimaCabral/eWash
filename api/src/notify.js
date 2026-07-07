// Notifications: rendered from tenant-editable templates with merge fields,
// recorded in the notifications table, and dispatched via a provider stub.
// Swap `dispatch` for Africa's Talking / WhatsApp Business API in production —
// the rest of the system only talks to `sendNotification`.
import { uid, now, fmtMoney } from './util.js';
import { notifications } from './db/schema.js';

export const DEFAULT_TEMPLATES = {
  quote_ready:
    'eWash: Hello {customer}, order {order_code} assessed: {items}. Total {total}. Reply YES to confirm — pay by M-Pesa or cash when you pick up. Karibu!',
  payment_received:
    'eWash: Payment of {amount} received for order {order_code}. Balance: {balance}. Asante!',
  order_ready:
    'eWash: Hello {customer}, your order {order_code} is ready for pickup. {balance_note}Karibu!',
  order_delivered:
    'eWash: Order {order_code} delivered/collected. Thank you for choosing us, {customer}!',
  payment_reminder:
    'eWash: Friendly reminder — order {order_code} is ready and has a balance of {balance}. Pay via M-Pesa to collect. Asante!',
};

export function renderTemplate(tenantSettings, key, fields) {
  const templates = { ...DEFAULT_TEMPLATES, ...(tenantSettings?.templates || {}) };
  let msg = templates[key] || DEFAULT_TEMPLATES[key] || '';
  for (const [k, v] of Object.entries(fields)) msg = msg.replaceAll(`{${k}}`, String(v));
  return msg;
}

// Provider stub: in development every message "sends" instantly and is fully
// inspectable via GET /api/notifications.
async function dispatch(_env, _channel, _phone, _message) {
  return { ok: true };
}

export async function sendNotification(db, env, { tenantId, orderId = null, channel = 'sms', templateKey, toPhone, message }) {
  const id = uid();
  const result = await dispatch(env, channel, toPhone, message);
  await db.insert(notifications).values({
    id, tenantId, orderId, channel, templateKey, toPhone, message,
    status: result.ok ? 'sent' : 'failed',
    sentAt: result.ok ? now() : null,
  });
  return id;
}

export function describeOrderItems(lines, currency) {
  return lines
    .map((l) => {
      const qty = l.unit === 'kg' ? `${l.qty}kg` : `${l.qty}×`;
      const base = `${l.serviceName}${l.variantLabel ? ` (${l.variantLabel})` : ''} ${qty}: ${fmtMoney(l.lineTotalCents, currency)}`;
      const addons = (l.addons || [])
        .map((a) => ` +${a.addonName}: ${fmtMoney(a.totalCents, currency)}`)
        .join('');
      return base + addons;
    })
    .join('; ');
}
