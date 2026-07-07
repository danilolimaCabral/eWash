// Production-hardening helpers: secret strength enforcement, input clamps,
// and format validators. Assume every caller-supplied value is hostile.
import { ApiError, bad } from './util.js';

const DEV_SECRET = 'dev-secret-change-me-in-production';

// In production the worker refuses to run with a missing/dev/short JWT secret —
// a forgeable session token is a full-tenant compromise.
export function assertProdSecrets(env) {
  if (env.ENVIRONMENT !== 'production') return;
  if (!env.JWT_SECRET || env.JWT_SECRET === DEV_SECRET || env.JWT_SECRET.length < 32) {
    console.error('FATAL: production requires a strong JWT_SECRET (bun run deploy sets one)');
    throw new ApiError(503, 'Server is not configured securely. Contact the administrator.');
  }
}

// Timing-safe string comparison for callback tokens.
export function safeEqual(a, b) {
  const ta = new TextEncoder().encode(String(a || ''));
  const tb = new TextEncoder().encode(String(b || ''));
  if (ta.length !== tb.length || ta.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < ta.length; i++) diff |= ta[i] ^ tb[i];
  return diff === 0;
}

// ---- input clamps ----
export const LIMITS = {
  name: 120,
  email: 254,
  phone: 24,
  note: 500,
  password: 128, // PBKDF2 over unbounded input is a CPU-DoS vector
  maxQty: 10_000,
  maxMoneyCents: 100_000_000_00, // 100M KES — sanity ceiling for any single amount
};

export function cleanStr(value, max, field) {
  if (value == null) return null;
  if (typeof value !== 'string') bad(`${field} must be text`);
  const v = value.trim();
  if (v.length > max) bad(`${field} is too long (max ${max} characters)`);
  return v;
}

export function checkQty(qty, field = 'Quantity') {
  if (!(typeof qty === 'number' && Number.isFinite(qty) && qty > 0 && qty <= LIMITS.maxQty)) {
    bad(`${field} must be between 0 and ${LIMITS.maxQty}`);
  }
}

export function checkMoney(cents, field = 'Amount') {
  if (!(Number.isFinite(cents) && cents >= 0 && cents <= LIMITS.maxMoneyCents)) {
    bad(`${field} is out of range`);
  }
}

export function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) bad('Password must be at least 8 characters');
  if (pw.length > LIMITS.password) bad(`Password is too long (max ${LIMITS.password} characters)`);
}


// Strict email check — also blocks CR/LF/whitespace so an email can never
// smuggle SMTP commands or extra headers into outbound mail.
export function validEmail(value, field = 'Email') {
  const v = cleanStr(value, LIMITS.email, field);
  if (!v || !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(v)) bad(`${field} is not a valid email address`);
  return v.toLowerCase();
}

// ---- format validators for query params used in SQL LIKE/eq ----
export function validMonth(m, fallback) {
  if (m == null || m === '') return fallback;
  if (!/^\d{4}-\d{2}$/.test(m)) bad('month must be YYYY-MM');
  return m;
}

export function validDate(d, fallback) {
  if (d == null || d === '') return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) bad('date must be YYYY-MM-DD');
  return d;
}
