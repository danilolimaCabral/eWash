import { defineStore } from 'pinia';
import { api } from '../api.js';

const TTL_MS = 60_000;

// Client-side catalog cache: New Order and the Service Builder share one
// fetch; builder saves invalidate it. Keyed by scope (active vs all).
export const useCatalog = defineStore('catalog', {
  state: () => ({
    data: { active: null, all: null },
    fetchedAt: { active: 0, all: 0 },
  }),
  actions: {
    async load(includeInactive = false) {
      const key = includeInactive ? 'all' : 'active';
      const fresh = Date.now() - this.fetchedAt[key] < TTL_MS;
      if (this.data[key] && fresh) return this.data[key];
      const result = await api.get(includeInactive ? '/catalog?all=1' : '/catalog');
      this.data[key] = result;
      this.fetchedAt[key] = Date.now();
      return result;
    },
    invalidate() {
      this.data = { active: null, all: null };
      this.fetchedAt = { active: 0, all: 0 };
    },
  },
});
