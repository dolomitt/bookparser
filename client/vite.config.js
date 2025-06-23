import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Load env variables for the current mode from .env files
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  // Log to verify loading
  console.log('VITE_ALLOWED_HOSTS:', env.VITE_ALLOWED_HOSTS);

  return {
    plugins: [react()],
    server: {
      port: 5173,
      host: '0.0.0.0',
      allowedHosts: [env.VITE_ALLOWED_HOSTS],
      proxy: {
        '/api': 'http://localhost:5000',
      },
    },
    define: {
      __APP_ENV__: JSON.stringify(env.APP_ENV), // example of custom env usage
    },
  };
});
