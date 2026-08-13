// LavTr — servidor universal (Express) para Railway/qualquer host Node.
// Wraps o app Hono existente (api/src/index.js), adiciona banco via DATABASE_URL
// (libSQL), serve o SPA Vue e roda o cron diário com setInterval.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { app as honoApp, runDailyJobs } from './index.js';
import { applyMigrations } from './migrate.js';

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

// SPA Vue servida estática com fallback para index.html
const dist = join(__dirname, '..', '..', 'web', 'dist');
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
  // Cron diário (substitui o trigger `scheduled` do Cloudflare Worker)
  setInterval(() => {
    runDailyJobs(env).catch((e) => console.error('daily job failed:', e));
  }, 24 * 60 * 60 * 1000);
  runDailyJobs(env).catch((e) => console.error('initial daily job failed:', e));
});
