import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    allowedHosts: ['.e2b.app', '.localhost'],
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:3000',
        changeOrigin: false,
      },
      '/health': {
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:3000',
        changeOrigin: false,
      },
      '/ready': {
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
});
