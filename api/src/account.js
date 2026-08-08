import { and, eq, isNull, or } from 'drizzle-orm';
import { passwordResetTokens, users } from './db/schema.js';
import { issueEmailChangeVerification, passwordResetTokenHash } from './passwordReset.js';
import { ApiError, bad, now } from './util.js';
import { validEmail } from './security.js';

export async function requestEmailChange(db, env, user, rawEmail, origin, requestedIp = null) {
  const targetEmail = validEmail(rawEmail);
  if (targetEmail === user.email) bad('This is already the account email');

  const [conflict] = await db.select({ id: users.id }).from(users).where(or(
    eq(users.email, targetEmail),
    eq(users.pendingEmail, targetEmail),
  ));
  if (conflict && conflict.id !== user.id) bad('An account with this email already exists');

  await db.update(passwordResetTokens).set({ usedAt: now() }).where(and(
    eq(passwordResetTokens.userId, user.id),
    eq(passwordResetTokens.purpose, 'email_change'),
    isNull(passwordResetTokens.usedAt),
  ));
  await db.update(users).set({ pendingEmail: targetEmail }).where(eq(users.id, user.id));

  const result = await issueEmailChangeVerification(
    db, env, { ...user, pendingEmail: targetEmail }, targetEmail, origin, requestedIp,
  );
  if (!result.sent && env.ENVIRONMENT === 'production') {
    await db.update(users).set({ pendingEmail: user.pendingEmail || null }).where(eq(users.id, user.id));
    throw new ApiError(502, 'The verification email could not be sent');
  }
  return { ...result, targetEmail };
}

export async function findEmailChangeToken(db, token) {
  if (typeof token !== 'string' || token.length < 32) bad('Invalid or expired email verification link');
  const [row] = await db.select().from(passwordResetTokens).where(and(
    eq(passwordResetTokens.tokenHash, await passwordResetTokenHash(token)),
    eq(passwordResetTokens.purpose, 'email_change'),
    isNull(passwordResetTokens.usedAt),
  ));
  if (!row || row.expiresAt < now()) bad('Invalid or expired email verification link');
  const [user] = await db.select().from(users).where(eq(users.id, row.userId));
  if (!user || !user.pendingEmail || user.pendingEmail !== row.targetEmail) {
    bad('Invalid or expired email verification link');
  }
  return { row, user };
}
