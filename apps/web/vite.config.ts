import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          vendor: ['@tanstack/react-query', '@tanstack/react-table', 'react-hook-form', '@hookform/resolvers', 'zod'],
          radix: ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-tabs'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:3333', changeOrigin: false },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:3333', changeOrigin: false },
    },
  },
});
