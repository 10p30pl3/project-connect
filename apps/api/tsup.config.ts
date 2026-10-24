import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/worker.ts', 'src/db/migrate.ts', 'src/db/seed.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  // o pacote de contratos é TypeScript-fonte: embutir no bundle
  noExternal: ['@voll/shared'],
});
