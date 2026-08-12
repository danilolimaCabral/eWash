// Notifications: rendered from tenant-editable templates with merge fields,
// recorded in the notifications table, and dispatched via a provider stub.
// Swap `dispatch` for Africa's Talking / WhatsApp Business API in production —
// the rest of the system only talks to `sendNotification`.
import { uid, now, fmtMoney } from './util.js';
import { notifications } from './db/schema.js';

// Customer messages are branded with the tenant's own business name via the
// {business} merge field — never with the LavTr platform name.
export const DEFAULT_TEMPLATES = {
  quote_ready:
    '{business}: Olá {customer}, pedido {order_code} avaliado: {items}. Total {total}. Pague via Pix ou em dinheiro ao retirar. Obrigado!',
  payment_received:
    '{business}: Pagamento de {amount} recebido para o pedido {order_code}. Saldo: {balance}. Obrigado!',
  order_ready:
    '{business}: Olá {customer}, seu pedido {order_code} está pronto para retirada. {balance_note}Obrigado!',
  order_delivered:
    '{business}: Pedido {order_code} entregue/retirado. Obrigado por nos escolher, {customer}!',
  payment_reminder:
    '{business}: Lembrete — o pedido {order_code} está pronto e possui saldo de {balance}. Pague via Pix para retirar. Obrigado!',
};

export function renderTemplate(tenant, key, fields) {
  const settings = JSON.parse(tenant.settings || '{}');
  const templates = { ...DEFAULT_TEMPLATES, ...(settings?.templates || {}) };
  let msg = templates[key] || DEFAULT_TEMPLATES[key] || '';
  for (const [k, v] of Object.entries({ business: tenant.name, ...fields })) {
    msg = msg.replaceAll(`{${k}}`, String(v));
  }
  return msg;
}

// Normalize any Kenyan phone input to 254XXXXXXXXX (no + sign):
//   0724814117 → 254724814117 · 724814117 → 254724814117 ·
//   +254724… → 254724… · 01124814117 → 2541124814117
export function normalizeKenyaPhone(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('254')) return digits;
  digits = digits.replace(/^0+/, '');
  return `254${digits}`;
}

// SMS delivery via TextSMS Kenya (same gateway/config as the store project):
// POST { apikey, partnerID, shortcode, mobile, message } — credentials live in
// the body, no auth header. Docs: https://sms.textsms.co.ke/api/services/sendsms/
// Unconfigured (no SMS_API_KEY/SMS_PARTNER_ID — local dev) → simulate success
// so the notification feed stays inspectable. Never throws: a failed SMS must
// not break the order or payment action that triggered it.
async function dispatch(env, _channel, phone, message) {
  if (!env.SMS_API_KEY || !env.SMS_PARTNER_ID) {
    console.warn('SMS not configured — message recorded as sent (simulated)');
    return { ok: true };
  }
  try {
    const url = (env.SMS_BASE_URL || 'https://sms.textsms.co.ke/api/services/sendsms/').replace(/\/?$/, '/');
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        apikey: env.SMS_API_KEY,
        partnerID: env.SMS_PARTNER_ID,
        message,
        shortcode: env.SMS_SHORTCODE,
        mobile: normalizeKenyaPhone(phone),
      }),
    });
    if (!response.ok) {
      console.error(`TextSMS HTTP error [${response.status}]:`, await response.text().catch(() => ''));
      return { ok: false };
    }
    // TextSMS wraps results in a `responses` array — and their API has a typo:
    // "respose-code" (missing n). The code may arrive as number or string.
    const result = await response.json().catch(() => ({}));
    const first = result.responses?.[0];
    if (!first) {
      console.warn('TextSMS response had no responses array:', JSON.stringify(result));
      return { ok: true }; // HTTP OK with unknown shape — assume delivered, same as the store
    }
    const code = String(first['respose-code']);
    const description = String(first['response-description'] || '').toLowerCase();
    if (code === '200' || description.includes('success')) {
      return { ok: true, providerId: first.messageid };
    }
    console.error(`TextSMS rejected SMS: code=${code}, description=${first['response-description']}`);
    return { ok: false };
  } catch (error) {
    console.error('TextSMS send failed:', error.message);
    return { ok: false };
  }
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
