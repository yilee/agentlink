import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 10000,
    hookTimeout: 10000,
    pool: 'forks',
    fileParallelism: false,
    exclude: ['**/node_modules/**', 'test/functional/**'],
    coverage: {
      provider: 'v8',
      include: ['server/src/**/*.ts', 'agent/src/**/*.ts'],
      exclude: ['**/node_modules/**', '**/dist/**', 'server/web/**'],
    },
  },
});
