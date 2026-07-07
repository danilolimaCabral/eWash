import { eq } from 'drizzle-orm';
import { passwordResetTokens } from './db/schema.js';
import { sendPasswordResetEmail } from './smtp.js';
import { now, uid } from './util.js';

export const passwordResetTokenHash = async (token) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export async function issuePasswordReset(db, env, user, requestedIp = null) {
  const rawToken = randomToken();
  const id = uid();
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString().slice(0, 19).replace('T', ' ');
  await db.insert(passwordResetTokens).values({
    id, userId: user.id, tokenHash: await passwordResetTokenHash(rawToken),
    expiresAt, requestedIp,
  });
  try {
    const appUrl = (env.APP_URL || 'https://ewash.qesuite.com').replace(/\/+$/, '');
    await sendPasswordResetEmail(env, {
      to: user.email, name: user.name,
      resetUrl: `${appUrl}/reset-password?token=${encodeURIComponent(rawToken)}`,
    });
    return true;
  } catch (error) {
    console.error('password reset email failed:', error.message);
    await db.update(passwordResetTokens).set({ usedAt: now() }).where(eq(passwordResetTokens.id, id));
    return false;
  }
}
