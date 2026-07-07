import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// The app always runs as ONE service: the Cloudflare Worker serves this build
// from web/dist and handles /api/* itself (`bun start`). If the vite dev
// server is ever used for HMR, it proxies /api to the worker — the frontend
// origin always fronts the backend; there is never a second public service.
export default defineConfig({
  plugins: [vue()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    proxy: { '/api': 'http://localhost:8787' },
  },
});
