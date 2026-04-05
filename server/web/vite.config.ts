import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import monacoEditor from 'vite-plugin-monaco-editor';

/**
 * Patch virtua sub-pixel positioning at build time.
 * virtua places items at float offsets (e.g. top: 347.5px) which causes
 * inconsistent font rasterization on iOS Safari. Round to nearest integer.
 */
function virtuaSubpixelFix(): Plugin {
  return {
    name: 'virtua-subpixel-fix',
    transform(code, id) {
      if (!id.includes('virtua') || !id.includes('vue')) return;
      const before = '[r ? "left" : "top"]: c.value + "px"';
      if (!code.includes(before)) return;
      return code.replace(before, '[r ? "left" : "top"]: Math.round(c.value) + "px"');
    },
  };
}

export default defineConfig({
  plugins: [
    vue(),
    virtuaSubpixelFix(),
    (monacoEditor as any).default({
      languageWorkers: ['editorWorkerService', 'css', 'html', 'json', 'typescript'],
    }),
  ],
  base: './',
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
