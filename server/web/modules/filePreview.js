// ── File Preview: panel state, content rendering, resize handle ────────

/**
 * Creates the file preview controller.
 * @param {object} deps - Reactive state and callbacks
 */
export function createFilePreview(deps) {
  const {
    wsSend,
    previewPanelOpen,
    previewPanelWidth,
    previewFile,
    previewLoading,
  } = deps;

  // ── Open / Close ──

  function openPreview(filePath) {
    // Skip re-fetch if same file already loaded
    if (previewFile.value && previewFile.value.filePath === filePath && !previewFile.value.error) {
      previewPanelOpen.value = true;
      return;
    }
    previewPanelOpen.value = true;
    previewLoading.value = true;
    previewFile.value = null;
    wsSend({ type: 'read_file', filePath });
  }

  function closePreview() {
    previewPanelOpen.value = false;
  }

  // ── Handle file_content response ──

  function handleFileContent(msg) {
    previewLoading.value = false;
    previewFile.value = {
      filePath: msg.filePath,
      fileName: msg.fileName,
      content: msg.content,
      encoding: msg.encoding,
      mimeType: msg.mimeType,
      truncated: msg.truncated,
      totalSize: msg.totalSize,
      error: msg.error || null,
    };
  }

  // ── Workdir changed → close preview ──

  function onWorkdirChanged() {
    previewPanelOpen.value = false;
    previewFile.value = null;
    previewLoading.value = false;
  }

  // ── Syntax highlighting helpers ──

  const LANG_MAP = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    mjs: 'javascript', cjs: 'javascript', py: 'python', rb: 'ruby',
    rs: 'rust', go: 'go', java: 'java', c: 'c', h: 'c',
    cpp: 'cpp', hpp: 'cpp', cs: 'csharp', swift: 'swift', kt: 'kotlin',
    lua: 'lua', r: 'r', sql: 'sql', sh: 'bash', bash: 'bash', zsh: 'bash',
    fish: 'bash', ps1: 'powershell', bat: 'dos', cmd: 'dos',
    json: 'json', json5: 'json', yaml: 'yaml', yml: 'yaml', toml: 'ini',
    xml: 'xml', html: 'xml', htm: 'xml', css: 'css', scss: 'scss', less: 'less',
    md: 'markdown', txt: 'plaintext', log: 'plaintext', graphql: 'graphql',
    proto: 'protobuf', vue: 'xml', svelte: 'xml', ini: 'ini', cfg: 'ini',
    conf: 'ini', env: 'bash',
  };

  function detectLanguage(fileName) {
    const ext = (fileName || '').split('.').pop()?.toLowerCase();
    return LANG_MAP[ext] || ext || 'plaintext';
  }

  function highlightCode(code, fileName) {
    if (!code) return '';
    if (!window.hljs) return escapeHtml(code);
    const lang = detectLanguage(fileName);
    try {
      return window.hljs.highlight(code, { language: lang }).value;
    } catch {
      try {
        return window.hljs.highlightAuto(code).value;
      } catch {
        return escapeHtml(code);
      }
    }
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── File size formatting ──

  function formatFileSize(bytes) {
    if (bytes == null) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // ── Resize handle (mouse + touch) ──

  let _resizing = false;
  let _startX = 0;
  let _startWidth = 0;
  const MIN_WIDTH = 200;
  const MAX_WIDTH = 800;

  function onResizeStart(e) {
    e.preventDefault();
    _resizing = true;
    _startX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
    _startWidth = previewPanelWidth.value;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    if (e.type === 'touchstart') {
      document.addEventListener('touchmove', onResizeMove, { passive: false });
      document.addEventListener('touchend', onResizeEnd);
    } else {
      document.addEventListener('mousemove', onResizeMove);
      document.addEventListener('mouseup', onResizeEnd);
    }
  }

  function onResizeMove(e) {
    if (!_resizing) return;
    if (e.type === 'touchmove') e.preventDefault();
    const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
    // Left edge resize: dragging left = wider, dragging right = narrower
    const delta = _startX - clientX;
    const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, _startWidth + delta));
    previewPanelWidth.value = newWidth;
  }

  function onResizeEnd() {
    if (!_resizing) return;
    _resizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeEnd);
    document.removeEventListener('touchmove', onResizeMove);
    document.removeEventListener('touchend', onResizeEnd);
    localStorage.setItem('agentlink-preview-panel-width', String(previewPanelWidth.value));
  }

  return {
    openPreview,
    closePreview,
    handleFileContent,
    onWorkdirChanged,
    detectLanguage,
    highlightCode,
    formatFileSize,
    onResizeStart,
  };
}
