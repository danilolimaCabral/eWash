import { defineStore } from 'pinia';
import { platformApi, platformTokenStore } from '../platformApi.js';

export const usePlatformSession = defineStore('platformSession', {
  state: () => ({ token: platformTokenStore.token, me: null }),
  getters: {
    isAuthed: (state) => !!state.token,
    user: (state) => state.me?.user || null,
    can: (state) => (policy) => (state.me?.policies || []).includes(policy),
  },
  actions: {
    async login(email, password) {
      const pair = await platformApi.post('/auth/login', { email, password });
      platformTokenStore.set(pair);
      this.token = pair.token;
      await this.loadMe();
    },
    async loadMe() { this.me = await platformApi.get('/me'); },
    async logout() {
      try { await platformApi.post('/auth/logout', { refresh_token: platformTokenStore.refreshToken }); } catch { /* best effort */ }
      platformTokenStore.clear();
      this.token = null;
      this.me = null;
    },
  },
});
