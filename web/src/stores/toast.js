import { defineStore } from 'pinia';

let seq = 0;

export const useToast = defineStore('toast', {
  state: () => ({ items: [] }),
  actions: {
    show(message, kind = 'info', ttl = 3800) {
      const id = ++seq;
      this.items.push({ id, message, kind });
      setTimeout(() => this.dismiss(id), ttl);
    },
    success(message) { this.show(message, 'success'); },
    error(message) { this.show(message, 'error', 5200); },
    dismiss(id) {
      this.items = this.items.filter((t) => t.id !== id);
    },
  },
});
