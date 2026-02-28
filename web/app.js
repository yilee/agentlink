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
    const workDir = ref('');
    const sessionId = ref('');
    const error = ref('');
    const messages = ref([]);
    const inputText = ref('');
    const isProcessing = ref(false);
    const inputRef = ref(null);

    // Sidebar state
    const sidebarOpen = ref(true);
    const historySessions = ref([]);
    const currentClaudeSessionId = ref(null);
    const loadingSessions = ref(false);
    const loadingHistory = ref(false);

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
      if (inputRef.value) inputRef.value.style.height = 'auto';

      messages.value.push({
        id: ++messageIdCounter, role: 'user',
        content: text, timestamp: new Date(),
      });
      isProcessing.value = true;
      scrollToBottom();

      // If we have a resumed session and this is the first message, pass it along
      const payload = { type: 'chat', prompt: text };
      if (currentClaudeSessionId.value && messages.value.filter(m => m.role === 'user').length === 1) {
        payload.resumeSessionId = currentClaudeSessionId.value;
      }
      ws.send(JSON.stringify(payload));
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

    // ── Check if previous message is also assistant (to suppress repeated label) ──
    function isPrevAssistant(msg) {
      const idx = messages.value.indexOf(msg);
      if (idx <= 0) return false;
      const prev = messages.value[idx - 1];
      return prev.role === 'assistant' || prev.role === 'tool';
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

    // ── Sidebar: session management ──
    function requestSessionList() {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      loadingSessions.value = true;
      ws.send(JSON.stringify({ type: 'list_sessions' }));
    }

    function resumeSession(session) {
      if (isProcessing.value) return;
      // Clear current conversation
      messages.value = [];
      messageIdCounter = 0;
      streamingMessageId = null;
      pendingText = '';
      if (revealTimer !== null) { clearTimeout(revealTimer); revealTimer = null; }

      currentClaudeSessionId.value = session.sessionId;
      loadingHistory.value = true;

      // Notify agent to prepare for resume (agent will respond with history)
      ws.send(JSON.stringify({
        type: 'resume_conversation',
        claudeSessionId: session.sessionId,
      }));
    }

    function newConversation() {
      if (isProcessing.value) return;
      messages.value = [];
      messageIdCounter = 0;
      streamingMessageId = null;
      pendingText = '';
      currentClaudeSessionId.value = null;
      if (revealTimer !== null) { clearTimeout(revealTimer); revealTimer = null; }

      messages.value.push({
        id: ++messageIdCounter, role: 'system',
        content: 'New conversation started.',
        timestamp: new Date(),
      });
    }

    function toggleSidebar() {
      sidebarOpen.value = !sidebarOpen.value;
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
            // Request session list once connected
            requestSessionList();
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
        } else if (msg.type === 'sessions_list') {
          historySessions.value = msg.sessions || [];
          loadingSessions.value = false;
        } else if (msg.type === 'conversation_resumed') {
          currentClaudeSessionId.value = msg.claudeSessionId;
          // Load history messages into the chat
          if (msg.history && Array.isArray(msg.history)) {
            for (const h of msg.history) {
              if (h.role === 'user') {
                messages.value.push({
                  id: ++messageIdCounter, role: 'user',
                  content: h.content, timestamp: h.timestamp ? new Date(h.timestamp) : new Date(),
                });
              } else if (h.role === 'assistant') {
                // Merge with previous assistant message if consecutive
                const last = messages.value[messages.value.length - 1];
                if (last && last.role === 'assistant' && !last.isStreaming) {
                  last.content += '\n\n' + h.content;
                } else {
                  messages.value.push({
                    id: ++messageIdCounter, role: 'assistant',
                    content: h.content, isStreaming: false,
                    timestamp: h.timestamp ? new Date(h.timestamp) : new Date(),
                  });
                }
              } else if (h.role === 'tool') {
                messages.value.push({
                  id: ++messageIdCounter, role: 'tool',
                  toolId: h.toolId || '', toolName: h.toolName || 'unknown',
                  toolInput: h.toolInput || '', hasResult: true,
                  expanded: false, timestamp: h.timestamp ? new Date(h.timestamp) : new Date(),
                });
              }
            }
            scrollToBottom();
          }
          loadingHistory.value = false;
          // Show ready-for-input hint
          messages.value.push({
            id: ++messageIdCounter, role: 'system',
            content: 'Session restored. You can continue the conversation.',
            timestamp: new Date(),
          });
          scrollToBottom();
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
      getRenderedContent, copyMessage, toggleTool, isPrevAssistant,
      getToolIcon, getToolSummary, autoResize,
      // Theme
      theme, toggleTheme,
      // Sidebar
      sidebarOpen, historySessions, currentClaudeSessionId, loadingSessions, loadingHistory,
      toggleSidebar, resumeSession, newConversation, requestSessionList,
      formatRelativeTime, groupedSessions,
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

      <div v-else class="main-body">
        <!-- Sidebar -->
        <aside v-if="sidebarOpen" class="sidebar">
          <div class="sidebar-section">
            <div class="sidebar-workdir">
              <div class="sidebar-workdir-label">Working Directory</div>
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
          <div class="message-list">
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

              <div v-for="msg in messages" :key="msg.id" :class="['message', 'message-' + msg.role]">

                <!-- User message -->
                <template v-if="msg.role === 'user'">
                  <div class="message-role-label user-label">You</div>
                  <div class="message-bubble user-bubble">
                    <div class="message-content">{{ msg.content }}</div>
                  </div>
                </template>

                <!-- Assistant message (markdown) -->
                <template v-else-if="msg.role === 'assistant'">
                  <div v-if="!isPrevAssistant(msg)" class="message-role-label assistant-label">Claude</div>
                  <div :class="['message-bubble', 'assistant-bubble', { streaming: msg.isStreaming }]">
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
          </div>

          <div class="input-area">
            <div class="input-card">
              <textarea
                ref="inputRef"
                v-model="inputText"
                @keydown="handleKeydown"
                @input="autoResize"
                :disabled="status !== 'Connected'"
                placeholder="Send a message..."
                rows="1"
              ></textarea>
              <div class="input-bottom-row">
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
    </div>
  `
};

const app = createApp(App);
app.mount('#app');
