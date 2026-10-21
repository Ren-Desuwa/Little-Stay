import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:' + (process.env.API_PORT ?? '3001') },
      '/uploads': { target: 'http://127.0.0.1:' + (process.env.API_PORT ?? '3001') },
    },
  },
  preview: {
    proxy: {
      '/api': 'http://127.0.0.1:' + (process.env.API_PORT ?? '3001'),
      '/uploads': 'http://127.0.0.1:' + (process.env.API_PORT ?? '3001'),
    },
  },
});
