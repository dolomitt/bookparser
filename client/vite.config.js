import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

console.log('VITE_ALLOWED_HOSTS:', import.meta.env.VITE_ALLOWED_HOSTS);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    allowedHosts: [import.meta.env.VITE_ALLOWED_HOSTS],
    proxy: {
      '/api': 'http://localhost:5000',
    },
  },
});
