// LavTr — servidor universal (Express) para Railway/qualquer host Node.
// Wraps o app Hono existente (api/src/index.js), adiciona banco via DATABASE_URL
// (libSQL), serve o SPA Vue e roda o cron diário com setInterval.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './db/schema.js';
import { app as honoApp, runDailyJobs } from './index.js';
import { applyMigrations } from './migrate.js';
import { seedTenant } from './seed.js';
import { POLICY_KEYS } from './policies.js';

// Fixup de emergência: garante o schema completo (caso migrations tenham falhado no meio,
// deixando o banco sem tabelas como roles/users) e insere o tenant demo faltante.
async function fixupSchema() {
  const raw = createClient({ url: String(process.env.DATABASE_URL || '') });
  const db = drizzle(raw, { schema });
  try {
    const init = readFileSync(join(__dirname, '..', 'migrations', '0000_init.sql'), 'utf8');
    for (const stmt of init.split('--> statement-breakpoint')) {
      const s = stmt.trim();
      if (!s || !/^CREATE (TABLE|INDEX)/.test(s)) continue;
      try {
        await raw.execute(s);
      } catch (e) {
        if (!String(e.message).includes('already exists')) throw e;
      }
    }
    const demo = async (label, sql) => {
      try { await raw.execute(sql); console.log(`fixup ok: ${label}`); }
      catch (e) { console.log(`fixup skip ${label}: ${e.message}`); }
    };
    const has = async (q) => (await raw.execute(q)).rows[0].c > 0;
    const T = '00000000-0000-0000-0000-000000000001';
    const HASH = 'pbkdf2$100000$nus3I4EeDf6vmgSIVslXWg$eHHYGk2KVV-1CwZBQNvWJbw7t151UAsmFNc24rMQAHk';
    await demo('tenant', `INSERT OR IGNORE INTO tenants (id, name, plan, currency, status, billing_email, code_prefix, settings) VALUES ('${T}', 'Lavanderia Demo', 'pro', 'BRL', 'active', 'demo@lavatr.app', 'LV', '{}')`);
    await demo('branch 1', `INSERT OR IGNORE INTO branches (id, tenant_id, name, location, active) VALUES ('00000000-0000-0000-0000-000000000001', '${T}', 'Filial Centro', 'Centro', 1)`);
    await demo('branch 10', `INSERT OR IGNORE INTO branches (id, tenant_id, name, location, active) VALUES ('00000000-0000-0000-0000-000000000010', '${T}', 'Filial Centro', 'Centro', 1)`);
    const roleIds = ['00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000023','00000000-0000-0000-0000-000000000024'];
    const roleNames = ['Dono/Admin','Atendente','Operador','Entregador'];
    for (let i = 0; i < roleIds.length; i++) {
      await demo(`role ${roleNames[i]}`, `INSERT OR IGNORE INTO roles (id, tenant_id, name, is_system) VALUES ('${roleIds[i]}', '${T}', '${roleNames[i]}', 1)`);
    }
    const donoRoleId = '00000000-0000-0000-0000-000000000021';
    const branch10Id = '00000000-0000-0000-0000-000000000010';
    if (!(await has(`SELECT COUNT(*) c FROM users WHERE email='demo@lavatr.app'`))) {
      await demo('user demo', `INSERT OR IGNORE INTO users (id, tenant_id, branch_id, role_id, access_scope, name, email, phone, password_hash, status) VALUES ('00000000-0000-0000-0000-000000000031', '${T}', '${branch10Id}', '${donoRoleId}', 'tenant', 'Lavanderia Demo', 'demo@lavatr.app', '11999990000', '${HASH}', 'active')`);
    }
    // Políticas do Dono/Admin demo (o role existe mas nunca recebeu as permissões)
    if (!(await has(`SELECT COUNT(*) c FROM role_policies WHERE role_id='${donoRoleId}'`))) {
      for (const key of POLICY_KEYS) {
        await demo(`policy ${key}`, `INSERT OR IGNORE INTO role_policies (id, role_id, policy_key, allow) VALUES (HEX(RANDOMBLOB(16)), '${donoRoleId}', '${key}', 1)`);
      }
    }
    // Remove lock de login da conta demo (testes repetidos podem bloquear a demo)
    await demo('unlock demo login', `DELETE FROM rate_limits WHERE key='login:email:demo@lavatr.app'`);
    // Catálogo demo completo (categorias BR, serviços, variantes, tiers, addons) via seedTenant
    if (!(await has(`SELECT COUNT(*) c FROM service_categories WHERE tenant_id='${T}'`))) {
      try {
        await seedTenant(db, T);
        console.log('fixup ok: catalog seeded');
      } catch (e) {
        console.log(`fixup skip catalog seed: ${e.message}`);
      }
    }
    console.log('fixup schema complete');
  } catch (e) {
    console.error('fixup schema failed (non-fatal):', e.message);
  } finally {
    raw.close();
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);


// Railway pode ter APP_URL=PLACEHOLDER antes do dominio ser gerado.
// Derivamos uma base valida (localhost) para a delegacao Hono funcionar sempre.
const APP_URL_BASE = (() => {
  try {
    const u = new URL(process.env.APP_URL || `http://localhost:${PORT}`);
    return u.origin;
  } catch {
    return `http://localhost:${PORT}`;
  }
})();

const env = {
  ENVIRONMENT: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  DATABASE_URL: process.env.DATABASE_URL || '',
  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-me-in-production',
  PIX_CALLBACK_SECRET: process.env.PIX_CALLBACK_SECRET || '',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  SMTP_HOST: process.env.SMTP_HOST || 'smtp.gmail.com',
  SMTP_PORT: process.env.SMTP_PORT || '465',
  SMTP_USERNAME: process.env.SMTP_USERNAME || '',
  SMTP_PASSWORD: process.env.SMTP_PASSWORD || '',
  APP_URL: APP_URL_BASE,
  PLATFORM_ADMIN_EMAIL: process.env.PLATFORM_ADMIN_EMAIL || '',
  PLATFORM_ADMIN_PASSWORD: process.env.PLATFORM_ADMIN_PASSWORD || '',
  PLATFORM_ADMIN_NAME: process.env.PLATFORM_ADMIN_NAME || '',
  SMS_API_KEY: process.env.SMS_API_KEY || '',
  SMS_PARTNER_ID: process.env.SMS_PARTNER_ID || '',
  APP_LOCALE: process.env.APP_LOCALE || 'pt-BR',
  APP_CURRENCY: process.env.APP_CURRENCY || 'BRL',
  EMAIL_FROM_NAME: process.env.EMAIL_FROM_NAME || 'LavTr Sistema de Lavanderia',
};

const server = express();
server.use(express.json({ limit: '64kb' }));

// API Hono: delega todas as rotas /api/*
server.use('/api{*rest}', (req, res) => {
  const url = new URL(req.originalUrl, APP_URL_BASE);
  const isGet = ['GET', 'HEAD'].includes(req.method);
  const request = new Request(url.toString(), {
    method: req.method,
    headers: req.headers,
    body: isGet ? undefined : JSON.stringify(req.body ?? {}),
  });
  honoApp.fetch(request, env).then(async (resp) => {
    const headers = {};
    resp.headers.forEach((v, k) => { headers[k] = v; });
    let payload = null;
    try { payload = await resp.arrayBuffer(); } catch { /* stream esvaziado */ }
    res.status(resp.status).set(headers);
    res.end(payload ? Buffer.from(payload) : '');
  }).catch((err) => {
    console.error('hono delegate failed:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  });
});

// Landing page de vendas servida em /site
const landingPath = join(__dirname, '..', 'public', 'site.html');
server.get('/site', (_req, res) => { res.sendFile(landingPath); });

// SPA Vue servida estática com fallback para index.html
const candidate = (p) => join(dirname(__dirname), p, 'web', 'dist');
const candidates = ['.', '..', '../..'];
const dist = candidates.map((c) => candidate(c)).find((p) => existsSync(join(p, 'index.html')))
  || join(dirname(__dirname), 'web', 'dist');
server.use(express.static(dist));
server.get('{*fallback}', (_req, res) => {
  res.sendFile(join(dist, 'index.html'));
});

server.listen(PORT, async () => {
  console.log(`LavTr listening on :${PORT} (${env.ENVIRONMENT})`);
  try {
    if (process.env.RUN_MIGRATIONS !== 'false') {
      await applyMigrations(env);
    }
  } catch (e) {
    console.error('migration apply failed (non-fatal):', e.message);
  }
  // Garante schema completo + dados demo mesmo quando migrations falham no meio
  await fixupSchema();
  // Cron diário (substitui o trigger `scheduled` do Cloudflare Worker)
  setInterval(() => {
    runDailyJobs(env).catch((e) => console.error('daily job failed:', e));
  }, 24 * 60 * 60 * 1000);
  runDailyJobs(env).catch((e) => console.error('initial daily job failed:', e));
});
