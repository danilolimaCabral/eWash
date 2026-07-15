// Password hashing (PBKDF2-SHA256) and JWT (HS256) on WebCrypto — no dependencies.

// Sentinel password hashes for accounts with no usable password — verifyPassword
// can never match them. Google-only accounts authenticate via Google; invited
// staff set their password when they accept the emailed invitation.
export const GOOGLE_ONLY_PASSWORD = 'google-only';
export const INVITED_PASSWORD = 'invited-pending';
export const hasUsablePassword = (hash) => ![GOOGLE_ONLY_PASSWORD, INVITED_PASSWORD].includes(hash);

const te = new TextEncoder();

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const b64urlDecode = (s) => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

const PBKDF2_ITER = 100_000;

async function pbkdf2(password, salt) {
  const key = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITER },
    key,
    256
  );
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await pbkdf2(password, salt);
  return `pbkdf2$${PBKDF2_ITER}$${b64url(salt)}$${b64url(bits)}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [, , saltB64, hashB64] = stored.split('$');
    const bits = new Uint8Array(await pbkdf2(password, b64urlDecode(saltB64)));
    const expected = b64urlDecode(hashB64);
    if (bits.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < bits.length; i++) diff |= bits[i] ^ expected[i];
    return diff === 0;
  } catch {
    return false;
  }
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signJwt(payload, secret, ttlSeconds = 60 * 60 * 24 * 7) {
  const header = b64url(te.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(te.encode(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttlSeconds })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), te.encode(`${header}.${body}`));
  return `${header}.${body}.${b64url(sig)}`;
}

export async function verifyJwt(token, secret) {
  const parts = (token || '').split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64urlDecode(sig), te.encode(`${header}.${body}`));
  if (!ok) return null;
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
