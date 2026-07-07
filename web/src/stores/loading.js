import { defineStore } from 'pinia';

// Counts in-flight API requests; drives the global top loading bar so every
// action gives immediate visual feedback.
export const useLoading = defineStore('loading', {
  state: () => ({ pending: 0 }),
  getters: {
    active: (s) => s.pending > 0,
  },
  actions: {
    start() { this.pending++; },
    done() { this.pending = Math.max(0, this.pending - 1); },
  },
});
