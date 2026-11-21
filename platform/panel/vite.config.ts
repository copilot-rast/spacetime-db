import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const target = process.env.STDB_TARGET ?? 'http://127.0.0.1:7500';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 7510,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      '/stdb': {
        target,
        ws: true,
        changeOrigin: true,
        rewrite: p => p.replace(/^\/stdb/, ''),
      },
    },
  },
});
