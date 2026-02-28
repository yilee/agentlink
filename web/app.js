const { createApp, ref, nextTick, onMounted, onUnmounted, computed, watch } = Vue;

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

function renderMarkdown(text) {
  if (!text) return '';
  try {
    if (typeof marked !== 'undefined') {
      let html = marked.parse(text);
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
      return html;
    }
  } catch {}
  // Fallback: escape HTML
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

// Tool icons
const TOOL_ICONS = {
  Read: '\u{1F4D6}', Edit: '\u{270F}\u{FE0F}', Write: '\u{1F4DD}',
  Bash: '\u{26A1}', Glob: '\u{1F50D}', Grep: '\u{1F50E}',
  Task: '\u{1F4CB}', WebFetch: '\u{1F310}', WebSearch: '\u{1F50D}',
  TodoWrite: '\u{2705}',
};
function getToolIcon(name) { return TOOL_ICONS[name] || '\u{2699}\u{FE0F}'; }

// ── App ─────────────────────────────────────────────────────────────────────
const App = {
  setup() {
    const status = ref('Connecting...');
    const agentName = ref('');
    const workDir = ref('');
    const sessionId = ref('');
    const error = ref('');
    const messages = ref([]);
    const inputText = ref('');
    const isProcessing = ref(false);
    const inputRef = ref(null);
    let ws = null;
    let messageIdCounter = 0;
    let streamingMessageId = null;

    // Progressive text reveal state
    let pendingText = '';
    let revealTimer = null;
    const CHARS_PER_TICK = 3;
    const TICK_MS = 12;

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
      status.value === 'Connected' && inputText.value.trim() && !isProcessing.value
    );

    function getSessionId() {
      const match = window.location.pathname.match(/^\/s\/([^/]+)/);
      return match ? match[1] : null;
    }

    function scrollToBottom() {
      nextTick(() => {
        const el = document.querySelector('.message-list');
        if (el) el.scrollTop = el.scrollHeight;
      });
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
      inputText.value = '';
      // Reset textarea height
      if (inputRef.value) inputRef.value.style.height = 'auto';

      messages.value.push({
        id: ++messageIdCounter, role: 'user',
        content: text, timestamp: new Date(),
      });
      isProcessing.value = true;
      scrollToBottom();

      ws.send(JSON.stringify({ type: 'chat', prompt: text }));
    }

    function cancelExecution() {
      if (!ws || !isProcessing.value) return;
      ws.send(JSON.stringify({ type: 'cancel_execution' }));
    }

    function handleKeydown(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    }

    // ── Rendered markdown for assistant messages ──
    function getRenderedContent(msg) {
      if (msg.role !== 'assistant') return msg.content;
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
      } catch {}
      return '';
    }

    // ── WebSocket ──
    function connect() {
      const sid = getSessionId();
      if (!sid) {
        status.value = 'No Session';
        error.value = 'No session ID in URL. Use a session URL provided by agentlink start.';
        return;
      }
      sessionId.value = sid;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/?type=web&sessionId=${sid}`;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => { error.value = ''; };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        if (msg.type === 'connected') {
          if (msg.agent) {
            status.value = 'Connected';
            agentName.value = msg.agent.name;
            workDir.value = msg.agent.workDir;
          } else {
            status.value = 'Waiting';
            error.value = 'Agent is not connected yet.';
          }
        } else if (msg.type === 'agent_disconnected') {
          status.value = 'Disconnected';
          agentName.value = '';
          workDir.value = '';
          error.value = 'Agent has disconnected.';
          isProcessing.value = false;
        } else if (msg.type === 'error') {
          status.value = 'Error';
          error.value = msg.message;
          isProcessing.value = false;
        } else if (msg.type === 'claude_output') {
          handleClaudeOutput(msg);
        } else if (msg.type === 'turn_completed' || msg.type === 'execution_cancelled') {
          isProcessing.value = false;
          flushReveal();
          if (streamingMessageId !== null) {
            const streamMsg = messages.value.find(m => m.id === streamingMessageId);
            if (streamMsg) streamMsg.isStreaming = false;
            streamingMessageId = null;
          }
          if (msg.type === 'execution_cancelled') {
            messages.value.push({
              id: ++messageIdCounter, role: 'system',
              content: 'Generation stopped.', timestamp: new Date(),
            });
            scrollToBottom();
          }
        }
      };

      ws.onclose = () => {
        if (status.value === 'Connected' || status.value === 'Connecting...') {
          status.value = 'Disconnected';
          error.value = 'Connection to server lost.';
        }
        isProcessing.value = false;
      };

      ws.onerror = () => {};
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
        if (streamingMessageId !== null) {
          const streamMsg = messages.value.find(m => m.id === streamingMessageId);
          if (streamMsg) streamMsg.isStreaming = false;
          streamingMessageId = null;
        }

        for (const tool of data.tools) {
          messages.value.push({
            id: ++messageIdCounter, role: 'tool',
            toolId: tool.id, toolName: tool.name || 'unknown',
            toolInput: tool.input ? JSON.stringify(tool.input, null, 2) : '',
            hasResult: false, expanded: false, timestamp: new Date(),
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

    // Apply syntax highlighting after DOM updates
    watch(messages, () => {
      nextTick(() => {
        if (typeof hljs !== 'undefined') {
          document.querySelectorAll('pre code:not([data-highlighted])').forEach(block => {
            hljs.highlightElement(block);
            block.dataset.highlighted = 'true';
          });
        }
      });
    }, { deep: true });

    onMounted(() => { connect(); });
    onUnmounted(() => { if (ws) ws.close(); });

    return {
      status, agentName, workDir, sessionId, error,
      messages, inputText, isProcessing, canSend, inputRef,
      sendMessage, handleKeydown, cancelExecution,
      getRenderedContent, copyMessage, toggleTool,
      getToolIcon, getToolSummary, autoResize,
    };
  },
  template: `
    <div class="layout">
      <header class="top-bar">
        <h1>AgentLink</h1>
        <div class="top-bar-info">
          <span :class="['badge', status.toLowerCase()]">{{ status }}</span>
          <span v-if="agentName" class="agent-label">{{ agentName }}</span>
        </div>
      </header>

      <div v-if="status === 'No Session' || (status !== 'Connected' && status !== 'Connecting...' && messages.length === 0)" class="center-card">
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

      <div v-else class="chat-area">
        <div class="message-list">
          <div v-if="messages.length === 0 && status === 'Connected'" class="empty-state">
            <p>Connected to <strong>{{ agentName }}</strong></p>
            <p class="muted">Working directory: {{ workDir }}</p>
            <p class="muted">Send a message to start.</p>
          </div>

          <div v-for="msg in messages" :key="msg.id" :class="['message', 'message-' + msg.role]">

            <!-- User message -->
            <div v-if="msg.role === 'user'" class="message-bubble user-bubble">
              <div class="message-content">{{ msg.content }}</div>
            </div>

            <!-- Assistant message (markdown) -->
            <div v-else-if="msg.role === 'assistant'" :class="['message-bubble', 'assistant-bubble', { streaming: msg.isStreaming }]">
              <div class="message-actions">
                <button class="icon-btn" @click="copyMessage(msg)" :title="msg.copied ? 'Copied!' : 'Copy'">
                  <svg v-if="!msg.copied" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                  <svg v-else viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                </button>
              </div>
              <div class="message-content markdown-body" v-html="getRenderedContent(msg)"></div>
            </div>

            <!-- Tool use block (collapsible) -->
            <div v-else-if="msg.role === 'tool'" class="tool-line-wrapper">
              <div :class="['tool-line', { completed: msg.hasResult, running: !msg.hasResult }]" @click="toggleTool(msg)">
                <span class="tool-icon">{{ getToolIcon(msg.toolName) }}</span>
                <span class="tool-name">{{ msg.toolName }}</span>
                <span class="tool-summary">{{ getToolSummary(msg) }}</span>
                <span class="tool-status-icon" v-if="msg.hasResult">\u{2713}</span>
                <span class="tool-status-icon running-dots" v-else>
                  <span></span><span></span><span></span>
                </span>
                <span class="tool-toggle">{{ msg.expanded ? '\u{25B2}' : '\u{25BC}' }}</span>
              </div>
              <div v-if="msg.expanded" class="tool-expand">
                <pre v-if="msg.toolInput" class="tool-block">{{ msg.toolInput }}</pre>
                <pre v-if="msg.toolOutput" class="tool-block tool-output">{{ msg.toolOutput }}</pre>
              </div>
            </div>

            <!-- System message -->
            <div v-else-if="msg.role === 'system'" class="system-msg">
              {{ msg.content }}
            </div>
          </div>

          <div v-if="isProcessing && !messages.some(m => m.isStreaming)" class="typing-indicator">
            <span></span><span></span><span></span>
          </div>
        </div>

        <div class="input-area">
          <div class="input-wrapper">
            <textarea
              ref="inputRef"
              v-model="inputText"
              @keydown="handleKeydown"
              @input="autoResize"
              :disabled="status !== 'Connected'"
              placeholder="Send a message..."
              rows="1"
            ></textarea>
            <button v-if="isProcessing" @click="cancelExecution" class="send-btn stop-btn" title="Stop generation">
              <svg viewBox="0 0 24 24" width="16" height="16"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>
            </button>
            <button v-else @click="sendMessage" :disabled="!canSend" class="send-btn">Send</button>
          </div>
        </div>
      </div>
    </div>
  `
};

const app = createApp(App);
app.mount('#app');
