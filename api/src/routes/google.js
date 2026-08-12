// Google sign-in / sign-up — server-side Authorization Code flow with PKCE.
// The client secret never reaches the browser; state + verifier live in a
// short-lived HttpOnly cookie. Flow:
//   GET  /auth/google/start     → redirect to Google (state + PKCE challenge)
//   GET  /auth/google/callback  → code exchange, ID-token checks, then:
//       linked google_sub → sign in
//       verified email matches an existing user → link + sign in
//       unknown → redirect to SPA with a 5-min signed "gticket"
//   POST /auth/google/complete  → gticket + business details → tenant onboarding
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { tenants, branches, users } from '../db/schema.js';
import { signJwt, verifyJwt, GOOGLE_ONLY_PASSWORD } from '../auth.js';
import { seedTenant } from '../seed.js';
import { uid, bad, audit, ApiError, SUPPORT_EMAIL } from '../util.js';
import { enforceRateLimit, clientIp } from '../ratelimit.js';
import { cleanStr, LIMITS } from '../security.js';
import { issueSession } from '../session.js';

export const googleRoutes = new Hono();

const COOKIE = 'lavtr_gauth';

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

function requireGoogleConfig(env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new ApiError(503, `Google sign-in is not configured. Contact ${SUPPORT_EMAIL}`);
  }
}

const redirectUri = (c) => `${new URL(c.req.url).origin}/api/auth/google/callback`;

// redirect back to the SPA login screen with a fragment payload (fragments
// never reach servers or logs)
const spaRedirect = (c, fragment) => c.redirect(`/login#${fragment}`, 302);

googleRoutes.get('/google/start', async (c) => {
  requireGoogleConfig(c.env);
  const db = getDb(c.env);
  await enforceRateLimit(db, `gauth:ip:${clientIp(c)}`, 30, 300);

  const state = randomToken();
  const verifier = randomToken();
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));

  setCookie(c, COOKIE, `${state}.${verifier}`, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: c.env.ENVIRONMENT === 'production',
    path: '/api/auth/google',
    maxAge: 600,
  });

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', c.env.GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri(c));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('prompt', 'select_account');
  return c.redirect(url.toString(), 302);
});

googleRoutes.get('/google/callback', async (c) => {
  requireGoogleConfig(c.env);
  const db = getDb(c.env);
  await enforceRateLimit(db, `gauth:ip:${clientIp(c)}`, 30, 300);

  const cookie = getCookie(c, COOKIE) || '';
  deleteCookie(c, COOKIE, { path: '/api/auth/google' });
  const [expectedState, verifier] = cookie.split('.');
  const state = c.req.query('state');
  const code = c.req.query('code');
  if (c.req.query('error')) return spaRedirect(c, `gerror=${encodeURIComponent('Google sign-in was cancelled')}`);
  if (!code || !state || !expectedState || state !== expectedState || !verifier) {
    return spaRedirect(c, `gerror=${encodeURIComponent('Sign-in session expired — please try again')}`);
  }

  // exchange the code directly with Google (TLS-trusted channel)
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri(c),
    }),
  });
  if (!tokenRes.ok) {
    console.error('google token exchange failed', await tokenRes.text());
    return spaRedirect(c, `gerror=${encodeURIComponent('Google sign-in failed — please try again')}`);
  }
  const { id_token } = await tokenRes.json();

  // claims come straight from Google over TLS; still validate the basics
  let claims;
  try {
    claims = JSON.parse(atob(id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return spaRedirect(c, `gerror=${encodeURIComponent('Google sign-in failed — please try again')}`);
  }
  const validIss = ['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss);
  const validAud = claims.aud === c.env.GOOGLE_CLIENT_ID;
  const fresh = claims.exp > Math.floor(Date.now() / 1000);
  if (!validIss || !validAud || !fresh || !claims.sub) {
    return spaRedirect(c, `gerror=${encodeURIComponent('Google sign-in failed — please try again')}`);
  }
  if (!claims.email || claims.email_verified !== true) {
    return spaRedirect(c, `gerror=${encodeURIComponent('Your Google email is not verified — use email & password instead')}`);
  }
  const email = claims.email.toLowerCase();

  // 1) already linked → sign in
  let [user] = await db.select().from(users).where(eq(users.googleSub, claims.sub));
  // 2) verified email matches an existing account → link + sign in
  if (!user) {
    const [byEmail] = await db.select().from(users).where(eq(users.email, email));
    if (byEmail) {
      if (byEmail.googleSub && byEmail.googleSub !== claims.sub) {
        return spaRedirect(c, `gerror=${encodeURIComponent('This email is linked to a different Google account')}`);
      }
      await db.update(users).set({ googleSub: claims.sub }).where(eq(users.id, byEmail.id));
      await audit(db, byEmail.tenantId, byEmail.id, 'auth.google_link', 'users', byEmail.id, { email });
      user = { ...byEmail, googleSub: claims.sub };
    }
  }

  if (user) {
    if (user.status === 'pending') {
      // Google has verified this email — that's the same proof the emailed
      // activation link would give, so flip the account live
      await db.update(users).set({ status: 'active' }).where(eq(users.id, user.id));
      await audit(db, user.tenantId, user.id, 'user.activate', 'users', user.id, { email, via: 'google' });
      user = { ...user, status: 'active' };
    }
    if (user.status !== 'active') {
      return spaRedirect(c, `gerror=${encodeURIComponent('This account has been deactivated')}`);
    }
    const [tenant] = await db.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, user.tenantId));
    if (!tenant || tenant.status !== 'active') {
      return spaRedirect(c, `gerror=${encodeURIComponent(`This business account is disabled. Contact support at ${SUPPORT_EMAIL}`)}`);
    }
    const { token, refreshToken, sessionId } = await issueSession(db, c.env, user, {
      ip: clientIp(c), userAgent: c.req.header('User-Agent') || null,
    });
    const payload = btoa(JSON.stringify({ token, refresh_token: `${sessionId}.${refreshToken}` }));
    return spaRedirect(c, `gauth=${encodeURIComponent(payload)}`);
  }

  // 3) brand-new user → short-lived signed ticket; the SPA collects business details
  const ticket = await signJwt(
    { typ: 'gticket', sub: claims.sub, email, name: claims.name || email.split('@')[0] },
    c.env.JWT_SECRET,
    600
  );
  return spaRedirect(c, `gticket=${encodeURIComponent(ticket)}&gname=${encodeURIComponent(claims.name || '')}&gemail=${encodeURIComponent(email)}`);
});

// Finish sign-up: Google identity (from the ticket) + business details →
// standard tenant onboarding with the seeded catalog.
googleRoutes.post('/google/complete', async (c) => {
  requireGoogleConfig(c.env);
  const db = getDb(c.env);
  await enforceRateLimit(db, `gauth:ip:${clientIp(c)}`, 30, 300);

  const b = await c.req.json();
  const claims = await verifyJwt(b.ticket || '', c.env.JWT_SECRET);
  if (!claims || claims.typ !== 'gticket') {
    throw new ApiError(401, 'Sign-up session expired — please try “Continue with Google” again');
  }
  // the full onboarding field set (name/email arrive verified from Google;
  // the name remains editable on the completion form)
  const businessName = cleanStr(b.business_name, LIMITS.name, 'Business name');
  const branchName = cleanStr(b.branch_name, LIMITS.name, 'Branch name');
  const phone = cleanStr(b.phone, LIMITS.phone, 'Phone');
  const displayName = cleanStr(b.name, LIMITS.name, 'Name') || cleanStr(claims.name, LIMITS.name, 'Name') || claims.email;
  if (!businessName) bad('Business name is required');
  if (!branchName) bad('Branch name is required');
  if (!phone) bad('Phone number is required');

  // the email may have registered (or been linked) since the ticket was issued
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, claims.email));
  if (existing) bad('An account with this email already exists — sign in instead');

  const tenantId = uid();
  await db.insert(tenants).values({
    id: tenantId,
    name: businessName,
    codePrefix: businessName.slice(0, 2).toUpperCase().replace(/[^A-Z]/g, '') || 'WK',
    orderSeq: 0, // tags count from 0001
  });
  const branchId = uid();
  await db.insert(branches).values({ id: branchId, tenantId, name: branchName, location: null });
  const { roleIds } = await seedTenant(db, tenantId);

  const userId = uid();
  await db.insert(users).values({
    id: userId,
    tenantId,
    branchId,
    roleId: roleIds['Dono/Admin'],
    accessScope: 'tenant',
    name: displayName,
    phone: phone || null,
    email: claims.email,
    passwordHash: GOOGLE_ONLY_PASSWORD, // no password — Google is the credential
    googleSub: claims.sub,
  });

  const { token, refreshToken, sessionId } = await issueSession(db, c.env, { id: userId, tenantId }, {
    ip: clientIp(c), userAgent: c.req.header('User-Agent') || null,
  });
  return c.json({ token, refresh_token: `${sessionId}.${refreshToken}` }, 201);
});
