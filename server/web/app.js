const { createApp, ref, nextTick, onMounted, onUnmounted, computed, watch } = Vue;
import { encrypt, decrypt, isEncrypted, decodeKey } from './encryption.js';

// ── Markdown setup ──────────────────────────────────────────────────────────
if (typeof marked !== 'undefined') {
  marked.setOptions({
    breaks: true,
    gfm: true,
    highlight: function(code, lang) {
      if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
        try { return hljs.highlight(code, { language: lang }).value; } catch {}
      }
      return code;
    },
  });
}

const _mdCache = new Map();

function renderMarkdown(text) {
  if (!text) return '';
  const cached = _mdCache.get(text);
  if (cached) return cached;
  let html;
  try {
    if (typeof marked !== 'undefined') {
      html = marked.parse(text);
      // Add copy buttons to code blocks
      html = html.replace(/<pre><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g,
        (match, attrs, code) => {
          const langMatch = attrs.match(/class="language-(\w+)"/);
          const lang = langMatch ? langMatch[1] : '';
          return `<div class="code-block-wrapper">
            <div class="code-block-header">
              <span class="code-lang">${lang}</span>
              <button class="code-copy-btn" onclick="window.__copyCodeBlock(this)" title="Copy">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
              </button>
            </div>
            <pre><code${attrs}>${code}</code></pre>
          </div>`;
        }
      );
    } else {
      html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  } catch {
    html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  // Only cache completed (non-streaming) messages; streaming text changes every tick
  if (_mdCache.size > 500) _mdCache.clear();
  _mdCache.set(text, html);
  return html;
}

// Global code copy handler
window.__copyCodeBlock = async function(btn) {
  const wrapper = btn.closest('.code-block-wrapper');
  const code = wrapper?.querySelector('code');
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code.textContent);
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
    setTimeout(() => {
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
    }, 2000);
  } catch {}
};

// Tool icons (monochrome SVG)
const TOOL_SVG = {
  Read:      '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M1 2.5A2.5 2.5 0 0 1 3.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75H3.5a1 1 0 0 0-1 1h9.25a.75.75 0 0 1 0 1.5H3.5A2.5 2.5 0 0 1 1 14V2.5zm3 0v7l1.5-1.25L7 9.5v-7H4z"/></svg>',
  Edit:      '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25a1.75 1.75 0 0 1 .445-.758l8.61-8.61zM11.524 2.2l-8.61 8.61a.25.25 0 0 0-.064.108l-.57 1.996 1.996-.57a.25.25 0 0 0 .108-.064l8.61-8.61a.25.25 0 0 0 0-.354l-1.086-1.086a.25.25 0 0 0-.354 0z"/></svg>',
  Write:     '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M8.75 1.75a.75.75 0 0 0-1.5 0V6H2.75a.75.75 0 0 0 0 1.5H7.25v4.25a.75.75 0 0 0 1.5 0V7.5h4.25a.75.75 0 0 0 0-1.5H8.75V1.75z"/></svg>',
  Bash:      '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25V2.75zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25H1.75zM7 11a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 0 1.5h-3.5A.75.75 0 0 1 7 11zm-3.22-4.53a.75.75 0 0 1 1.06 0l2 2a.75.75 0 0 1 0 1.06l-2 2a.75.75 0 0 1-1.06-1.06L5.25 9 3.78 7.53a.75.75 0 0 1 0-1.06z"/></svg>',
  Glob:      '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 1 1-1.06 1.06l-3.04-3.04zM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7z"/></svg>',
  Grep:      '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 1 1-1.06 1.06l-3.04-3.04zM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7z"/></svg>',
  Task:      '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25V2.75C0 1.784.784 1 1.75 1zm0 1.5a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25H1.75zM3.5 5h9v1.5h-9V5zm0 3h9v1.5h-9V8zm0 3h5v1.5h-5V11z"/></svg>',
  WebFetch:  '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zm3.7 5.3a.75.75 0 0 0-1.06-1.06l-5.5 5.5a.75.75 0 1 0 1.06 1.06l5.5-5.5zM8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z"/></svg>',
  WebSearch: '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zm3.7 5.3a.75.75 0 0 0-1.06-1.06l-5.5 5.5a.75.75 0 1 0 1.06 1.06l5.5-5.5zM8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z"/></svg>',
  TodoWrite: '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 1.042-1.08L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z"/></svg>',
};
const TOOL_SVG_DEFAULT = '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M7.429 1.525a3.751 3.751 0 0 1 4.41.899l.04.045a.75.75 0 0 1-.17 1.143l-2.2 1.378a1.25 1.25 0 0 0-.473 1.58l.614 1.341a1.25 1.25 0 0 0 1.412.663l2.476-.542a.75.75 0 0 1 .848.496 3.75 3.75 0 0 1-1.468 4.155 3.751 3.751 0 0 1-4.41-.898l-.04-.046a.75.75 0 0 1 .17-1.142l2.2-1.378a1.25 1.25 0 0 0 .473-1.58l-.614-1.342a1.25 1.25 0 0 0-1.412-.662l-2.476.541a.75.75 0 0 1-.848-.496 3.75 3.75 0 0 1 1.468-4.155z"/></svg>';
function getToolIcon(name) { return TOOL_SVG[name] || TOOL_SVG_DEFAULT; }

// ── Helpers ─────────────────────────────────────────────────────────────────
const CONTEXT_SUMMARY_PREFIX = 'This session is being continued from a previous conversation';

function isContextSummary(text) {
  return typeof text === 'string' && text.trimStart().startsWith(CONTEXT_SUMMARY_PREFIX);
}

function formatRelativeTime(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

// ── App ─────────────────────────────────────────────────────────────────────
const App = {
  setup() {
    const status = ref('Connecting...');
    const agentName = ref('');
    const hostname = ref('');
    const workDir = ref('');
    const sessionId = ref('');
    const error = ref('');
    const messages = ref([]);
    const visibleLimit = ref(50);
    const hasMoreMessages = computed(() => messages.value.length > visibleLimit.value);
    const visibleMessages = computed(() => {
      if (messages.value.length <= visibleLimit.value) return messages.value;
      return messages.value.slice(messages.value.length - visibleLimit.value);
    });
    function loadMoreMessages() {
      visibleLimit.value += 50;
    }
    const inputText = ref('');
    const isProcessing = ref(false);
    const isCompacting = ref(false);
    const inputRef = ref(null);

    // Sidebar state
    const sidebarOpen = ref(window.innerWidth > 768);
    const historySessions = ref([]);
    const currentClaudeSessionId = ref(null);
    const needsResume = ref(false);
    const loadingSessions = ref(false);
    const loadingHistory = ref(false);

    // Folder picker state
    const folderPickerOpen = ref(false);
    const folderPickerPath = ref('');
    const folderPickerEntries = ref([]);
    const folderPickerLoading = ref(false);
    const folderPickerSelected = ref('');

    // File attachment state
    const attachments = ref([]);
    const fileInputRef = ref(null);
    const dragOver = ref(false);

    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    const MAX_FILES = 5;
    const ACCEPTED_EXTENSIONS = [
      '.pdf', '.json', '.md', '.py', '.js', '.ts', '.tsx', '.jsx', '.css',
      '.html', '.xml', '.yaml', '.yml', '.toml', '.sh', '.sql', '.csv',
      '.c', '.cpp', '.h', '.hpp', '.java', '.go', '.rs', '.rb', '.php',
      '.swift', '.kt', '.scala', '.r', '.m', '.vue', '.svelte', '.txt',
      '.log', '.cfg', '.ini', '.env', '.gitignore', '.dockerfile',
    ];

    function isAcceptedFile(file) {
      if (file.type.startsWith('image/')) return true;
      if (file.type.startsWith('text/')) return true;
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      return ACCEPTED_EXTENSIONS.includes(ext);
    }

    function formatFileSize(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function readFileAsBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          // result is "data:<mime>;base64,<data>" — extract just the base64 part
          const base64 = reader.result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    async function addFiles(fileList) {
      const currentCount = attachments.value.length;
      const remaining = MAX_FILES - currentCount;
      if (remaining <= 0) return;

      const files = Array.from(fileList).slice(0, remaining);
      for (const file of files) {
        if (!isAcceptedFile(file)) continue;
        if (file.size > MAX_FILE_SIZE) continue;
        // Skip duplicates
        if (attachments.value.some(a => a.name === file.name && a.size === file.size)) continue;

        const data = await readFileAsBase64(file);
        const isImage = file.type.startsWith('image/');
        let thumbUrl = null;
        if (isImage) {
          thumbUrl = URL.createObjectURL(file);
        }
        attachments.value.push({
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          data,
          isImage,
          thumbUrl,
        });
      }
    }

    function removeAttachment(index) {
      const att = attachments.value[index];
      if (att.thumbUrl) URL.revokeObjectURL(att.thumbUrl);
      attachments.value.splice(index, 1);
    }

    function triggerFileInput() {
      if (fileInputRef.value) fileInputRef.value.click();
    }

    function handleFileSelect(e) {
      if (e.target.files) addFiles(e.target.files);
      e.target.value = ''; // reset so same file can be selected again
    }

    function handleDragOver(e) {
      e.preventDefault();
      dragOver.value = true;
    }

    function handleDragLeave(e) {
      e.preventDefault();
      dragOver.value = false;
    }

    function handleDrop(e) {
      e.preventDefault();
      dragOver.value = false;
      if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
    }

    function handlePaste(e) {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files = [];
      for (const item of items) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        addFiles(files);
      }
    }

    // Theme state
    const theme = ref(localStorage.getItem('agentlink-theme') || 'dark');
    function applyTheme() {
      document.documentElement.setAttribute('data-theme', theme.value);
      const link = document.getElementById('hljs-theme');
      if (link) link.href = theme.value === 'light'
        ? 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css'
        : 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css';
    }
    function toggleTheme() {
      theme.value = theme.value === 'dark' ? 'light' : 'dark';
      localStorage.setItem('agentlink-theme', theme.value);
      applyTheme();
    }
    applyTheme();

    let ws = null;
    let sessionKey = null;
    let messageIdCounter = 0;
    let streamingMessageId = null;

    function wsSend(msg) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (sessionKey) {
        const encrypted = encrypt(msg, sessionKey);
        ws.send(JSON.stringify(encrypted));
      } else {
        ws.send(JSON.stringify(msg));
      }
    }

    // Progressive text reveal state
    let pendingText = '';
    let revealTimer = null;
    const CHARS_PER_TICK = 5;
    const TICK_MS = 16;

    function startReveal() {
      if (revealTimer !== null) return;
      revealTimer = setTimeout(revealTick, TICK_MS);
    }

    function revealTick() {
      revealTimer = null;
      if (!pendingText) return;

      const streamMsg = streamingMessageId !== null
        ? messages.value.find(m => m.id === streamingMessageId)
        : null;

      if (!streamMsg) {
        const id = ++messageIdCounter;
        const chunk = pendingText.slice(0, CHARS_PER_TICK);
        pendingText = pendingText.slice(CHARS_PER_TICK);
        messages.value.push({
          id, role: 'assistant', content: chunk,
          isStreaming: true, timestamp: new Date(),
        });
        streamingMessageId = id;
      } else {
        const chunk = pendingText.slice(0, CHARS_PER_TICK);
        pendingText = pendingText.slice(CHARS_PER_TICK);
        streamMsg.content += chunk;
      }
      scrollToBottom();
      if (pendingText) revealTimer = setTimeout(revealTick, TICK_MS);
    }

    function flushReveal() {
      if (revealTimer !== null) { clearTimeout(revealTimer); revealTimer = null; }
      if (!pendingText) return;
      const streamMsg = streamingMessageId !== null
        ? messages.value.find(m => m.id === streamingMessageId) : null;
      if (streamMsg) {
        streamMsg.content += pendingText;
      } else {
        const id = ++messageIdCounter;
        messages.value.push({
          id, role: 'assistant', content: pendingText,
          isStreaming: true, timestamp: new Date(),
        });
        streamingMessageId = id;
      }
      pendingText = '';
      scrollToBottom();
    }

    const canSend = computed(() =>
      status.value === 'Connected' && (inputText.value.trim() || attachments.value.length > 0) && !isProcessing.value && !isCompacting.value
      && !messages.value.some(m => m.role === 'ask-question' && !m.answered)
    );

    function getSessionId() {
      const match = window.location.pathname.match(/^\/s\/([^/]+)/);
      return match ? match[1] : null;
    }

    let _scrollTimer = null;
    let _userScrolledUp = false;

    function onMessageListScroll(e) {
      const el = e.target;
      // Consider "at bottom" if within 80px of the bottom
      _userScrolledUp = (el.scrollHeight - el.scrollTop - el.clientHeight) > 80;
    }

    function scrollToBottom(force) {
      if (_userScrolledUp && !force) return;
      if (_scrollTimer) return;
      _scrollTimer = setTimeout(() => {
        _scrollTimer = null;
        const el = document.querySelector('.message-list');
        if (el) el.scrollTop = el.scrollHeight;
      }, 50);
    }

    // ── Auto-resize textarea ──
    function autoResize() {
      const ta = inputRef.value;
      if (ta) {
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
      }
    }

    function sendMessage() {
      if (!canSend.value) return;

      const text = inputText.value.trim();
      const files = attachments.value.slice();
      inputText.value = '';
      if (inputRef.value) inputRef.value.style.height = 'auto';

      // Build message display with attachment info
      const msgAttachments = files.map(f => ({
        name: f.name, size: f.size, isImage: f.isImage, thumbUrl: f.thumbUrl,
      }));

      messages.value.push({
        id: ++messageIdCounter, role: 'user',
        content: text || (files.length > 0 ? `[${files.length} file${files.length > 1 ? 's' : ''} attached]` : ''),
        attachments: msgAttachments.length > 0 ? msgAttachments : undefined,
        timestamp: new Date(),
      });
      isProcessing.value = true;
      scrollToBottom(true);

      // Build payload
      const payload = { type: 'chat', prompt: text || '(see attached files)' };
      if (needsResume.value && currentClaudeSessionId.value) {
        payload.resumeSessionId = currentClaudeSessionId.value;
        needsResume.value = false;
      }
      if (files.length > 0) {
        payload.files = files.map(f => ({
          name: f.name,
          mimeType: f.mimeType,
          data: f.data,
        }));
      }
      wsSend(payload);

      // Clear attachments (don't revoke thumbUrls — they're referenced by the message now)
      attachments.value = [];
    }

    function cancelExecution() {
      if (!ws || !isProcessing.value) return;
      wsSend({ type: 'cancel_execution' });
    }

    function handleKeydown(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    }

    // ── Rendered markdown for assistant messages ──
    function formatTimestamp(ts) {
      if (!ts) return '';
      const d = ts instanceof Date ? ts : new Date(ts);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · ' + d.toLocaleDateString();
    }

    function getRenderedContent(msg) {
      if (msg.role !== 'assistant' && !msg.isCommandOutput) return msg.content;
      return renderMarkdown(msg.content);
    }

    // ── Copy full message ──
    async function copyMessage(msg) {
      try {
        await navigator.clipboard.writeText(msg.content);
        msg.copied = true;
        setTimeout(() => { msg.copied = false; }, 2000);
      } catch {}
    }

    // ── Check if previous message is also assistant (to suppress repeated label) ──
    function isPrevAssistant(idx) {
      if (idx <= 0) return false;
      const prev = visibleMessages.value[idx - 1];
      return prev && (prev.role === 'assistant' || prev.role === 'tool');
    }

    // ── Context summary toggle ──
    function toggleContextSummary(msg) {
      msg.contextExpanded = !msg.contextExpanded;
    }

    // ── Finalize a streaming message (mark done, detect context summary) ──
    function finalizeStreamingMsg() {
      if (streamingMessageId === null) return;
      const streamMsg = messages.value.find(m => m.id === streamingMessageId);
      if (streamMsg) {
        streamMsg.isStreaming = false;
        if (isContextSummary(streamMsg.content)) {
          streamMsg.role = 'context-summary';
          streamMsg.contextExpanded = false;
        }
      }
      streamingMessageId = null;
      // Trigger syntax highlighting for the finalized message content
      nextTick(scheduleHighlight);
    }

    // ── Tool expand/collapse ──
    function toggleTool(msg) {
      msg.expanded = !msg.expanded;
    }

    function getToolSummary(msg) {
      const name = msg.toolName;
      const input = msg.toolInput;
      try {
        const obj = JSON.parse(input);
        if (name === 'Read' && obj.file_path) return obj.file_path;
        if (name === 'Edit' && obj.file_path) return obj.file_path;
        if (name === 'Write' && obj.file_path) return obj.file_path;
        if (name === 'Bash' && obj.command) return obj.command.length > 60 ? obj.command.slice(0, 60) + '...' : obj.command;
        if (name === 'Glob' && obj.pattern) return obj.pattern;
        if (name === 'Grep' && obj.pattern) return obj.pattern;
        if (name === 'TodoWrite' && obj.todos) {
          const done = obj.todos.filter(t => t.status === 'completed').length;
          return `${done}/${obj.todos.length} done`;
        }
        if (name === 'Task' && obj.description) return obj.description;
        if (name === 'WebSearch' && obj.query) return obj.query;
        if (name === 'WebFetch' && obj.url) return obj.url.length > 60 ? obj.url.slice(0, 60) + '...' : obj.url;
      } catch {}
      return '';
    }

    function isEditTool(msg) {
      return msg.role === 'tool' && msg.toolName === 'Edit' && msg.toolInput;
    }

    function getFormattedToolInput(msg) {
      if (!msg.toolInput) return null;
      try {
        const obj = JSON.parse(msg.toolInput);
        const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const name = msg.toolName;

        if (name === 'Read' && obj.file_path) {
          let detail = esc(obj.file_path);
          if (obj.offset && obj.limit) {
            detail += `  <span class="tool-input-meta">lines ${obj.offset}\u2013${obj.offset + obj.limit - 1}</span>`;
          } else if (obj.offset) {
            detail += `  <span class="tool-input-meta">from line ${obj.offset}</span>`;
          } else if (obj.limit) {
            detail += `  <span class="tool-input-meta">first ${obj.limit} lines</span>`;
          }
          return detail;
        }

        if (name === 'Write' && obj.file_path) {
          const lines = (obj.content || '').split('\n').length;
          return esc(obj.file_path) + `  <span class="tool-input-meta">${lines} lines</span>`;
        }

        if (name === 'Bash' && obj.command) {
          let html = '<code class="tool-input-cmd">' + esc(obj.command) + '</code>';
          if (obj.description) html = '<span class="tool-input-meta">' + esc(obj.description) + '</span> ' + html;
          return html;
        }

        if (name === 'Glob' && obj.pattern) {
          let html = '<code class="tool-input-cmd">' + esc(obj.pattern) + '</code>';
          if (obj.path) html += '  <span class="tool-input-meta">in ' + esc(obj.path) + '</span>';
          return html;
        }

        if (name === 'Grep' && obj.pattern) {
          let html = '<code class="tool-input-cmd">' + esc(obj.pattern) + '</code>';
          if (obj.path) html += '  <span class="tool-input-meta">in ' + esc(obj.path) + '</span>';
          return html;
        }

        if (name === 'TodoWrite' && Array.isArray(obj.todos)) {
          let html = '<div class="todo-list">';
          for (const t of obj.todos) {
            const s = t.status;
            const icon = s === 'completed' ? '<span class="todo-icon done">\u2713</span>'
              : s === 'in_progress' ? '<span class="todo-icon active">\u25CF</span>'
              : '<span class="todo-icon">\u25CB</span>';
            const cls = s === 'completed' ? ' todo-done' : s === 'in_progress' ? ' todo-active' : '';
            html += '<div class="todo-item' + cls + '">' + icon + '<span class="todo-text">' + esc(t.content || t.activeForm || '') + '</span></div>';
          }
          html += '</div>';
          return html;
        }

        if (name === 'Task') {
          let html = '';
          if (obj.description) html += '<div class="task-field"><span class="tool-input-meta">Description</span> ' + esc(obj.description) + '</div>';
          if (obj.subagent_type) html += '<div class="task-field"><span class="tool-input-meta">Agent</span> <code class="tool-input-cmd">' + esc(obj.subagent_type) + '</code></div>';
          if (obj.prompt) {
            const short = obj.prompt.length > 200 ? obj.prompt.slice(0, 200) + '...' : obj.prompt;
            html += '<div class="task-field"><span class="tool-input-meta">Prompt</span></div><div class="task-prompt">' + esc(short) + '</div>';
          }
          if (html) return html;
        }

        if (name === 'WebSearch' && obj.query) {
          return '<code class="tool-input-cmd">' + esc(obj.query) + '</code>';
        }

        if (name === 'WebFetch' && obj.url) {
          let html = '<a class="tool-link" href="' + esc(obj.url) + '" target="_blank" rel="noopener">' + esc(obj.url) + '</a>';
          if (obj.prompt) html += '<div class="task-field"><span class="tool-input-meta">' + esc(obj.prompt) + '</span></div>';
          return html;
        }

      } catch {}
      return null;
    }

    function getEditDiffHtml(msg) {
      try {
        const obj = JSON.parse(msg.toolInput);
        if (!obj.old_string && !obj.new_string) return null;
        const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const filePath = obj.file_path || '';
        const oldLines = (obj.old_string || '').split('\n');
        const newLines = (obj.new_string || '').split('\n');
        let html = '';
        if (filePath) {
          html += '<div class="diff-file">' + esc(filePath) + (obj.replace_all ? ' <span class="diff-replace-all">(replace all)</span>' : '') + '</div>';
        }
        html += '<div class="diff-lines">';
        for (const line of oldLines) {
          html += '<div class="diff-removed">' + '<span class="diff-sign">-</span>' + esc(line) + '</div>';
        }
        for (const line of newLines) {
          html += '<div class="diff-added">' + '<span class="diff-sign">+</span>' + esc(line) + '</div>';
        }
        html += '</div>';
        return html;
      } catch { return null; }
    }

    // ── AskUserQuestion interaction ──
    function selectQuestionOption(msg, qIndex, optLabel) {
      if (msg.answered) return;
      const q = msg.questions[qIndex];
      if (!q) return;
      if (q.multiSelect) {
        // Toggle selection
        const sel = msg.selectedAnswers[qIndex] || [];
        const idx = sel.indexOf(optLabel);
        if (idx >= 0) sel.splice(idx, 1);
        else sel.push(optLabel);
        msg.selectedAnswers[qIndex] = [...sel];
      } else {
        msg.selectedAnswers[qIndex] = optLabel;
        msg.customTexts[qIndex] = ''; // clear custom text when option selected
      }
    }

    function submitQuestionAnswer(msg) {
      if (msg.answered || !ws) return;
      // Build answers object keyed by question text: { "question text": "selected label" }
      // This matches the format Claude CLI expects for AskUserQuestion answers
      const answers = {};
      for (let i = 0; i < msg.questions.length; i++) {
        const q = msg.questions[i];
        const key = q.question || String(i);
        const custom = (msg.customTexts[i] || '').trim();
        if (custom) {
          answers[key] = custom;
        } else {
          const sel = msg.selectedAnswers[i];
          if (Array.isArray(sel) && sel.length > 0) {
            answers[key] = sel.join(', ');
          } else if (sel != null) {
            answers[key] = sel;
          }
        }
      }
      msg.answered = true;
      wsSend({ type: 'ask_user_answer', requestId: msg.requestId, answers });
    }

    function hasQuestionAnswer(msg) {
      // Check if at least one question has a selection or custom text
      for (let i = 0; i < msg.questions.length; i++) {
        const sel = msg.selectedAnswers[i];
        const custom = (msg.customTexts[i] || '').trim();
        if (custom || (Array.isArray(sel) ? sel.length > 0 : sel != null)) return true;
      }
      return false;
    }

    function getQuestionResponseSummary(msg) {
      // Build a summary string of the user's answers
      const parts = [];
      for (let i = 0; i < msg.questions.length; i++) {
        const custom = (msg.customTexts[i] || '').trim();
        if (custom) {
          parts.push(custom);
        } else {
          const sel = msg.selectedAnswers[i];
          if (Array.isArray(sel)) parts.push(sel.join(', '));
          else if (sel) parts.push(sel);
        }
      }
      return parts.join(' | ');
    }

    // ── Sidebar: session management ──
    function requestSessionList() {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      loadingSessions.value = true;
      wsSend({ type: 'list_sessions' });
    }

    function resumeSession(session) {
      if (isProcessing.value) return;
      // Auto-close sidebar on mobile
      if (window.innerWidth <= 768) sidebarOpen.value = false;
      // Clear current conversation
      messages.value = [];
      visibleLimit.value = 50;
      messageIdCounter = 0;
      streamingMessageId = null;
      pendingText = '';
      if (revealTimer !== null) { clearTimeout(revealTimer); revealTimer = null; }

      currentClaudeSessionId.value = session.sessionId;
      needsResume.value = true;
      loadingHistory.value = true;

      // Notify agent to prepare for resume (agent will respond with history)
      wsSend({
        type: 'resume_conversation',
        claudeSessionId: session.sessionId,
      });
    }

    function newConversation() {
      if (isProcessing.value) return;
      // Auto-close sidebar on mobile
      if (window.innerWidth <= 768) sidebarOpen.value = false;
      messages.value = [];
      visibleLimit.value = 50;
      messageIdCounter = 0;
      streamingMessageId = null;
      pendingText = '';
      currentClaudeSessionId.value = null;
      needsResume.value = false;

      messages.value.push({
        id: ++messageIdCounter, role: 'system',
        content: 'New conversation started.',
        timestamp: new Date(),
      });
    }

    function toggleSidebar() {
      sidebarOpen.value = !sidebarOpen.value;
    }

    // ── Folder picker: change working directory ──
    function openFolderPicker() {
      folderPickerOpen.value = true;
      folderPickerSelected.value = '';
      folderPickerLoading.value = true;
      folderPickerPath.value = workDir.value || '';
      folderPickerEntries.value = [];
      wsSend({ type: 'list_directory', dirPath: workDir.value || '' });
    }

    function loadFolderPickerDir(dirPath) {
      folderPickerLoading.value = true;
      folderPickerSelected.value = '';
      folderPickerEntries.value = [];
      wsSend({ type: 'list_directory', dirPath });
    }

    function folderPickerNavigateUp() {
      if (!folderPickerPath.value) return;
      const isWin = folderPickerPath.value.includes('\\');
      const parts = folderPickerPath.value.replace(/[/\\]$/, '').split(/[/\\]/);
      parts.pop();
      if (parts.length === 0) {
        folderPickerPath.value = '';
        loadFolderPickerDir('');
      } else if (isWin && parts.length === 1 && /^[A-Za-z]:$/.test(parts[0])) {
        folderPickerPath.value = parts[0] + '\\';
        loadFolderPickerDir(parts[0] + '\\');
      } else {
        const sep = isWin ? '\\' : '/';
        const parent = parts.join(sep);
        folderPickerPath.value = parent;
        loadFolderPickerDir(parent);
      }
    }

    function folderPickerSelectItem(entry) {
      folderPickerSelected.value = entry.name;
    }

    function folderPickerEnter(entry) {
      const sep = folderPickerPath.value.includes('\\') || /^[A-Z]:/.test(entry.name) ? '\\' : '/';
      let newPath;
      if (!folderPickerPath.value) {
        newPath = entry.name + (entry.name.endsWith('\\') ? '' : '\\');
      } else {
        newPath = folderPickerPath.value.replace(/[/\\]$/, '') + sep + entry.name;
      }
      folderPickerPath.value = newPath;
      folderPickerSelected.value = '';
      loadFolderPickerDir(newPath);
    }

    function folderPickerGoToPath() {
      const path = folderPickerPath.value.trim();
      if (!path) {
        loadFolderPickerDir('');
        return;
      }
      folderPickerSelected.value = '';
      loadFolderPickerDir(path);
    }

    function confirmFolderPicker() {
      let path = folderPickerPath.value;
      if (!path) return;
      if (folderPickerSelected.value) {
        const sep = path.includes('\\') ? '\\' : '/';
        path = path.replace(/[/\\]$/, '') + sep + folderPickerSelected.value;
      }
      folderPickerOpen.value = false;
      wsSend({ type: 'change_workdir', workDir: path });
    }

    // ── Sidebar: grouped sessions by time ──
    const groupedSessions = computed(() => {
      if (!historySessions.value.length) return [];
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const yesterdayStart = todayStart - 86400000;
      const weekStart = todayStart - 6 * 86400000;

      const groups = {};
      for (const s of historySessions.value) {
        let label;
        if (s.lastModified >= todayStart) label = 'Today';
        else if (s.lastModified >= yesterdayStart) label = 'Yesterday';
        else if (s.lastModified >= weekStart) label = 'This week';
        else label = 'Earlier';
        if (!groups[label]) groups[label] = [];
        groups[label].push(s);
      }
      // Return in a consistent order
      const order = ['Today', 'Yesterday', 'This week', 'Earlier'];
      return order.filter(k => groups[k]).map(k => ({ label: k, sessions: groups[k] }));
    });

    // ── WebSocket ──
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 50;
    const RECONNECT_BASE_DELAY = 1000;
    const RECONNECT_MAX_DELAY = 15000;
    let reconnectTimer = null;

    function connect() {
      const sid = getSessionId();
      if (!sid) {
        status.value = 'No Session';
        error.value = 'No session ID in URL. Use a session URL provided by agentlink start.';
        return;
      }
      sessionId.value = sid;
      status.value = 'Connecting...';
      error.value = '';

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/?type=web&sessionId=${sid}`;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => { error.value = ''; reconnectAttempts = 0; };

      ws.onmessage = (event) => {
        let msg;
        const parsed = JSON.parse(event.data);

        // The 'connected' message is always plain text (key exchange)
        if (parsed.type === 'connected') {
          msg = parsed;
          if (typeof parsed.sessionKey === 'string') {
            sessionKey = decodeKey(parsed.sessionKey);
          }
        } else if (sessionKey && isEncrypted(parsed)) {
          msg = decrypt(parsed, sessionKey);
          if (!msg) {
            console.error('[WS] Failed to decrypt message');
            return;
          }
        } else {
          msg = parsed;
        }

        if (msg.type === 'connected') {
          if (msg.agent) {
            status.value = 'Connected';
            agentName.value = msg.agent.name;
            hostname.value = msg.agent.hostname || '';
            workDir.value = msg.agent.workDir;
            // If we have a saved workDir from a previous session, restore it
            const savedDir = localStorage.getItem('agentlink-workdir');
            if (savedDir && savedDir !== msg.agent.workDir) {
              wsSend({ type: 'change_workdir', workDir: savedDir });
            }
            // Request session list once connected
            requestSessionList();
          } else {
            status.value = 'Waiting';
            error.value = 'Agent is not connected yet.';
          }
        } else if (msg.type === 'agent_disconnected') {
          status.value = 'Waiting';
          agentName.value = '';
          hostname.value = '';
          error.value = 'Agent disconnected. Waiting for reconnect...';
          isProcessing.value = false;
          isCompacting.value = false;
        } else if (msg.type === 'agent_reconnected') {
          status.value = 'Connected';
          error.value = '';
          if (msg.agent) {
            agentName.value = msg.agent.name;
            hostname.value = msg.agent.hostname || '';
            workDir.value = msg.agent.workDir;
          }
          requestSessionList();
        } else if (msg.type === 'error') {
          status.value = 'Error';
          error.value = msg.message;
          isProcessing.value = false;
          isCompacting.value = false;
        } else if (msg.type === 'claude_output') {
          handleClaudeOutput(msg);
        } else if (msg.type === 'command_output') {
          flushReveal();
          finalizeStreamingMsg();
          messages.value.push({
            id: ++messageIdCounter, role: 'user',
            content: msg.content, isCommandOutput: true,
            timestamp: new Date(),
          });
          scrollToBottom();
        } else if (msg.type === 'context_compaction') {
          if (msg.status === 'started') {
            isCompacting.value = true;
          } else if (msg.status === 'completed') {
            isCompacting.value = false;
          }
        } else if (msg.type === 'turn_completed' || msg.type === 'execution_cancelled') {
          isProcessing.value = false;
          isCompacting.value = false;
          flushReveal();
          finalizeStreamingMsg();
          if (msg.type === 'execution_cancelled') {
            messages.value.push({
              id: ++messageIdCounter, role: 'system',
              content: 'Generation stopped.', timestamp: new Date(),
            });
            scrollToBottom();
          }
        } else if (msg.type === 'ask_user_question') {
          flushReveal();
          finalizeStreamingMsg();
          // Remove any preceding tool message for AskUserQuestion (tool_use arrives before control_request)
          for (let i = messages.value.length - 1; i >= 0; i--) {
            const m = messages.value[i];
            if (m.role === 'tool' && m.toolName === 'AskUserQuestion') {
              messages.value.splice(i, 1);
              break;
            }
            // Only look back within recent messages
            if (m.role === 'user') break;
          }
          // Render interactive question card
          const questions = msg.questions || [];
          const selectedAnswers = {};
          const customTexts = {};
          for (let i = 0; i < questions.length; i++) {
            selectedAnswers[i] = questions[i].multiSelect ? [] : null;
            customTexts[i] = '';
          }
          messages.value.push({
            id: ++messageIdCounter,
            role: 'ask-question',
            requestId: msg.requestId,
            questions,
            answered: false,
            selectedAnswers,
            customTexts,
            timestamp: new Date(),
          });
          scrollToBottom();
        } else if (msg.type === 'sessions_list') {
          historySessions.value = msg.sessions || [];
          loadingSessions.value = false;
        } else if (msg.type === 'conversation_resumed') {
          currentClaudeSessionId.value = msg.claudeSessionId;
          // Build history messages in a plain array first, then assign once
          // to avoid triggering Vue reactivity on every individual push.
          if (msg.history && Array.isArray(msg.history)) {
            const batch = [];
            for (const h of msg.history) {
              if (h.role === 'user') {
                if (isContextSummary(h.content)) {
                  batch.push({
                    id: ++messageIdCounter, role: 'context-summary',
                    content: h.content, contextExpanded: false,
                    timestamp: h.timestamp ? new Date(h.timestamp) : new Date(),
                  });
                } else {
                  batch.push({
                    id: ++messageIdCounter, role: 'user',
                    content: h.content, isCommandOutput: !!h.isCommandOutput,
                    timestamp: h.timestamp ? new Date(h.timestamp) : new Date(),
                  });
                }
              } else if (h.role === 'assistant') {
                // Merge with previous assistant message if consecutive
                const last = batch[batch.length - 1];
                if (last && last.role === 'assistant' && !last.isStreaming) {
                  last.content += '\n\n' + h.content;
                } else {
                  batch.push({
                    id: ++messageIdCounter, role: 'assistant',
                    content: h.content, isStreaming: false,
                    timestamp: h.timestamp ? new Date(h.timestamp) : new Date(),
                  });
                }
              } else if (h.role === 'tool') {
                batch.push({
                  id: ++messageIdCounter, role: 'tool',
                  toolId: h.toolId || '', toolName: h.toolName || 'unknown',
                  toolInput: h.toolInput || '', hasResult: true,
                  expanded: h.toolName === 'Edit', timestamp: h.timestamp ? new Date(h.timestamp) : new Date(),
                });
              }
            }
            // Single reactive assignment — triggers Vue reactivity only once
            messages.value = batch;
          }
          loadingHistory.value = false;
          // Show ready-for-input hint
          messages.value.push({
            id: ++messageIdCounter, role: 'system',
            content: 'Session restored. You can continue the conversation.',
            timestamp: new Date(),
          });
          scrollToBottom();
        } else if (msg.type === 'directory_listing') {
          folderPickerLoading.value = false;
          folderPickerEntries.value = (msg.entries || [])
            .filter(e => e.type === 'directory')
            .sort((a, b) => a.name.localeCompare(b.name));
          if (msg.dirPath != null) folderPickerPath.value = msg.dirPath;
        } else if (msg.type === 'workdir_changed') {
          workDir.value = msg.workDir;
          localStorage.setItem('agentlink-workdir', msg.workDir);
          messages.value = [];
          visibleLimit.value = 50;
          messageIdCounter = 0;
          streamingMessageId = null;
          pendingText = '';
          currentClaudeSessionId.value = null;
          isProcessing.value = false;
          if (revealTimer !== null) { clearTimeout(revealTimer); revealTimer = null; }
          messages.value.push({
            id: ++messageIdCounter, role: 'system',
            content: 'Working directory changed to: ' + msg.workDir,
            timestamp: new Date(),
          });
          requestSessionList();
        }
      };

      ws.onclose = () => {
        sessionKey = null;
        const wasConnected = status.value === 'Connected' || status.value === 'Connecting...';
        isProcessing.value = false;
        isCompacting.value = false;

        if (wasConnected || reconnectAttempts > 0) {
          scheduleReconnect();
        }
      };

      ws.onerror = () => {};
    }

    function scheduleReconnect() {
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        status.value = 'Disconnected';
        error.value = 'Unable to reconnect. Please refresh the page.';
        return;
      }
      const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(1.5, reconnectAttempts), RECONNECT_MAX_DELAY);
      reconnectAttempts++;
      status.value = 'Reconnecting...';
      error.value = 'Connection lost. Reconnecting... (attempt ' + reconnectAttempts + ')';
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, delay);
    }

    function handleClaudeOutput(msg) {
      const data = msg.data;
      if (!data) return;

      if (data.type === 'content_block_delta' && data.delta) {
        pendingText += data.delta;
        startReveal();
        return;
      }

      if (data.type === 'tool_use' && data.tools) {
        flushReveal();
        finalizeStreamingMsg();

        for (const tool of data.tools) {
          messages.value.push({
            id: ++messageIdCounter, role: 'tool',
            toolId: tool.id, toolName: tool.name || 'unknown',
            toolInput: tool.input ? JSON.stringify(tool.input, null, 2) : '',
            hasResult: false, expanded: (tool.name === 'Edit'), timestamp: new Date(),
          });
        }
        scrollToBottom();
        return;
      }

      if (data.type === 'user' && data.tool_use_result) {
        const result = data.tool_use_result;
        const results = Array.isArray(result) ? result : [result];
        for (const r of results) {
          const toolMsg = [...messages.value].reverse().find(
            m => m.role === 'tool' && m.toolId === r.tool_use_id
          );
          if (toolMsg) {
            toolMsg.toolOutput = typeof r.content === 'string'
              ? r.content : JSON.stringify(r.content, null, 2);
            toolMsg.hasResult = true;
          }
        }
        scrollToBottom();
        return;
      }
    }

    // Apply syntax highlighting after DOM updates (throttled)
    let _hlTimer = null;
    function scheduleHighlight() {
      if (_hlTimer) return;
      _hlTimer = setTimeout(() => {
        _hlTimer = null;
        if (typeof hljs !== 'undefined') {
          document.querySelectorAll('pre code:not([data-highlighted])').forEach(block => {
            hljs.highlightElement(block);
            block.dataset.highlighted = 'true';
          });
        }
      }, 300);
    }
    // Trigger highlight when messages are added/removed (shallow watch on length)
    // Deep watch is too expensive for large conversations — it traverses every
    // property of every message object on every mutation (including streaming ticks).
    const messageCount = computed(() => messages.value.length);
    watch(messageCount, () => { nextTick(scheduleHighlight); });

    onMounted(() => { connect(); });
    onUnmounted(() => { if (reconnectTimer) clearTimeout(reconnectTimer); if (ws) ws.close(); });

    // Dynamic page title
    watch(agentName, (name) => {
      document.title = name ? `${name} — AgentLink` : 'AgentLink';
    });

    return {
      status, agentName, hostname, workDir, sessionId, error,
      messages, visibleMessages, hasMoreMessages, loadMoreMessages,
      inputText, isProcessing, isCompacting, canSend, inputRef,
      sendMessage, handleKeydown, cancelExecution, onMessageListScroll,
      getRenderedContent, copyMessage, toggleTool, isPrevAssistant, toggleContextSummary, formatTimestamp,
      getToolIcon, getToolSummary, isEditTool, getEditDiffHtml, getFormattedToolInput, autoResize,
      // AskUserQuestion
      selectQuestionOption, submitQuestionAnswer, hasQuestionAnswer, getQuestionResponseSummary,
      // Theme
      theme, toggleTheme,
      // Sidebar
      sidebarOpen, historySessions, currentClaudeSessionId, loadingSessions, loadingHistory,
      toggleSidebar, resumeSession, newConversation, requestSessionList,
      formatRelativeTime, groupedSessions,
      // Folder picker
      folderPickerOpen, folderPickerPath, folderPickerEntries,
      folderPickerLoading, folderPickerSelected,
      openFolderPicker, folderPickerNavigateUp, folderPickerSelectItem,
      folderPickerEnter, folderPickerGoToPath, confirmFolderPicker,
      // File attachments
      attachments, fileInputRef, dragOver,
      triggerFileInput, handleFileSelect, removeAttachment, formatFileSize,
      handleDragOver, handleDragLeave, handleDrop, handlePaste,
    };
  },
  template: `
    <div class="layout">
      <header class="top-bar">
        <div class="top-bar-left">
          <button class="sidebar-toggle" @click="toggleSidebar" title="Toggle sidebar">
            <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>
          </button>
          <h1>AgentLink</h1>
        </div>
        <div class="top-bar-info">
          <span :class="['badge', status.toLowerCase()]">{{ status }}</span>
          <span v-if="agentName" class="agent-label">{{ agentName }}</span>
          <button class="theme-toggle" @click="toggleTheme" :title="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'">
            <svg v-if="theme === 'dark'" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58a.996.996 0 0 0-1.41 0 .996.996 0 0 0 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37a.996.996 0 0 0-1.41 0 .996.996 0 0 0 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0a.996.996 0 0 0 0-1.41l-1.06-1.06zm1.06-10.96a.996.996 0 0 0 0-1.41.996.996 0 0 0-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36a.996.996 0 0 0 0-1.41.996.996 0 0 0-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z"/></svg>
            <svg v-else viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/></svg>
          </button>
        </div>
      </header>

      <div v-if="status === 'No Session' || (status !== 'Connected' && status !== 'Connecting...' && status !== 'Reconnecting...' && messages.length === 0)" class="center-card">
        <div class="status-card">
          <p class="status">
            <span class="label">Status:</span>
            <span :class="['badge', status.toLowerCase()]">{{ status }}</span>
          </p>
          <p v-if="agentName" class="info"><span class="label">Agent:</span> {{ agentName }}</p>
          <p v-if="workDir" class="info"><span class="label">Directory:</span> {{ workDir }}</p>
          <p v-if="sessionId" class="info muted"><span class="label">Session:</span> {{ sessionId }}</p>
          <p v-if="error" class="error-msg">{{ error }}</p>
        </div>
      </div>

      <div v-else class="main-body">
        <!-- Sidebar backdrop (mobile) -->
        <div v-if="sidebarOpen" class="sidebar-backdrop" @click="toggleSidebar"></div>
        <!-- Sidebar -->
        <aside v-if="sidebarOpen" class="sidebar">
          <div class="sidebar-section">
            <div class="sidebar-workdir">
              <div v-if="hostname" class="sidebar-hostname">
                <svg class="sidebar-hostname-icon" viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M3.5 2A1.5 1.5 0 0 0 2 3.5v5A1.5 1.5 0 0 0 3.5 10h9A1.5 1.5 0 0 0 14 8.5v-5A1.5 1.5 0 0 0 12.5 2h-9zM.5 3.5A3 3 0 0 1 3.5.5h9A3 3 0 0 1 15.5 3.5v5a3 3 0 0 1-3 3h-9a3 3 0 0 1-3-3v-5zM5 13.25a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75zM3.25 15a.75.75 0 0 0 0 1.5h9.5a.75.75 0 0 0 0-1.5h-9.5z"/></svg>
                <span>{{ hostname }}</span>
              </div>
              <div class="sidebar-workdir-header">
                <div class="sidebar-workdir-label">Working Directory</div>
                <button class="sidebar-change-dir-btn" @click="openFolderPicker" title="Change working directory" :disabled="isProcessing">
                  <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
                </button>
              </div>
              <div class="sidebar-workdir-path" :title="workDir">{{ workDir }}</div>
            </div>
          </div>

          <div class="sidebar-section sidebar-sessions">
            <div class="sidebar-section-header">
              <span>History</span>
              <button class="sidebar-refresh-btn" @click="requestSessionList" title="Refresh" :disabled="loadingSessions">
                <svg :class="{ spinning: loadingSessions }" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
              </button>
            </div>

            <button class="new-conversation-btn" @click="newConversation" :disabled="isProcessing">
              <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
              New conversation
            </button>

            <div v-if="loadingSessions && historySessions.length === 0" class="sidebar-loading">
              Loading sessions...
            </div>
            <div v-else-if="historySessions.length === 0" class="sidebar-empty">
              No previous sessions found.
            </div>
            <div v-else class="session-list">
              <div v-for="group in groupedSessions" :key="group.label" class="session-group">
                <div class="session-group-label">{{ group.label }}</div>
                <div
                  v-for="s in group.sessions" :key="s.sessionId"
                  :class="['session-item', { active: currentClaudeSessionId === s.sessionId }]"
                  @click="resumeSession(s)"
                  :title="s.preview"
                >
                  <div class="session-title">{{ s.title }}</div>
                  <div class="session-meta">{{ formatRelativeTime(s.lastModified) }}</div>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <!-- Chat area -->
        <div class="chat-area">
          <div class="message-list" @scroll="onMessageListScroll">
            <div class="message-list-inner">
              <div v-if="messages.length === 0 && status === 'Connected' && !loadingHistory" class="empty-state">
                <div class="empty-state-icon">
                  <svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" opacity="0.4" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>
                </div>
                <p>Connected to <strong>{{ agentName }}</strong></p>
                <p class="muted">{{ workDir }}</p>
                <p class="muted" style="margin-top: 0.5rem;">Send a message to start.</p>
              </div>

              <div v-if="loadingHistory" class="history-loading">
                <div class="history-loading-spinner"></div>
                <span>Loading conversation history...</span>
              </div>

              <div v-if="hasMoreMessages" class="load-more-wrapper">
                <button class="load-more-btn" @click="loadMoreMessages">Load earlier messages</button>
              </div>

              <div v-for="(msg, msgIdx) in visibleMessages" :key="msg.id" :class="['message', 'message-' + msg.role]">

                <!-- User message -->
                <template v-if="msg.role === 'user'">
                  <div class="message-role-label user-label">You</div>
                  <div class="message-bubble user-bubble" :title="formatTimestamp(msg.timestamp)">
                    <div v-if="msg.isCommandOutput" class="message-content markdown-body" v-html="getRenderedContent(msg)"></div>
                    <div v-else class="message-content">{{ msg.content }}</div>
                    <div v-if="msg.attachments && msg.attachments.length" class="message-attachments">
                      <div v-for="(att, ai) in msg.attachments" :key="ai" class="message-attachment-chip">
                        <img v-if="att.isImage && att.thumbUrl" :src="att.thumbUrl" class="message-attachment-thumb" />
                        <span v-else class="message-attachment-file-icon">
                          <svg viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M1 2.5A2.5 2.5 0 0 1 3.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75H3.5a1 1 0 0 0-1 1h9.25a.75.75 0 0 1 0 1.5H3.5A2.5 2.5 0 0 1 1 14V2.5z"/></svg>
                        </span>
                        <span>{{ att.name }}</span>
                      </div>
                    </div>
                  </div>
                </template>

                <!-- Assistant message (markdown) -->
                <template v-else-if="msg.role === 'assistant'">
                  <div v-if="!isPrevAssistant(msgIdx)" class="message-role-label assistant-label">Claude</div>
                  <div :class="['message-bubble', 'assistant-bubble', { streaming: msg.isStreaming }]" :title="formatTimestamp(msg.timestamp)">
                    <div class="message-actions">
                      <button class="icon-btn" @click="copyMessage(msg)" :title="msg.copied ? 'Copied!' : 'Copy'">
                        <svg v-if="!msg.copied" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                        <svg v-else viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                      </button>
                    </div>
                    <div class="message-content markdown-body" v-html="getRenderedContent(msg)"></div>
                  </div>
                </template>

                <!-- Tool use block (collapsible) -->
                <div v-else-if="msg.role === 'tool'" class="tool-line-wrapper">
                  <div :class="['tool-line', { completed: msg.hasResult, running: !msg.hasResult }]" @click="toggleTool(msg)">
                    <span class="tool-icon" v-html="getToolIcon(msg.toolName)"></span>
                    <span class="tool-name">{{ msg.toolName }}</span>
                    <span class="tool-summary">{{ getToolSummary(msg) }}</span>
                    <span class="tool-status-icon" v-if="msg.hasResult">\u{2713}</span>
                    <span class="tool-status-icon running-dots" v-else>
                      <span></span><span></span><span></span>
                    </span>
                    <span class="tool-toggle">{{ msg.expanded ? '\u{25B2}' : '\u{25BC}' }}</span>
                  </div>
                  <div v-show="msg.expanded" class="tool-expand">
                    <div v-if="isEditTool(msg) && getEditDiffHtml(msg)" class="tool-diff" v-html="getEditDiffHtml(msg)"></div>
                    <div v-else-if="getFormattedToolInput(msg)" class="tool-input-formatted" v-html="getFormattedToolInput(msg)"></div>
                    <pre v-else-if="msg.toolInput" class="tool-block">{{ msg.toolInput }}</pre>
                    <pre v-if="msg.toolOutput" class="tool-block tool-output">{{ msg.toolOutput }}</pre>
                  </div>
                </div>

                <!-- AskUserQuestion interactive card -->
                <div v-else-if="msg.role === 'ask-question'" class="ask-question-wrapper">
                  <div v-if="!msg.answered" class="ask-question-card">
                    <div v-for="(q, qi) in msg.questions" :key="qi" class="ask-question-block">
                      <div v-if="q.header" class="ask-question-header">{{ q.header }}</div>
                      <div class="ask-question-text">{{ q.question }}</div>
                      <div class="ask-question-options">
                        <div
                          v-for="(opt, oi) in q.options" :key="oi"
                          :class="['ask-question-option', {
                            selected: q.multiSelect
                              ? (msg.selectedAnswers[qi] || []).includes(opt.label)
                              : msg.selectedAnswers[qi] === opt.label
                          }]"
                          @click="selectQuestionOption(msg, qi, opt.label)"
                        >
                          <div class="ask-option-label">{{ opt.label }}</div>
                          <div v-if="opt.description" class="ask-option-desc">{{ opt.description }}</div>
                        </div>
                      </div>
                      <div class="ask-question-custom">
                        <input
                          type="text"
                          v-model="msg.customTexts[qi]"
                          placeholder="Or type a custom response..."
                          @input="msg.selectedAnswers[qi] = q.multiSelect ? [] : null"
                          @keydown.enter="hasQuestionAnswer(msg) && submitQuestionAnswer(msg)"
                        />
                      </div>
                    </div>
                    <div class="ask-question-actions">
                      <button class="ask-question-submit" :disabled="!hasQuestionAnswer(msg)" @click="submitQuestionAnswer(msg)">
                        Submit
                      </button>
                    </div>
                  </div>
                  <div v-else class="ask-question-answered">
                    <span class="ask-answered-icon">\u{2713}</span>
                    <span class="ask-answered-text">{{ getQuestionResponseSummary(msg) }}</span>
                  </div>
                </div>

                <!-- Context summary (collapsed by default) -->
                <div v-else-if="msg.role === 'context-summary'" class="context-summary-wrapper">
                  <div class="context-summary-bar" @click="toggleContextSummary(msg)">
                    <svg class="context-summary-icon" viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>
                    <span class="context-summary-label">Context continued from previous conversation</span>
                    <span class="context-summary-toggle">{{ msg.contextExpanded ? 'Hide' : 'Show' }}</span>
                  </div>
                  <div v-if="msg.contextExpanded" class="context-summary-body">
                    <div class="markdown-body" v-html="getRenderedContent({ role: 'assistant', content: msg.content })"></div>
                  </div>
                </div>

                <!-- System message -->
                <div v-else-if="msg.role === 'system'" class="system-msg">
                  {{ msg.content }}
                </div>
              </div>

              <div v-if="isProcessing && !isCompacting && !messages.some(m => m.isStreaming)" class="typing-indicator">
                <span></span><span></span><span></span>
              </div>

              <div v-if="isCompacting" class="compacting-banner">
                <div class="compacting-spinner"></div>
                <span class="compacting-text">Context compacting in progress...</span>
              </div>
            </div>
          </div>

          <div class="input-area">
            <input
              type="file"
              ref="fileInputRef"
              multiple
              style="display: none"
              @change="handleFileSelect"
              accept="image/*,text/*,.pdf,.json,.md,.py,.js,.ts,.tsx,.jsx,.css,.html,.xml,.yaml,.yml,.toml,.sh,.sql,.csv"
            />
            <div
              :class="['input-card', { 'drag-over': dragOver }]"
              @dragover="handleDragOver"
              @dragleave="handleDragLeave"
              @drop="handleDrop"
            >
              <textarea
                ref="inputRef"
                v-model="inputText"
                @keydown="handleKeydown"
                @input="autoResize"
                @paste="handlePaste"
                :disabled="status !== 'Connected' || isCompacting"
                :placeholder="isCompacting ? 'Context compacting in progress...' : 'Send a message · Enter to send'"
                rows="1"
              ></textarea>
              <div v-if="attachments.length > 0" class="attachment-bar">
                <div v-for="(att, i) in attachments" :key="i" class="attachment-chip">
                  <img v-if="att.isImage && att.thumbUrl" :src="att.thumbUrl" class="attachment-thumb" />
                  <div v-else class="attachment-file-icon">
                    <svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M1 2.5A2.5 2.5 0 0 1 3.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75H3.5a1 1 0 0 0-1 1h9.25a.75.75 0 0 1 0 1.5H3.5A2.5 2.5 0 0 1 1 14V2.5z"/></svg>
                  </div>
                  <div class="attachment-info">
                    <div class="attachment-name">{{ att.name }}</div>
                    <div class="attachment-size">{{ formatFileSize(att.size) }}</div>
                  </div>
                  <button class="attachment-remove" @click="removeAttachment(i)" title="Remove">&times;</button>
                </div>
              </div>
              <div class="input-bottom-row">
                <button class="attach-btn" @click="triggerFileInput" :disabled="status !== 'Connected' || isCompacting || attachments.length >= 5" title="Attach files">
                  <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 0 0 5 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg>
                </button>
                <button v-if="isProcessing" @click="cancelExecution" class="send-btn stop-btn" title="Stop generation">
                  <svg viewBox="0 0 24 24" width="14" height="14"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>
                </button>
                <button v-else @click="sendMessage" :disabled="!canSend" class="send-btn" title="Send">
                  <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Folder Picker Modal -->
      <div class="folder-picker-overlay" v-if="folderPickerOpen" @click.self="folderPickerOpen = false">
        <div class="folder-picker-dialog">
          <div class="folder-picker-header">
            <span>Select Working Directory</span>
            <button class="folder-picker-close" @click="folderPickerOpen = false">&times;</button>
          </div>
          <div class="folder-picker-nav">
            <button class="folder-picker-up" @click="folderPickerNavigateUp" :disabled="!folderPickerPath" title="Go to parent directory">
              <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
            </button>
            <input class="folder-picker-path-input" type="text" v-model="folderPickerPath" @keydown.enter="folderPickerGoToPath" placeholder="Enter path..." spellcheck="false" />
          </div>
          <div class="folder-picker-list">
            <div v-if="folderPickerLoading" class="folder-picker-loading">
              <div class="history-loading-spinner"></div>
              <span>Loading...</span>
            </div>
            <template v-else>
              <div
                v-for="entry in folderPickerEntries" :key="entry.name"
                :class="['folder-picker-item', { 'folder-picker-selected': folderPickerSelected === entry.name }]"
                @click="folderPickerSelectItem(entry)"
                @dblclick="folderPickerEnter(entry)"
              >
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
                <span>{{ entry.name }}</span>
              </div>
              <div v-if="folderPickerEntries.length === 0" class="folder-picker-empty">No subdirectories found.</div>
            </template>
          </div>
          <div class="folder-picker-footer">
            <button class="folder-picker-cancel" @click="folderPickerOpen = false">Cancel</button>
            <button class="folder-picker-confirm" @click="confirmFolderPicker" :disabled="!folderPickerPath">Open</button>
          </div>
        </div>
      </div>
    </div>
  `
};

const app = createApp(App);
app.mount('#app');
