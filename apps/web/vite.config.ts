import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const server = process.env.BB_SERVER ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  server: {
    proxy: {
      '/api': server,
      '/dev': server,
      '/ws': { target: server.replace(/^http/, 'ws'), ws: true },
    },
  },
});
