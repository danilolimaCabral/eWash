// LavTr API — a single Cloudflare Worker serves both the REST API (/api/*)
// and the built Vue SPA (static assets with SPA fallback). One service, one deploy.
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { and, eq, lte, lt, or, isNotNull, sql } from 'drizzle-orm';
import { authRequired } from './middleware.js';
import { assertProdSecrets } from './security.js';
import { authRoutes, meHandler, unlockHandler } from './routes/auth.js';
import { googleRoutes } from './routes/google.js';
import { catalogRoutes } from './routes/catalog.js';
import { customerRoutes } from './routes/customers.js';
import { orderRoutes } from './routes/orders.js';
import { paymentRoutes, pixCallbackRoute } from './routes/payments.js';
import { financeRoutes, postDueRecurring } from './routes/finance.js';
import { reportRoutes } from './routes/reports.js';
import { userRoutes } from './routes/users.js';
import { platformAuthRequired } from './platform.js';
import { platformAuthRoutes, platformRoutes } from './routes/platform.js';
import { ApiError } from './util.js';
import { publicRoutes, adminRoutes as levaEtrazAdminRoutes } from './routes/publicOrders.js';
import { getDb } from './db/index.js';
import { sessions, platformSessions, passwordResetTokens, rateLimits, tenantSubscriptions, tenants } from './db/schema.js';
import { now } from './util.js';

const app = new Hono();
export { app };

app.onError((err, c) => {
  if (err instanceof ApiError) return c.json({ error: err.message }, err.status);
  console.error(err.stack || err);
  return c.json({ error: 'Something went wrong. Please try again.' }, 500);
});

// ---- hardening for hostile public traffic ----
app.use('/api/*', secureHeaders({
  strictTransportSecurity: 'max-age=31536000; includeSubDomains',
  xFrameOptions: 'DENY',
  referrerPolicy: 'no-referrer',
}));
// refuse to serve at all if production secrets are weak/missing
app.use('/api/*', async (c, next) => {
  assertProdSecrets(c.env);
  await next();
});
// API bodies are small JSON — cap request size to shut down payload abuse
const MAX_BODY_BYTES = 64 * 1024;
app.use('/api/*', async (c, next) => {
  const len = Number(c.req.header('content-length') || 0);
  if (len > MAX_BODY_BYTES) return c.json({ error: 'Request body too large' }, 413);
  await next();
});
// API responses are per-user and must never be cached by shared caches
app.use('/api/*', async (c, next) => {
  await next();
  c.res.headers.set('Cache-Control', 'no-store');
});

app.get('/api/health', (c) => {
  const body = { ok: true, service: 'LavTr', at: new Date().toISOString() };
  // Dev-only config readout: which env keys are LOADED (booleans only — never
  // the values). Suppressed in production so it can't leak configuration shape.
  if (c.env.ENVIRONMENT !== 'production') {
    const present = (v) => typeof v === 'string' && v.length > 0;
    body.config = {
      ENVIRONMENT: c.env.ENVIRONMENT || null,
      JWT_SECRET: present(c.env.JWT_SECRET),
      MPESA_CALLBACK_SECRET: present(c.env.MPESA_CALLBACK_SECRET),
      GOOGLE_CLIENT_ID: present(c.env.GOOGLE_CLIENT_ID),
      GOOGLE_CLIENT_SECRET: present(c.env.GOOGLE_CLIENT_SECRET),
      SMTP_HOST: present(c.env.SMTP_HOST),
      SMTP_USERNAME: present(c.env.SMTP_USERNAME),
      SMTP_PASSWORD: present(c.env.SMTP_PASSWORD),
      APP_URL: present(c.env.APP_URL),
      PLATFORM_ADMIN_EMAIL: present(c.env.PLATFORM_ADMIN_EMAIL),
      PLATFORM_ADMIN_PASSWORD: present(c.env.PLATFORM_ADMIN_PASSWORD),
      SMS_API_KEY: present(c.env.SMS_API_KEY),
      SMS_PARTNER_ID: present(c.env.SMS_PARTNER_ID),
    };
  }
  return c.json(body);
});

// public
app.route('/api/auth', authRoutes);
app.route('/api/auth', googleRoutes);
app.route('/api/platform/auth', platformAuthRoutes);
app.route('/api', pixCallbackRoute);
// Leva e Traz: rotas públicas (sem login), resolvidas por code_prefix (?tenant=LV)
app.route('/api/public', publicRoutes);

const platformApi = new Hono();
platformApi.use('*', platformAuthRequired);
platformApi.route('/', platformRoutes);
app.route('/api/platform', platformApi);

// authenticated
const api = new Hono();
api.use('*', authRequired);
api.get('/me', meHandler);
api.post('/auth/unlock', unlockHandler);
api.route('/', catalogRoutes);
api.route('/', customerRoutes);
api.route('/', orderRoutes);
api.route('/', paymentRoutes);
api.route('/', financeRoutes);
api.route('/', reportRoutes);
api.route('/', userRoutes);
// Leva e Traz: gestão interna (admin logado)
api.route('/levae-traz', levaEtrazAdminRoutes);
app.route('/api', api);

app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

// Daily job: cancellations automáticas, lançamento de despesas recorrentes e
// higiene das tabelas de auth. Funciona tanto no Cloudflare Worker (scheduled)
// quanto em Node/Express (setInterval). Comparadores de data usam strings ISO,
// compatíveis com SQLite/D1 e MySQL.
export async function runDailyJobs(env) {
  const db = getDb(env);
  const today = now().slice(0, 10);
  const cutoff35 = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 35);
    return d.toISOString().slice(0, 19).replace('T', ' ');
  })();
  const cutoff1d = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 19).replace('T', ' ');
  })();
  const cutoffUnix = Math.floor(Date.now() / 1000) - 86400;
  const cancellations = await db.select({ id: tenants.id }).from(tenants)
    .where(and(eq(tenants.status, 'active'), lte(tenants.cancelledAt, today)));
  for (const tenant of cancellations) {
    await db.update(tenants).set({ status: 'cancelled' }).where(eq(tenants.id, tenant.id));
    await db.update(tenantSubscriptions).set({ status: 'cancelled', endedAt: now() })
      .where(and(eq(tenantSubscriptions.tenantId, tenant.id), eq(tenantSubscriptions.cancelAtPeriodEnd, 1)));
    await db.update(sessions).set({ revokedAt: now() }).where(eq(sessions.tenantId, tenant.id));
  }
  const tenantRows = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.status, 'active'));
  for (const t of tenantRows) {
    try {
      await postDueRecurring(db, t.id);
    } catch (e) {
      console.error(`recurring post failed for tenant ${t.id}:`, e);
    }
  }

  // Table hygiene: auth artifacts are append-heavy — purge what can no
  // longer authenticate anything so the hot tables stay small forever.
  try {
    await db.batch([
      db.delete(sessions).where(or(
        lt(sessions.expiresAt, cutoff35),
        and(isNotNull(sessions.revokedAt), lt(sessions.revokedAt, cutoff35)),
      )),
      db.delete(platformSessions).where(or(
        lt(platformSessions.expiresAt, cutoff35),
        and(isNotNull(platformSessions.revokedAt), lt(platformSessions.revokedAt, cutoff35)),
      )),
      db.delete(passwordResetTokens).where(or(
        isNotNull(passwordResetTokens.usedAt),
        lt(passwordResetTokens.expiresAt, cutoff1d),
      )),
      db.delete(rateLimits).where(lt(rateLimits.windowStart, cutoffUnix)),
    ]);
  } catch (e) {
    console.error('auth table hygiene failed:', e);
  }
}

export default {
  fetch: app.fetch,

  async scheduled(_event, env, _ctx) {
    await runDailyJobs(env);
  },
};
