import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

function versionManifestPlugin(builtAt: string): Plugin {
  const version = process.env.VITE_APP_VERSION || builtAt.replace(/[:.]/g, '-');
  return {
    name: 'voll-version-manifest',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version, builtAt }, null, 2),
      });
    },
  };
}

const builtAtIso = process.env.VITE_BUILD_DATE || new Date().toISOString();

export default defineConfig({
  define: {
    __APP_BUILT_AT__: JSON.stringify(builtAtIso),
  },
  plugins: [react(), tailwindcss(), versionManifestPlugin(builtAtIso)],
  build: {
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          vendor: ['@tanstack/react-query', '@tanstack/react-table', 'react-hook-form', '@hookform/resolvers', 'zod'],
          radix: ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-tabs'],
          icons: ['lucide-react'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3333',
        changeOrigin: true,
      },
    },
  },
});
