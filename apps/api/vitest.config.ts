import { defineConfig } from 'vitest/config';

const testDb = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/voll_connect_test';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      DATABASE_URL: testDb,
      TEST_DATABASE_URL: testDb,
      JWT_SECRET: 'test-secret',
      NODE_ENV: 'test',
    },
  },
});
