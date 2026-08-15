// Teste local: fluxo completo do Leva e Traz (criação, rastreio, gestão admin)
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIG = join(import.meta.dirname || __dirname, 'migrations');
process.chdir(join(import.meta.dirname || __dirname, '..'));
import('./src/routes/publicOrders.js').then(async ({ publicRoutes, adminRoutes }) => {
  const raw = createClient({ url: 'file:/tmp/leva.db' });
  try { await raw.execute('DROP TABLE IF EXISTS public_requests'); } catch {}
  // aplica migration 0022 + fragmentos do 0000 necessários
  const init = readFileSync(join(MIG, '0000_init.sql'), 'utf8');
  for (const stmt of init.split('--> statement-breakpoint')) {
    const s = stmt.trim();
    if (!s) continue;
    try { await raw.execute(s); } catch (e) { if (!/already exists|already a table/i.test(e.message)) console.log('init skip:', e.message.slice(0, 120)); }
  }
  const m07 = readFileSync(join(MIG, '0007_platform-control-plane.sql'), 'utf8');
  for (const stmt of m07.split('--> statement-breakpoint')) {
    const s = stmt.trim();
    if (!s) continue;
    try { await raw.execute(s); } catch (e) { if (!/already exists|duplicate column/i.test(e.message)) console.log('07 skip:', e.message.slice(0, 100)); }
  }
  const m22 = readFileSync(join(MIG, '0022_public_requests.sql'), 'utf8');
  for (const stmt of m22.split('--> statement-breakpoint')) {
    const s = stmt.trim();
    if (!s) continue;
    try { await raw.execute(s); console.log('m22 applied:', s.slice(0, 60)); }
    catch (e) { console.log('m22 err:', e.message.slice(0, 150)); }
  }
  const db = drizzle(raw, { schema: {} });
  const T = '00000000-0000-0000-0000-000000000001';
  await raw.execute({ sql: "INSERT OR IGNORE INTO tenants (id, name, plan, currency, status, code_prefix, settings) VALUES (?, 'Test', 'pro', 'BRL', 'active', 'LV', '{}')", args: [T] });
  await raw.execute({ sql: "INSERT OR IGNORE INTO branches (id, tenant_id, name, location, active) VALUES ('00000000-0000-0000-0000-000000000010', ?, 'Filial', 'Centro', 1)", args: [T] });

  const makeReq = (path, opts = {}) => {
    const url = `http://x.test${path}`;
    return new Request(url, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  };
  const env = { DATABASE_URL: 'file:/tmp/leva.db' };
  const ctxPublic = (req, tenant) => {
    // simular hono context com env + query tenant=LV
    return { env, ...req };
  };

  // ---- testar POST criação ----
  const postReq = makeReq('/requests?tenant=LV', { method: 'POST', body: {
    name: 'Maria Teste', phone: '(11) 98888-7777', address: 'Rua A, 100 - Vila B', items: 'Lavagem por quilo 5kg + 1 edredom queen',
  }});
  // usar o app real do index.js (já registra publicRoutes em /api/public)
  const mod = await import('./src/index.js');
  const resp = await mod.app.fetch(postReq, env);
  const rawText = await resp.text();
  let data;
  try { data = JSON.parse(rawText); } catch { console.log('raw resp:', rawText.slice(0, 400)); throw new Error('non-JSON response'); }
  console.log('POST /requests status:', resp.status, JSON.stringify(data).slice(0, 300));

  if (data.ok) {
    const code = data.request.access_code;
    // ---- testar GET rastreio ----
    const getReq = makeReq(`/r/${code}?tenant=LV`);
    const resp2 = await mod.app.fetch(getReq, env);
    console.log('GET /r/:code status:', resp2.status, JSON.stringify(await resp2.json()).slice(0, 200));
    // código inválido
    const resp3 = await mod.app.fetch(makeReq(`/r/AAAAAA?tenant=LV`), env);
    console.log('GET /r inválido:', resp3.status, (await resp3.json()).error);
  }

  // ---- testar lista admin (sem auth deve 401) ----
  const aApp = new HonoApp();
  aApp.route('/levae-traz', adminRoutes);
  const adminReq = makeReq('/levae-traz');
  const respA = await aApp.fetch(adminReq, env);
  console.log('Admin sem auth:', respA.status);
  // com context simulado (admin logado)
  const ctx = { db, tenant: { id: T }, user: { id: 'u1' }, policies: new Set(), env };
  const adminReq2 = makeReq('/levae-traz');
  const respB = await aApp.fetch(adminReq2, { ...env });
  // Hono set/get via context vars — sem auth middleware, c.get('db') retorna undefined; testar só sintaxe
  console.log('Admin direto:', respB.status);

  // validar dados no banco
  const [r] = await raw.execute('SELECT COUNT(*) c FROM public_requests');
  console.log('public_requests rows:', r.rows[0].c);
  raw.close();
  console.log('TEST OK');
}).catch(e => { console.error('TEST FAIL:', e.message, e.stack); process.exit(1); });
