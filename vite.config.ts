import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { zupirusApiPlugin } from './web/devApiPlugin.ts';

export default defineConfig(() => {
  const useFixtures = process.env.ZUPIRUS_UI_FIXTURES !== '0' && !process.env.VITE_BACKEND_URL;
  const backendUrl = process.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000';
  const proxyConfig = {
    '/api': {
      target: backendUrl,
      changeOrigin: true,
    },
    '/healthz': {
      target: backendUrl,
      changeOrigin: true,
    },
    '/readyz': {
      target: backendUrl,
      changeOrigin: true,
    },
  };

  return {
    root: 'web',
    publicDir: 'public',
    plugins: [useFixtures && zupirusApiPlugin(), react(), tailwindcss()],
    server: {
      port: 3000,
      host: '0.0.0.0',
      allowedHosts: true,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy: proxyConfig,
    },
    preview: {
      port: 3000,
      host: '0.0.0.0',
      allowedHosts: true,
      proxy: proxyConfig,
    },
    build: {
      outDir: '../dist',
      emptyOutDir: true,
    },
  };
});
