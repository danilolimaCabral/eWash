import { defineStore } from 'pinia';
import { api, tokenStore } from '../api.js';

const LOCK_KEY = 'lavtr_locked';

export const useSession = defineStore('session', {
  state: () => ({
    token: tokenStore.token,
    me: null,
    loading: false,
    locked: localStorage.getItem(LOCK_KEY) === '1', // survives refresh — no bypass
  }),
  getters: {
    isAuthed: (s) => !!s.token,
    user: (s) => s.me?.user || null,
    tenant: (s) => s.me?.tenant || null,
    role: (s) => s.me?.role || null,
    branches: (s) => s.me?.branches || [],
    currency: (s) => s.me?.tenant?.currency || 'BRL',
    policyCatalog: (s) => s.me?.policyCatalog || [],
    can: (s) => (key) => (s.me?.policies || []).includes(key),
  },
  actions: {
    setTokens(pair) {
      tokenStore.set(pair);
      this.token = pair.token;
    },
    async loadMe() {
      this.loading = true;
      try {
        this.me = await api.get('/me');
      } finally {
        this.loading = false;
      }
    },
    async login(email, password) {
      this.setTokens(await api.post('/auth/login', { email, password }));
      this.unlock();
      await this.loadMe();
    },
    // Registration no longer signs in — the account goes live via the emailed
    // activation link (see /activate). Returns { message, activation_url? (dev) }.
    async register(payload) {
      return api.post('/auth/register', payload);
    },
    // Idle lock: shown after inactivity; cleared only by a server-verified
    // password check or a full logout.
    lock() {
      this.locked = true;
      localStorage.setItem(LOCK_KEY, '1');
    },
    unlock() {
      this.locked = false;
      localStorage.removeItem(LOCK_KEY);
    },
    async unlockWithPassword(password) {
      await api.post('/auth/unlock', { password });
      this.unlock();
    },
    async logout() {
      const refresh_token = tokenStore.refreshToken;
      try {
        if (refresh_token) await api.post('/auth/logout', { refresh_token });
      } catch { /* revocation is best-effort from the client */ }
      this.token = null;
      this.me = null;
      this.unlock();
      tokenStore.clear();
    },
  },
});
