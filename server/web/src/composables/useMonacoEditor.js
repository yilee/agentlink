import { watch, onBeforeUnmount, shallowRef } from 'vue';

const EXT_TO_LANGUAGE = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  vue: 'html', html: 'html', htm: 'html', svelte: 'html',
  css: 'css', scss: 'scss', less: 'less',
  json: 'json', json5: 'json', jsonc: 'json',
  md: 'markdown', mdx: 'markdown',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
  yml: 'yaml', yaml: 'yaml',
  xml: 'xml', svg: 'xml',
  sql: 'sql',
  c: 'c', h: 'c',
  cpp: 'cpp', hpp: 'cpp', cc: 'cpp',
  cs: 'csharp',
  swift: 'swift',
  kt: 'kotlin',
  lua: 'lua',
  r: 'r',
  toml: 'ini', cfg: 'ini', ini: 'ini', conf: 'ini',
  ps1: 'powershell',
  bat: 'bat', cmd: 'bat',
  dockerfile: 'dockerfile',
  graphql: 'graphql',
  proto: 'protobuf',
  env: 'shell',
};

function detectLanguage(fileName) {
  if (!fileName) return 'plaintext';
  // Handle dotfiles like 'Dockerfile'
  const lower = fileName.toLowerCase();
  if (lower === 'dockerfile') return 'dockerfile';
  if (lower === 'makefile') return 'makefile';
  const ext = lower.split('.').pop();
  return EXT_TO_LANGUAGE[ext] || 'plaintext';
}

/**
 * Composable for managing a Monaco Editor instance.
 * Lazily loads Monaco on first use.
 *
 * @param {import('vue').Ref} theme - 'light' or 'dark' reactive ref
 * @param {object} options
 * @param {Function} options.onSave - Called when user presses Ctrl+S
 * @param {Function} options.onCancel - Called when user presses Esc
 * @returns {{ init, getContent, setContent, dispose, editorReady }}
 */
export function useMonacoEditor(theme, { onSave, onCancel } = {}) {
  let editor = null;
  let monaco = null;
  const editorReady = shallowRef(false);

  let stopThemeWatch = null;

  async function init(container, content, fileName) {
    if (!container) return;

    // Lazy load Monaco
    if (!monaco) {
      monaco = await import('monaco-editor');
    }

    // Dispose any existing instance
    if (editor) {
      editor.dispose();
      editor = null;
    }

    const language = detectLanguage(fileName);
    const monacoTheme = theme.value === 'dark' ? 'vs-dark' : 'vs';

    editor = monaco.editor.create(container, {
      value: content || '',
      language,
      theme: monacoTheme,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      tabSize: 2,
      renderWhitespace: 'selection',
      folding: true,
      bracketPairColorization: { enabled: true },
    });

    // Ctrl+S → save
    if (onSave) {
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        onSave();
      });
    }

    // Esc → cancel
    if (onCancel) {
      editor.addCommand(monaco.KeyCode.Escape, () => {
        onCancel();
      });
    }

    // Watch theme changes
    if (stopThemeWatch) stopThemeWatch();
    stopThemeWatch = watch(theme, (newTheme) => {
      if (monaco) {
        monaco.editor.setTheme(newTheme === 'dark' ? 'vs-dark' : 'vs');
      }
    });

    editorReady.value = true;
  }

  function getContent() {
    return editor ? editor.getValue() : '';
  }

  function setContent(content) {
    if (editor) {
      editor.setValue(content || '');
    }
  }

  function dispose() {
    if (stopThemeWatch) {
      stopThemeWatch();
      stopThemeWatch = null;
    }
    if (editor) {
      editor.dispose();
      editor = null;
    }
    editorReady.value = false;
  }

  onBeforeUnmount(() => {
    dispose();
  });

  return { init, getContent, setContent, dispose, editorReady };
}
