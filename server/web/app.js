// ── AgentLink Web UI — Main coordinator ──────────────────────────────────────
const { createApp, ref, nextTick, onMounted, onUnmounted, computed, watch } = Vue;

// Module imports
import { renderMarkdown, getToolIcon } from './modules/markdown.js';
import {
  isContextSummary, formatRelativeTime, formatTimestamp,
  getRenderedContent, copyMessage, isPrevAssistant, toggleContextSummary,
  toggleTool, getToolSummary, isEditTool, getFormattedToolInput, getEditDiffHtml,
} from './modules/messageHelpers.js';
import { formatFileSize, createFileAttachments } from './modules/fileAttachments.js';
import {
  selectQuestionOption, submitQuestionAnswer,
  hasQuestionAnswer, getQuestionResponseSummary,
} from './modules/askQuestion.js';
import { createStreaming } from './modules/streaming.js';
import { createSidebar } from './modules/sidebar.js';
import { createConnection } from './modules/connection.js';

// ── App ─────────────────────────────────────────────────────────────────────
const App = {
  setup() {
    // ── Reactive state ──
    const status = ref('Connecting...');
    const agentName = ref('');
    const hostname = ref('');
    const workDir = ref('');
    const sessionId = ref('');
    const error = ref('');
    const serverVersion = ref('');
    const agentVersion = ref('');
    const messages = ref([]);
    const visibleLimit = ref(50);
    const hasMoreMessages = computed(() => messages.value.length > visibleLimit.value);
    const visibleMessages = computed(() => {
      if (messages.value.length <= visibleLimit.value) return messages.value;
      return messages.value.slice(messages.value.length - visibleLimit.value);
    });
    function loadMoreMessages() {
      const el = document.querySelector('.message-list');
      const prevHeight = el ? el.scrollHeight : 0;
      visibleLimit.value += 50;
      nextTick(() => {
        if (el) el.scrollTop += el.scrollHeight - prevHeight;
      });
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

    // Delete confirmation dialog state
    const deleteConfirmOpen = ref(false);
    const deleteConfirmTitle = ref('');

    // Working directory history state
    const workDirHistory = ref([]);
    const workDirHistoryOpen = ref(false);

    // Authentication state
    const authRequired = ref(false);
    const authPassword = ref('');
    const authError = ref('');
    const authAttempts = ref(null);
    const authLocked = ref(false);

    // File attachment state
    const attachments = ref([]);
    const fileInputRef = ref(null);
    const dragOver = ref(false);

    // Theme
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

    // ── Scroll management ──
    let _scrollTimer = null;
    let _userScrolledUp = false;

    function onMessageListScroll(e) {
      const el = e.target;
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

    // ── Highlight.js scheduling ──
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

    // ── Create module instances ──

    const streaming = createStreaming({ messages, scrollToBottom });

    const fileAttach = createFileAttachments(attachments, fileInputRef, dragOver);

    // Sidebar needs wsSend, but connection creates wsSend.
    // Resolve circular dependency with a forwarding function.
    let _wsSend = () => {};

    const sidebar = createSidebar({
      wsSend: (msg) => _wsSend(msg),
      messages, isProcessing, sidebarOpen,
      historySessions, currentClaudeSessionId, needsResume,
      loadingSessions, loadingHistory, workDir, visibleLimit,
      folderPickerOpen, folderPickerPath, folderPickerEntries,
      folderPickerLoading, folderPickerSelected, streaming,
      deleteConfirmOpen, deleteConfirmTitle,
      workDirHistory, workDirHistoryOpen,
    });

    const { connect, wsSend, closeWs, submitPassword } = createConnection({
      status, agentName, hostname, workDir, sessionId, error,
      serverVersion, agentVersion,
      messages, isProcessing, isCompacting, visibleLimit,
      historySessions, currentClaudeSessionId, loadingSessions, loadingHistory,
      folderPickerLoading, folderPickerEntries, folderPickerPath,
      authRequired, authPassword, authError, authAttempts, authLocked,
      streaming, sidebar, scrollToBottom,
    });

    // Now wire up the forwarding function
    _wsSend = wsSend;

    // ── Computed ──
    const canSend = computed(() =>
      status.value === 'Connected' && (inputText.value.trim() || attachments.value.length > 0) && !isProcessing.value && !isCompacting.value
      && !messages.value.some(m => m.role === 'ask-question' && !m.answered)
    );

    // ── Auto-resize textarea ──
    function autoResize() {
      const ta = inputRef.value;
      if (ta) {
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
      }
    }

    // ── Send message ──
    function sendMessage() {
      if (!canSend.value) return;

      const text = inputText.value.trim();
      const files = attachments.value.slice();
      inputText.value = '';
      if (inputRef.value) inputRef.value.style.height = 'auto';

      const msgAttachments = files.map(f => ({
        name: f.name, size: f.size, isImage: f.isImage, thumbUrl: f.thumbUrl,
      }));

      messages.value.push({
        id: streaming.nextId(), role: 'user',
        content: text || (files.length > 0 ? `[${files.length} file${files.length > 1 ? 's' : ''} attached]` : ''),
        attachments: msgAttachments.length > 0 ? msgAttachments : undefined,
        timestamp: new Date(),
      });
      isProcessing.value = true;
      scrollToBottom(true);

      const payload = { type: 'chat', prompt: text || '(see attached files)' };
      if (needsResume.value && currentClaudeSessionId.value) {
        payload.resumeSessionId = currentClaudeSessionId.value;
        needsResume.value = false;
      }
      if (files.length > 0) {
        payload.files = files.map(f => ({
          name: f.name, mimeType: f.mimeType, data: f.data,
        }));
      }
      wsSend(payload);
      attachments.value = [];
    }

    function cancelExecution() {
      if (!isProcessing.value) return;
      wsSend({ type: 'cancel_execution' });
    }

    function handleKeydown(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    }

    // ── Template adapter wrappers ──
    // These adapt the module function signatures to the template's call conventions.
    function _isPrevAssistant(idx) {
      return isPrevAssistant(visibleMessages.value, idx);
    }

    function _submitQuestionAnswer(msg) {
      submitQuestionAnswer(msg, wsSend);
    }

    // ── Watchers ──
    const messageCount = computed(() => messages.value.length);
    watch(messageCount, () => { nextTick(scheduleHighlight); });

    watch(agentName, (name) => {
      document.title = name ? `${name} — AgentLink` : 'AgentLink';
    });

    // ── Lifecycle ──
    onMounted(() => { connect(scheduleHighlight); });
    onUnmounted(() => { closeWs(); streaming.cleanup(); });

    return {
      status, agentName, hostname, workDir, sessionId, error,
      serverVersion, agentVersion,
      messages, visibleMessages, hasMoreMessages, loadMoreMessages,
      inputText, isProcessing, isCompacting, canSend, inputRef,
      sendMessage, handleKeydown, cancelExecution, onMessageListScroll,
      getRenderedContent, copyMessage, toggleTool,
      isPrevAssistant: _isPrevAssistant,
      toggleContextSummary, formatTimestamp,
      getToolIcon, getToolSummary, isEditTool, getEditDiffHtml, getFormattedToolInput, autoResize,
      // AskUserQuestion
      selectQuestionOption,
      submitQuestionAnswer: _submitQuestionAnswer,
      hasQuestionAnswer, getQuestionResponseSummary,
      // Theme
      theme, toggleTheme,
      // Sidebar
      sidebarOpen, historySessions, currentClaudeSessionId, loadingSessions, loadingHistory,
      toggleSidebar: sidebar.toggleSidebar,
      resumeSession: sidebar.resumeSession,
      newConversation: sidebar.newConversation,
      requestSessionList: sidebar.requestSessionList,
      formatRelativeTime,
      groupedSessions: sidebar.groupedSessions,
      // Folder picker
      folderPickerOpen, folderPickerPath, folderPickerEntries,
      folderPickerLoading, folderPickerSelected,
      openFolderPicker: sidebar.openFolderPicker,
      folderPickerNavigateUp: sidebar.folderPickerNavigateUp,
      folderPickerSelectItem: sidebar.folderPickerSelectItem,
      folderPickerEnter: sidebar.folderPickerEnter,
      folderPickerGoToPath: sidebar.folderPickerGoToPath,
      confirmFolderPicker: sidebar.confirmFolderPicker,
      // Delete session
      deleteConfirmOpen, deleteConfirmTitle,
      deleteSession: sidebar.deleteSession,
      confirmDeleteSession: sidebar.confirmDeleteSession,
      cancelDeleteSession: sidebar.cancelDeleteSession,
      // Working directory history
      workDirHistory, workDirHistoryOpen,
      selectWorkDirHistory: sidebar.selectWorkDirHistory,
      removeWorkDirHistory: sidebar.removeWorkDirHistory,
      toggleWorkDirHistory: sidebar.toggleWorkDirHistory,
      // Authentication
      authRequired, authPassword, authError, authAttempts, authLocked,
      submitPassword,
      // File attachments
      attachments, fileInputRef, dragOver,
      triggerFileInput: fileAttach.triggerFileInput,
      handleFileSelect: fileAttach.handleFileSelect,
      removeAttachment: fileAttach.removeAttachment,
      formatFileSize,
      handleDragOver: fileAttach.handleDragOver,
      handleDragLeave: fileAttach.handleDragLeave,
      handleDrop: fileAttach.handleDrop,
      handlePaste: fileAttach.handlePaste,
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
                <div class="sidebar-workdir-actions">
                  <button class="sidebar-change-dir-btn" @click="toggleWorkDirHistory" title="Recent directories" :disabled="isProcessing" v-if="workDirHistory.length > 1">
                    <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>
                  </button>
                  <button class="sidebar-change-dir-btn" @click="openFolderPicker" title="Change working directory" :disabled="isProcessing">
                    <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
                  </button>
                </div>
              </div>
              <div class="sidebar-workdir-path" :title="workDir">{{ workDir }}</div>
              <!-- Workdir history dropdown -->
              <div v-if="workDirHistoryOpen && workDirHistory.length > 1" class="workdir-history-dropdown">
                <div
                  v-for="dir in workDirHistory" :key="dir"
                  :class="['workdir-history-item', { active: dir === workDir }]"
                  @click="selectWorkDirHistory(dir)"
                  :title="dir"
                >
                  <span class="workdir-history-path">{{ dir }}</span>
                  <button
                    v-if="dir !== workDir"
                    class="workdir-history-remove"
                    @click.stop="removeWorkDirHistory(dir)"
                    title="Remove from history"
                  >&times;</button>
                </div>
              </div>
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
                  <div class="session-meta">
                    <span>{{ formatRelativeTime(s.lastModified) }}</span>
                    <button
                      v-if="currentClaudeSessionId !== s.sessionId"
                      class="session-delete-btn"
                      @click.stop="deleteSession(s)"
                      title="Delete session"
                    >
                      <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-if="serverVersion || agentVersion" class="sidebar-version-footer">
            <span v-if="serverVersion">server {{ serverVersion }}</span>
            <span v-if="serverVersion && agentVersion" class="sidebar-version-sep">/</span>
            <span v-if="agentVersion">agent {{ agentVersion }}</span>
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
                    <div class="message-content">{{ msg.content }}</div>
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
                <div v-else-if="msg.role === 'system'" :class="['system-msg', { 'compact-msg': msg.isCompactStart, 'command-output-msg': msg.isCommandOutput, 'error-msg': msg.isError }]">
                  <template v-if="msg.isCompactStart && !msg.compactDone">
                    <span class="compact-inline-spinner"></span>
                  </template>
                  <template v-if="msg.isCompactStart && msg.compactDone">
                    <span class="compact-done-icon">✓</span>
                  </template>
                  <div v-if="msg.isCommandOutput" class="message-content markdown-body" v-html="getRenderedContent(msg)"></div>
                  <template v-else>{{ msg.content }}</template>
                </div>
              </div>

              <div v-if="isProcessing && !messages.some(m => m.isStreaming)" class="typing-indicator">
                <span></span><span></span><span></span>
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

      <!-- Delete Session Confirmation Dialog -->
      <div class="folder-picker-overlay" v-if="deleteConfirmOpen" @click.self="cancelDeleteSession">
        <div class="delete-confirm-dialog">
          <div class="delete-confirm-header">Delete Session</div>
          <div class="delete-confirm-body">
            <p>Are you sure you want to delete this session?</p>
            <p class="delete-confirm-title">{{ deleteConfirmTitle }}</p>
            <p class="delete-confirm-warning">This action cannot be undone.</p>
          </div>
          <div class="delete-confirm-footer">
            <button class="folder-picker-cancel" @click="cancelDeleteSession">Cancel</button>
            <button class="delete-confirm-btn" @click="confirmDeleteSession">Delete</button>
          </div>
        </div>
      </div>

      <!-- Password Authentication Dialog -->
      <div class="folder-picker-overlay" v-if="authRequired && !authLocked">
        <div class="auth-dialog">
          <div class="auth-dialog-header">
            <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
            <span>Session Protected</span>
          </div>
          <div class="auth-dialog-body">
            <p>This session requires a password to access.</p>
            <input
              type="password"
              class="auth-password-input"
              v-model="authPassword"
              @keydown.enter="submitPassword"
              placeholder="Enter password..."
              autofocus
            />
            <p v-if="authError" class="auth-error">{{ authError }}</p>
            <p v-if="authAttempts" class="auth-attempts">{{ authAttempts }}</p>
          </div>
          <div class="auth-dialog-footer">
            <button class="auth-submit-btn" @click="submitPassword" :disabled="!authPassword.trim()">Unlock</button>
          </div>
        </div>
      </div>

      <!-- Auth Locked Out -->
      <div class="folder-picker-overlay" v-if="authLocked">
        <div class="auth-dialog auth-dialog-locked">
          <div class="auth-dialog-header">
            <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>
            <span>Access Locked</span>
          </div>
          <div class="auth-dialog-body">
            <p>{{ authError }}</p>
            <p class="auth-locked-hint">Close this tab and try again later.</p>
          </div>
        </div>
      </div>
    </div>
  `
};

const app = createApp(App);
app.mount('#app');
