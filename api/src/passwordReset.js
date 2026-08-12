// One-time emailed tokens (password reset + account activation). Links are
// built from the request's own origin so they work unchanged on localhost,
// preview and production hosts; APP_URL is only a fallback.
import { eq } from 'drizzle-orm';
import { passwordResetTokens } from './db/schema.js';
import { sendPasswordResetEmail, sendActivationEmail, sendStaffInviteEmail } from './smtp.js';
import { now, uid } from './util.js';

export const passwordResetTokenHash = async (token) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const appOrigin = (c) =>
  (new URL(c.req.url).origin || c.env.APP_URL || 'https://lavtr.qesuite.com').replace(/\/+$/, '');

async function issueEmailToken(db, { user, purpose, ttlMinutes, requestedIp }) {
  const rawToken = randomToken();
  const id = uid();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString().slice(0, 19).replace('T', ' ');
  await db.insert(passwordResetTokens).values({
    id, userId: user.id, tokenHash: await passwordResetTokenHash(rawToken),
    purpose, expiresAt, requestedIp,
  });
  return { id, rawToken };
}

// Both issuers burn the token row if the email cannot be sent — a link that
// never reached the inbox must not stay redeemable.
export async function issuePasswordReset(db, env, user, origin, requestedIp = null) {
  const { id, rawToken } = await issueEmailToken(db, { user, purpose: 'password_reset', ttlMinutes: 30, requestedIp });
  try {
    await sendPasswordResetEmail(env, {
      to: user.email, name: user.name,
      resetUrl: `${origin}/reset-password?token=${encodeURIComponent(rawToken)}`,
    });
    return true;
  } catch (error) {
    console.error('password reset email failed:', error.message);
    await db.update(passwordResetTokens).set({ usedAt: now() }).where(eq(passwordResetTokens.id, id));
    return false;
  }
}

export async function issueStaffInvite(db, env, { user, business, inviter }, origin, requestedIp = null) {
  const { id, rawToken } = await issueEmailToken(db, { user, purpose: 'invite', ttlMinutes: 72 * 60, requestedIp });
  const inviteUrl = `${origin}/activate?token=${encodeURIComponent(rawToken)}`;
  try {
    await sendStaffInviteEmail(env, { to: user.email, name: user.name, business, inviter, inviteUrl });
    return { sent: true, inviteUrl };
  } catch (error) {
    console.error('staff invite email failed:', error.message);
    if (env.ENVIRONMENT !== 'production') return { sent: false, inviteUrl };
    await db.update(passwordResetTokens).set({ usedAt: now() }).where(eq(passwordResetTokens.id, id));
    return { sent: false, inviteUrl: null };
  }
}

export async function issueAccountActivation(db, env, user, origin, requestedIp = null) {
  const { id, rawToken } = await issueEmailToken(db, { user, purpose: 'activation', ttlMinutes: 24 * 60, requestedIp });
  const activationUrl = `${origin}/activate?token=${encodeURIComponent(rawToken)}`;
  try {
    await sendActivationEmail(env, { to: user.email, name: user.name, activationUrl });
    return { sent: true, activationUrl };
  } catch (error) {
    console.error('activation email failed:', error.message);
    // outside production the link is surfaced to the caller instead, so keep
    // the token alive for local testing without an inbox
    if (env.ENVIRONMENT !== 'production') return { sent: false, activationUrl };
    await db.update(passwordResetTokens).set({ usedAt: now() }).where(eq(passwordResetTokens.id, id));
    return { sent: false, activationUrl: null };
  }
}
