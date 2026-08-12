// Same-origin API client — the Worker that serves this SPA also serves /api/*.
// Access tokens are short-lived; on 401 the client transparently rotates the
// refresh token once and retries, so users only re-authenticate when their
// session is truly revoked or expired.
const BASE = '/api';

const TOKEN_KEY = 'lavtr_token';
const REFRESH_KEY = 'lavtr_refresh';

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export const tokenStore = {
  get token() { return localStorage.getItem(TOKEN_KEY); },
  get refreshToken() { return localStorage.getItem(REFRESH_KEY); },
  set({ token, refresh_token }) {
    localStorage.setItem(TOKEN_KEY, token);
    if (refresh_token) localStorage.setItem(REFRESH_KEY, refresh_token);
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let refreshing = null; // single-flight: concurrent 401s share one refresh

async function refreshTokens() {
  refreshing ??= (async () => {
    const refresh_token = tokenStore.refreshToken;
    if (!refresh_token) return false;
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token }),
    });
    if (!res.ok) return false;
    tokenStore.set(await res.json());
    return true;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

async function rawRequest(method, path, body) {
  const headers = {};
  if (tokenStore.token) headers.Authorization = `Bearer ${tokenStore.token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// The loading store is registered lazily (pinia isn't ready at module load).
let loadingHooks = { start: () => {}, done: () => {} };
export const setLoadingHooks = (hooks) => { loadingHooks = hooks; };

async function request(method, path, body) {
  loadingHooks.start();
  try {
    let res = await rawRequest(method, path, body);
    if (res.status === 401 && !path.startsWith('/auth/')) {
      if (await refreshTokens()) res = await rawRequest(method, path, body);
      else onUnauthorized();
    }
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized();
    if (!res.ok) {
      let msg = `Request failed (${res.status})`;
      try { msg = (await res.json()).error || msg; } catch { /* keep default */ }
      throw new ApiError(res.status, msg);
    }
    return res.status === 204 ? null : res.json();
  } finally {
    loadingHooks.done();
  }
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body ?? {}),
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
  delete: (path) => request('DELETE', path),
};
