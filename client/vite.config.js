import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    allowedHosts: [process.env.VITE_ALLOWED_HOSTS],
    proxy: {
      '/api': 'http://localhost:5000',
    },
  },
});
