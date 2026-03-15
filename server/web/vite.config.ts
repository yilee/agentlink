import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3456',
      '/ws': { target: 'ws://localhost:3456', ws: true },
    },
  },
});
