const BASE = '/api/platform';
const TOKEN_KEY = 'lavtr_platform_token';
const REFRESH_KEY = 'lavtr_platform_refresh';

export const platformTokenStore = {
  get token() { return localStorage.getItem(TOKEN_KEY); },
  get refreshToken() { return localStorage.getItem(REFRESH_KEY); },
  set(pair) {
    localStorage.setItem(TOKEN_KEY, pair.token);
    if (pair.refresh_token) localStorage.setItem(REFRESH_KEY, pair.refresh_token);
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

let refreshing = null;
async function refresh() {
  refreshing ??= fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: platformTokenStore.refreshToken }),
  }).then(async (res) => {
    if (!res.ok) return false;
    platformTokenStore.set(await res.json());
    return true;
  }).finally(() => { refreshing = null; });
  return refreshing;
}

async function request(method, path, body, retried = false) {
  const headers = {};
  if (platformTokenStore.token) headers.Authorization = `Bearer ${platformTokenStore.token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && !path.startsWith('/auth/') && !retried && await refresh()) {
    return request(method, path, body, true);
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try { message = (await res.json()).error || message; } catch { /* use status */ }
    throw new Error(message);
  }
  return res.status === 204 ? null : res.json();
}

export const platformApi = {
  get: (path) => request('GET', path),
  post: (path, body = {}) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
};
