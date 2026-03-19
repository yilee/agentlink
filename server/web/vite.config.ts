import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import monacoEditor from 'vite-plugin-monaco-editor';

export default defineConfig({
  plugins: [
    vue(),
    (monacoEditor as any).default({
      languageWorkers: ['editorWorkerService', 'css', 'html', 'json', 'typescript'],
    }),
  ],
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
