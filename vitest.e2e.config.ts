import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 20000,
    pool: 'forks',
    fileParallelism: false,
    include: ['test/functional/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
  },
});
