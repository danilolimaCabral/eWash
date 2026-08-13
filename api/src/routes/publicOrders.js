// LavTr — Leva e Traz: pedidos públicos de coleta/entrega solicitados por clientes finais
//
// Rotas públicas (sem login), resolvidas por code_prefix do tenant (?tenant=LV):
//   POST /api/public/requests?tenant=LV   cria pedido
//   GET  /api/public/r/:access_code       rastreia pedido (tenant resolvido por ?tenant=LV)
//
// Rotas internas (admin logado), com authRequired no app do index.js:
//   GET    /api/levae-traz                lista pedidos
//   PATCH  /api/levae-traz/:id            muda status (accepted/picked_up/done)
import { Hono } from 'hono';
import { createClient } from '@libsql/client';
import { ApiError } from '../util.js';

const clients = new Map();
function getRaw(env) {
  const url = String(env.DATABASE_URL || process.env.DATABASE_URL || '');
  if (!clients.has(url)) clients.set(url, createClient({ url }));
  return clients.get(url);
}

// ---- tipos Hono ----
const publicRoutes = new Hono();

function bad(msg, code = 400) {
  throw new ApiError(code, msg);
}

// resolveTenantPublic: acha o tenant ativo por code_prefix (ex.: ?tenant=LV)
async function resolveTenantPublic(c) {
  const prefix = String(c.req.query('tenant') || '').trim().toUpperCase().slice(0, 4);
  if (!prefix) bad('Parâmetro tenant obrigatório');
  const raw = getRaw(c.env);
  const tenantsRes = await raw.execute({
    sql: `SELECT id, name, code_prefix FROM tenants WHERE code_prefix = ? AND status = 'active' LIMIT 50`,
    args: [prefix],
  });
  const rows = tenantsRes.rows;
  if (!rows?.length) bad('Lavanderia não encontrada', 404);
  const tenant = rows[0];
  const branchRes = await raw.execute({
    sql: `SELECT id FROM branches WHERE tenant_id = ? AND active = 1 LIMIT 1`,
    args: [tenant.id],
  });
  const branch = branchRes.rows?.[0];
  if (!branch) bad('Lavanderia sem filial ativa', 404);
  return { raw, tenant, branch };
}

function cleanPhone(p) {
  const digits = String(p || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-11) : '';
}

// POST /api/public/requests?tenant=LV
publicRoutes.post('/requests', async (c) => {
  const { raw, tenant, branch } = await resolveTenantPublic(c);
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name || '').trim().slice(0, 80);
  const phone = String(body.phone || '').trim().slice(0, 20);
  const address = String(body.address || '').trim().slice(0, 300);
  const items = String(body.items || '').trim().slice(0, 1000);
  const notes = body.notes ? String(body.notes).trim().slice(0, 1000) : null;
  const serviceKind = ['lavagem', 'passadoria', 'edredom', 'outros'].includes(body.service_kind)
    ? body.service_kind : 'lavagem';
  if (!name || name.length < 2) bad('Informe seu nome');
  if (!cleanPhone(phone)) bad('Informe um telefone válido');
  if (!address || address.length < 8) bad('Informe o endereço completo');
  if (!items || items.length < 3) bad('Descreva o que precisa lavar ou trazer');

  // rate limit leve: máx 3 pedidos por telefone em 5 min no mesmo tenant
  const recentRes = await raw.execute({
    sql: `SELECT COUNT(*) as n FROM public_requests
          WHERE tenant_id = ? AND phone = ? AND created_at > datetime('now', '-5 minutes')`,
    args: [tenant.id, cleanPhone(phone)],
  });
  if (Number(recentRes.rows[0]?.n || 0) >= 3) bad('Muitos pedidos no momento. Aguarde alguns minutos.');

  await raw.execute({
    sql: `INSERT INTO public_requests
      (id, tenant_id, branch_id, customer_name, phone, address, items, notes, service_kind, status, access_code)
      VALUES (HEX(RANDOMBLOB(16)), ?, ?, ?, ?, ?, ?, ?, ?, 'requested', UPPER(SUBSTR(HEX(RANDOMBLOB(3)), 1, 6)))`,
    args: [tenant.id, branch.id, name, cleanPhone(phone), address, items, notes, serviceKind],
  });
  const createdRes = await raw.execute({
    sql: `SELECT id, access_code FROM public_requests
          WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1`,
    args: [tenant.id],
  });
  const row = createdRes.rows?.[0];
  if (!row) throw new ApiError(500, 'Não foi possível criar o pedido. Tente novamente.');

  // Notificação in-app para a lavanderia ver no painel
  await raw.execute({
    sql: `INSERT INTO notifications
      (id, tenant_id, user_id, order_id, kind, channel, recipient, subject, body, sent_at, delivery_status)
      VALUES (HEX(RANDOMBLOB(16)), ?, NULL, NULL, 'leva_e_traz', 'in_app', NULL,
        'Novo Leva e Traz', ?, datetime('now'), 'sent')`,
    args: [tenant.id, `${name} pediu coleta: ${items.slice(0, 80)}`],
  }).catch(() => null);

  return c.json({
    ok: true,
    request: { access_code: row.access_code, name, phone, address, items, status: 'requested' },
    message: `Pedido recebido! Guarde seu código de acompanhamento: ${row.access_code}`,
  });
});

// GET /api/public/r/:access_code?tenant=LV
publicRoutes.get('/r/:access_code', async (c) => {
  const { raw, tenant } = await resolveTenantPublic(c);
  const code = String(c.req.param('access_code') || '').trim().toUpperCase().slice(0, 6);
  if (code.length < 6) bad('Código inválido');
  const trackRes = await raw.execute({
    sql: `SELECT customer_name, phone, address, items, notes, status, created_at, updated_at
          FROM public_requests WHERE access_code = ? AND tenant_id = ? LIMIT 1`,
    args: [code, tenant.id],
  });
  const row = trackRes.rows?.[0];
  if (!row) bad('Pedido não encontrado. Verifique o código.', 404);
  return c.json({ ok: true, request: row });
});

// ---- rotas internas (admin logado) — adminRoutes exportadas e montadas com authRequired ----
const adminRoutes = new Hono();

// GET /api/levae-traz
adminRoutes.get('/', async (c) => {
  const raw = getRaw(c.env);
  const tenantId = c.get('tenant').id;
  const listRes = await raw.execute({
    sql: `SELECT id, customer_name, phone, address, items, notes, service_kind, status,
          access_code, estimated_price_cents, internal_order_id, created_at, updated_at
      FROM public_requests WHERE tenant_id = ?
      ORDER BY CASE status WHEN 'requested' THEN 0 WHEN 'accepted' THEN 1 WHEN 'picked_up' THEN 2 ELSE 3 END,
               created_at DESC LIMIT 100`,
    args: [tenantId],
  });
  return c.json({ ok: true, requests: listRes.rows || [] });
});

// PATCH /api/levae-traz/:id  body: { status }
adminRoutes.patch('/:id', async (c) => {
  const raw = getRaw(c.env);
  const tenantId = c.get('tenant').id;
  const id = c.req.param('id');
  const body = await c.req.json();
  const status = body.status;
  if (!['accepted', 'picked_up', 'done'].includes(status)) bad('Status inválido');

  const existRes = await raw.execute({
    sql: `SELECT customer_name, phone, items, status FROM public_requests
          WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [id, tenantId],
  });
  const row = existRes.rows?.[0];
  if (!row) bad('Pedido não encontrado', 404);

  await raw.execute({
    sql: `UPDATE public_requests SET status = ?, updated_at = datetime('now')
          WHERE id = ? AND tenant_id = ?`,
    args: [status, id, tenantId],
  });

  if (status === 'accepted') {
    await raw.execute({
      sql: `INSERT INTO notifications
        (id, tenant_id, user_id, order_id, kind, channel, recipient, subject, body, sent_at, delivery_status)
        VALUES (HEX(RANDOMBLOB(16)), ?, NULL, NULL, 'leva_e_traz', 'in_app', NULL,
          'Leva e Traz aceito', ?, datetime('now'), 'sent')`,
      args: [tenantId, `${row.customer_name}: pedido aceito (${row.items.slice(0, 60)})`],
    }).catch(() => null);
  }
  return c.json({ ok: true, request: { id, ...row, status } });
});

export { publicRoutes, adminRoutes };
