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
import { createFileBrowser } from './modules/fileBrowser.js';
import { createFilePreview } from './modules/filePreview.js';
import { createTeam } from './modules/team.js';
import { TEMPLATES, TEMPLATE_KEYS, buildFullLeadPrompt } from './modules/teamTemplates.js';
import { createLoop } from './modules/loop.js';
import { LOOP_TEMPLATES, LOOP_TEMPLATE_KEYS, buildCronExpression, formatSchedule } from './modules/loopTemplates.js';
import { createScrollManager, createHighlightScheduler, formatUsage } from './modules/appHelpers.js';
import { createI18n } from './modules/i18n.js';

// ── Slash commands ──────────────────────────────────────────────────────────
const SLASH_COMMANDS = [
  { command: '/cost', descKey: 'slash.cost' },
  { command: '/context', descKey: 'slash.context' },
  { command: '/compact', descKey: 'slash.compact' },
];

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
    const latency = ref(null);
    const queuedMessages = ref([]);
    const usageStats = ref(null);
    const inputRef = ref(null);
    const slashMenuIndex = ref(0);

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

    // Rename session state
    const renamingSessionId = ref(null);
    const renameText = ref('');

    // Team rename/delete state
    const renamingTeamId = ref(null);
    const renameTeamText = ref('');
    const deleteTeamConfirmOpen = ref(false);
    const deleteTeamConfirmTitle = ref('');
    const pendingDeleteTeamId = ref(null);

    // Working directory history
    const workdirHistory = ref([]);

    // Working directory switching loading state
    const workdirSwitching = ref(false);

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

    // Multi-session parallel state
    const conversationCache = ref({});          // conversationId → saved state snapshot
    const currentConversationId = ref(crypto.randomUUID());    // currently visible conversation
    const processingConversations = ref({});    // conversationId → boolean

    // File browser state
    const filePanelOpen = ref(false);
    const filePanelWidth = ref(parseInt(localStorage.getItem('agentlink-file-panel-width'), 10) || 280);
    const fileTreeRoot = ref(null);
    const fileTreeLoading = ref(false);
    const fileContextMenu = ref(null);
    const sidebarView = ref('sessions');       // 'sessions' | 'files' | 'preview' (mobile only)
    const isMobile = ref(window.innerWidth <= 768);
    const workdirMenuOpen = ref(false);
    const teamsCollapsed = ref(false);
    const chatsCollapsed = ref(false);
    const loopsCollapsed = ref(false);
    const _sidebarCollapseKey = () => hostname.value ? `agentlink-sidebar-collapsed-${hostname.value}` : null;
    const loadingTeams = ref(false);
    const loadingLoops = ref(false);

    // Team creation state
    const teamInstruction = ref('');
    const selectedTemplate = ref('custom');
    const editedLeadPrompt = ref(TEMPLATES.custom.leadPrompt);
    const leadPromptExpanded = ref(false);
    const teamExamples = [
      {
        icon: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z"/></svg>',
        title: 'Full-stack App',
        template: 'full-stack',
        text: 'Build a single-page calculator app: one agent creates the HTML/CSS UI, one implements the JavaScript logic, and one writes tests.',
      },
      {
        icon: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg>',
        title: 'Research',
        template: 'research',
        text: 'Research this project\'s architecture: one agent analyzes the backend structure, one maps the frontend components, and one reviews the build and deployment pipeline. Produce a unified architecture report.',
      },
      {
        icon: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>',
        title: '代码审查',
        template: 'code-review',
        text: '审查当前项目的代码质量、安全漏洞和测试覆盖率，按严重程度生成分级报告，并给出修复建议。',
      },
      {
        icon: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>',
        title: '技术文档',
        template: 'content',
        text: '为当前项目编写一份完整的技术文档：先调研项目结构和核心模块，然后撰写包含架构概览、API 参考和使用指南的文档，最后校审确保准确性和可读性。',
      },
    ];
    const kanbanExpanded = ref(false);
    const instructionExpanded = ref(false);

    // Loop creation/editing form state
    const loopName = ref('');
    const loopPrompt = ref('');
    const loopScheduleType = ref('daily');
    const loopScheduleHour = ref(9);
    const loopScheduleMinute = ref(0);
    const loopScheduleDayOfWeek = ref(1);
    const loopCronExpr = ref('0 9 * * *');
    const loopSelectedTemplate = ref(null);
    const loopDeleteConfirmOpen = ref(false);
    const loopDeleteConfirmId = ref(null);
    const loopDeleteConfirmName = ref('');
    const renamingLoopId = ref(null);
    const renameLoopText = ref('');

    // File preview state
    const previewPanelOpen = ref(false);
    const previewPanelWidth = ref(parseInt(localStorage.getItem('agentlink-preview-panel-width'), 10) || 400);
    const previewFile = ref(null);
    const previewLoading = ref(false);
    const previewMarkdownRendered = ref(false);

    // ── switchConversation: save current → load target ──
    // Defined here and used by sidebar.newConversation, sidebar.resumeSession, workdir_changed
    // Needs access to streaming / connection which are created later, so we use late-binding refs.
    let _getToolMsgMap = () => new Map();
    let _restoreToolMsgMap = () => {};
    let _clearToolMsgMap = () => {};

    function switchConversation(newConvId) {
      const oldConvId = currentConversationId.value;

      // Save current state (if there is one)
      if (oldConvId) {
        const streamState = streaming.saveState();
        conversationCache.value[oldConvId] = {
          messages: messages.value,
          isProcessing: isProcessing.value,
          isCompacting: isCompacting.value,
          loadingHistory: loadingHistory.value,
          claudeSessionId: currentClaudeSessionId.value,
          visibleLimit: visibleLimit.value,
          needsResume: needsResume.value,
          streamingState: streamState,
          toolMsgMap: _getToolMsgMap(),
          messageIdCounter: streaming.getMessageIdCounter(),
          queuedMessages: queuedMessages.value,
          usageStats: usageStats.value,
        };
      }

      // Load target state
      const cached = conversationCache.value[newConvId];
      if (cached) {
        messages.value = cached.messages;
        isProcessing.value = cached.isProcessing;
        isCompacting.value = cached.isCompacting;
        loadingHistory.value = cached.loadingHistory || false;
        currentClaudeSessionId.value = cached.claudeSessionId;
        visibleLimit.value = cached.visibleLimit;
        needsResume.value = cached.needsResume;
        streaming.restoreState(cached.streamingState || { pendingText: '', streamingMessageId: null, messageIdCounter: cached.messageIdCounter || 0 });
        // Background routing may have incremented messageIdCounter beyond what
        // streamingState recorded at save time — use the authoritative value.
        streaming.setMessageIdCounter(cached.messageIdCounter || 0);
        _restoreToolMsgMap(cached.toolMsgMap || new Map());
        queuedMessages.value = cached.queuedMessages || [];
        usageStats.value = cached.usageStats || null;
      } else {
        // New blank conversation
        messages.value = [];
        isProcessing.value = false;
        isCompacting.value = false;
        loadingHistory.value = false;
        currentClaudeSessionId.value = null;
        visibleLimit.value = 50;
        needsResume.value = false;
        streaming.setMessageIdCounter(0);
        streaming.setStreamingMessageId(null);
        streaming.reset();
        _clearToolMsgMap();
        queuedMessages.value = [];
        usageStats.value = null;
      }

      currentConversationId.value = newConvId;
      scrollToBottom(true);
    }

    // Theme
    const theme = ref(localStorage.getItem('agentlink-theme') || 'light');
    function applyTheme() {
      document.documentElement.setAttribute('data-theme', theme.value);
      const link = document.getElementById('hljs-theme');
      if (link) link.href = theme.value === 'light'
        ? '/vendor/github.min.css'
        : '/vendor/github-dark.min.css';
    }
    function toggleTheme() {
      theme.value = theme.value === 'dark' ? 'light' : 'dark';
      localStorage.setItem('agentlink-theme', theme.value);
      applyTheme();
    }
    applyTheme();

    // ── i18n ──
    const { t, locale, setLocale, toggleLocale, localeLabel } = createI18n();

    // Map internal English status values to translated display strings
    const STATUS_KEYS = {
      'No Session': 'status.noSession',
      'Connecting...': 'status.connecting',
      'Connected': 'status.connected',
      'Waiting': 'status.waiting',
      'Reconnecting...': 'status.reconnecting',
      'Disconnected': 'status.disconnected',
      'Authentication Required': 'status.authRequired',
      'Locked': 'status.locked',
    };
    const displayStatus = computed(() => {
      const key = STATUS_KEYS[status.value];
      return key ? t(key) : status.value;
    });

    // ── Scroll management ──
    const { onScroll: onMessageListScroll, scrollToBottom, cleanup: cleanupScroll } = createScrollManager('.message-list');

    // ── Highlight.js scheduling ──
    const { scheduleHighlight, cleanup: cleanupHighlight } = createHighlightScheduler();

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
      renamingSessionId, renameText,
      hostname, workdirHistory, workdirSwitching,
      // Multi-session parallel
      currentConversationId, conversationCache, processingConversations,
      switchConversation,
      // i18n
      t,
    });
    const { connect, wsSend, closeWs, submitPassword, setDequeueNext, setFileBrowser, setFilePreview, setTeam, setLoop, getToolMsgMap, restoreToolMsgMap, clearToolMsgMap } = createConnection({
      status, agentName, hostname, workDir, sessionId, error,
      serverVersion, agentVersion, latency,
      messages, isProcessing, isCompacting, visibleLimit, queuedMessages, usageStats,
      historySessions, currentClaudeSessionId, needsResume, loadingSessions, loadingHistory,
      folderPickerLoading, folderPickerEntries, folderPickerPath,
      authRequired, authPassword, authError, authAttempts, authLocked,
      streaming, sidebar, scrollToBottom,
      workdirSwitching,
      // Multi-session parallel
      currentConversationId, processingConversations, conversationCache,
      switchConversation,
      // i18n
      t,
    });

    // Now wire up the forwarding function
    _wsSend = wsSend;
    setDequeueNext(dequeueNext);
    // Wire up late-binding toolMsgMap functions for switchConversation
    _getToolMsgMap = getToolMsgMap;
    _restoreToolMsgMap = restoreToolMsgMap;
    _clearToolMsgMap = clearToolMsgMap;

    // Team module
    const team = createTeam({
      wsSend, scrollToBottom,
    });
    setTeam(team);
    // Loop module
    const loop = createLoop({
      wsSend, scrollToBottom,
    });
    setLoop(loop);
    sidebar.setOnSwitchToChat(() => {
      team.viewMode.value = 'chat';
      team.historicalTeam.value = null;
    });

    // File browser module
    const fileBrowser = createFileBrowser({
      wsSend, workDir, inputText, inputRef, sendMessage,
      filePanelOpen, filePanelWidth, fileTreeRoot, fileTreeLoading, fileContextMenu,
      sidebarOpen, sidebarView,
    });
    setFileBrowser(fileBrowser);

    // File preview module
    const filePreview = createFilePreview({
      wsSend, previewPanelOpen, previewPanelWidth, previewFile, previewLoading,
      previewMarkdownRendered, sidebarView, sidebarOpen, isMobile, renderMarkdown,
    });
    setFilePreview(filePreview);

    // Track mobile state on resize
    let _resizeHandler = () => { isMobile.value = window.innerWidth <= 768; };
    window.addEventListener('resize', _resizeHandler);

    // Close workdir menu on outside click or Escape
    let _workdirMenuClickHandler = (e) => {
      if (!workdirMenuOpen.value) return;
      const row = document.querySelector('.sidebar-workdir-path-row');
      const menu = document.querySelector('.workdir-menu');
      if ((row && row.contains(e.target)) || (menu && menu.contains(e.target))) return;
      workdirMenuOpen.value = false;
    };
    let _workdirMenuKeyHandler = (e) => {
      if (e.key === 'Escape' && workdirMenuOpen.value) workdirMenuOpen.value = false;
    };
    document.addEventListener('click', _workdirMenuClickHandler);
    document.addEventListener('keydown', _workdirMenuKeyHandler);

    // ── Computed ──
    const hasInput = computed(() => !!(inputText.value.trim() || attachments.value.length > 0));
    const canSend = computed(() =>
      status.value === 'Connected' && hasInput.value && !isCompacting.value
      && !messages.value.some(m => m.role === 'ask-question' && !m.answered)
    );

    // ── Slash command menu ──
    const slashMenuVisible = computed(() => {
      const txt = inputText.value;
      return txt.startsWith('/') && !/\s/.test(txt.slice(1));
    });
    const filteredSlashCommands = computed(() => {
      const txt = inputText.value.toLowerCase();
      return SLASH_COMMANDS.filter(c => c.command.startsWith(txt));
    });
    watch(filteredSlashCommands, () => { slashMenuIndex.value = 0; });

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

      const payload = { type: 'chat', prompt: text || '(see attached files)' };
      if (currentConversationId.value) {
        payload.conversationId = currentConversationId.value;
      }
      if (needsResume.value && currentClaudeSessionId.value) {
        payload.resumeSessionId = currentClaudeSessionId.value;
        needsResume.value = false;
      }
      if (files.length > 0) {
        payload.files = files.map(f => ({
          name: f.name, mimeType: f.mimeType, data: f.data,
        }));
      }

      const userMsg = {
        id: streaming.nextId(), role: 'user',
        content: text || (files.length > 0 ? `[${files.length} file${files.length > 1 ? 's' : ''} attached]` : ''),
        attachments: msgAttachments.length > 0 ? msgAttachments : undefined,
        timestamp: new Date(),
      };

      if (isProcessing.value) {
        queuedMessages.value.push({ id: streaming.nextId(), content: userMsg.content, attachments: userMsg.attachments, payload });
      } else {
        userMsg.status = 'sent';
        messages.value.push(userMsg);
        isProcessing.value = true;
        if (currentConversationId.value) {
          processingConversations.value[currentConversationId.value] = true;
        }
        wsSend(payload);
      }
      scrollToBottom(true);
      attachments.value = [];
    }

    function cancelExecution() {
      if (!isProcessing.value) return;
      const cancelPayload = { type: 'cancel_execution' };
      if (currentConversationId.value) {
        cancelPayload.conversationId = currentConversationId.value;
      }
      wsSend(cancelPayload);
    }

    function dequeueNext() {
      if (queuedMessages.value.length === 0) return;
      const queued = queuedMessages.value.shift();
      const userMsg = {
        id: queued.id, role: 'user', status: 'sent',
        content: queued.content, attachments: queued.attachments,
        timestamp: new Date(),
      };
      messages.value.push(userMsg);
      isProcessing.value = true;
      if (currentConversationId.value) {
        processingConversations.value[currentConversationId.value] = true;
      }
      wsSend(queued.payload);
      scrollToBottom(true);
    }

    function removeQueuedMessage(msgId) {
      const idx = queuedMessages.value.findIndex(m => m.id === msgId);
      if (idx !== -1) queuedMessages.value.splice(idx, 1);
    }

    function selectSlashCommand(cmd) {
      inputText.value = cmd.command;
      sendMessage();
    }

    function handleKeydown(e) {
      // Slash menu key handling
      if (slashMenuVisible.value && filteredSlashCommands.value.length > 0 && !e.isComposing) {
        const len = filteredSlashCommands.value.length;
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          slashMenuIndex.value = (slashMenuIndex.value + 1) % len;
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          slashMenuIndex.value = (slashMenuIndex.value - 1 + len) % len;
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          selectSlashCommand(filteredSlashCommands.value[slashMenuIndex.value]);
          return;
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          inputText.value = filteredSlashCommands.value[slashMenuIndex.value].command;
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          inputText.value = '';
          return;
        }
      }

      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
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

    watch(hostname, (name) => {
      document.title = name ? `${name} — AgentLink` : 'AgentLink';
      // Restore sidebar collapsed states from localStorage
      const key = _sidebarCollapseKey();
      if (key) {
        try {
          const saved = JSON.parse(localStorage.getItem(key) || '{}');
          if (saved.chats !== undefined) chatsCollapsed.value = saved.chats;
          if (saved.teams !== undefined) teamsCollapsed.value = saved.teams;
          if (saved.loops !== undefined) loopsCollapsed.value = saved.loops;
        } catch (_) { /* ignore */ }
      }
    });

    // Persist sidebar collapsed states to localStorage
    const _saveSidebarCollapsed = () => {
      const key = _sidebarCollapseKey();
      if (key) {
        localStorage.setItem(key, JSON.stringify({
          chats: chatsCollapsed.value,
          teams: teamsCollapsed.value,
          loops: loopsCollapsed.value,
        }));
      }
    };
    watch(chatsCollapsed, _saveSidebarCollapsed);
    watch(teamsCollapsed, _saveSidebarCollapsed);
    watch(loopsCollapsed, _saveSidebarCollapsed);

    watch(team.teamsList, () => { loadingTeams.value = false; });
    watch(loop.loopsList, () => { loadingLoops.value = false; });

    // ── Lifecycle ──
    onMounted(() => { connect(scheduleHighlight); });
    onUnmounted(() => {
      closeWs(); streaming.cleanup(); cleanupScroll(); cleanupHighlight();
      window.removeEventListener('resize', _resizeHandler);
      document.removeEventListener('click', _workdirMenuClickHandler);
      document.removeEventListener('keydown', _workdirMenuKeyHandler);
    });

    return {
      status, agentName, hostname, workDir, sessionId, error,
      serverVersion, agentVersion, latency,
      messages, visibleMessages, hasMoreMessages, loadMoreMessages,
      inputText, isProcessing, isCompacting, canSend, hasInput, inputRef, queuedMessages, usageStats,
      slashMenuVisible, filteredSlashCommands, slashMenuIndex, selectSlashCommand,
      sendMessage, handleKeydown, cancelExecution, removeQueuedMessage, onMessageListScroll,
      getRenderedContent, copyMessage, toggleTool,
      isPrevAssistant: _isPrevAssistant,
      toggleContextSummary, formatTimestamp, formatUsage: (u) => formatUsage(u, t),
      getToolIcon, getToolSummary: (msg) => getToolSummary(msg, t), isEditTool, getEditDiffHtml: (msg) => getEditDiffHtml(msg, t), getFormattedToolInput: (msg) => getFormattedToolInput(msg, t), autoResize,
      // AskUserQuestion
      selectQuestionOption,
      submitQuestionAnswer: _submitQuestionAnswer,
      hasQuestionAnswer, getQuestionResponseSummary,
      // Theme
      theme, toggleTheme,
      // i18n
      t, locale, toggleLocale, localeLabel, displayStatus,
      // Sidebar
      sidebarOpen, historySessions, currentClaudeSessionId, loadingSessions, loadingHistory,
      toggleSidebar: sidebar.toggleSidebar,
      resumeSession: sidebar.resumeSession,
      newConversation: sidebar.newConversation,
      requestSessionList: sidebar.requestSessionList,
      formatRelativeTime: (ts) => formatRelativeTime(ts, t),
      groupedSessions: sidebar.groupedSessions,
      isSessionProcessing: sidebar.isSessionProcessing,
      processingConversations,
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
      // Rename session
      renamingSessionId, renameText,
      startRename: sidebar.startRename,
      confirmRename: sidebar.confirmRename,
      cancelRename: sidebar.cancelRename,
      // Team rename/delete
      renamingTeamId, renameTeamText,
      deleteTeamConfirmOpen, deleteTeamConfirmTitle, pendingDeleteTeamId,
      startTeamRename(tm) {
        renamingTeamId.value = tm.teamId;
        renameTeamText.value = tm.title || '';
      },
      confirmTeamRename() {
        const tid = renamingTeamId.value;
        const title = renameTeamText.value.trim();
        if (!tid || !title) { renamingTeamId.value = null; renameTeamText.value = ''; return; }
        team.renameTeamById(tid, title);
        renamingTeamId.value = null;
        renameTeamText.value = '';
      },
      cancelTeamRename() {
        renamingTeamId.value = null;
        renameTeamText.value = '';
      },
      requestDeleteTeam(tm) {
        pendingDeleteTeamId.value = tm.teamId;
        deleteTeamConfirmTitle.value = tm.title || tm.teamId.slice(0, 8);
        deleteTeamConfirmOpen.value = true;
      },
      confirmDeleteTeam() {
        if (!pendingDeleteTeamId.value) return;
        team.deleteTeamById(pendingDeleteTeamId.value);
        deleteTeamConfirmOpen.value = false;
        pendingDeleteTeamId.value = null;
      },
      cancelDeleteTeam() {
        deleteTeamConfirmOpen.value = false;
        pendingDeleteTeamId.value = null;
      },
      // Working directory history
      filteredWorkdirHistory: sidebar.filteredWorkdirHistory,
      switchToWorkdir: sidebar.switchToWorkdir,
      removeFromWorkdirHistory: sidebar.removeFromWorkdirHistory,
      workdirSwitching,
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
      // File browser
      filePanelOpen, filePanelWidth, fileTreeRoot, fileTreeLoading, fileContextMenu,
      sidebarView, isMobile, fileBrowser,
      flattenedTree: fileBrowser.flattenedTree,
      // File preview
      previewPanelOpen, previewPanelWidth, previewFile, previewLoading, previewMarkdownRendered, filePreview,
      workdirMenuOpen,
      teamsCollapsed, chatsCollapsed, loopsCollapsed, loadingTeams, loadingLoops,
      toggleWorkdirMenu() { workdirMenuOpen.value = !workdirMenuOpen.value; },
      workdirMenuBrowse() {
        workdirMenuOpen.value = false;
        if (isMobile.value) { sidebarView.value = 'files'; fileBrowser.openPanel(); }
        else { fileBrowser.togglePanel(); }
      },
      workdirMenuChangeDir() {
        workdirMenuOpen.value = false;
        sidebar.openFolderPicker();
      },
      workdirMenuCopyPath() {
        workdirMenuOpen.value = false;
        navigator.clipboard.writeText(workDir.value);
      },
      // Team mode
      team,
      teamState: team.teamState,
      viewMode: team.viewMode,
      activeAgentView: team.activeAgentView,
      historicalTeam: team.historicalTeam,
      teamsList: team.teamsList,
      isTeamActive: team.isTeamActive,
      isTeamRunning: team.isTeamRunning,
      displayTeam: team.displayTeam,
      pendingTasks: team.pendingTasks,
      activeTasks: team.activeTasks,
      doneTasks: team.doneTasks,
      failedTasks: team.failedTasks,
      launchTeam: team.launchTeam,
      dissolveTeam: team.dissolveTeam,
      viewAgent: team.viewAgent,
      viewDashboard: team.viewDashboard,
      viewHistoricalTeam: team.viewHistoricalTeam,
      requestTeamsList() {
        loadingTeams.value = true;
        team.requestTeamsList();
      },
      deleteTeamById: team.deleteTeamById,
      renameTeamById: team.renameTeamById,
      getAgentColor: team.getAgentColor,
      findAgent: team.findAgent,
      getAgentMessages: team.getAgentMessages,
      backToChat: team.backToChat,
      newTeam: team.newTeam,
      teamInstruction,
      teamExamples,
      kanbanExpanded,
      instructionExpanded,
      selectedTemplate,
      editedLeadPrompt,
      leadPromptExpanded,
      TEMPLATES,
      TEMPLATE_KEYS,
      onTemplateChange(key) {
        selectedTemplate.value = key;
        editedLeadPrompt.value = TEMPLATES[key].leadPrompt;
      },
      resetLeadPrompt() {
        editedLeadPrompt.value = TEMPLATES[selectedTemplate.value].leadPrompt;
      },
      leadPromptPreview() {
        const text = editedLeadPrompt.value || '';
        return text.length > 80 ? text.slice(0, 80) + '...' : text;
      },
      launchTeamFromPanel() {
        const inst = teamInstruction.value.trim();
        if (!inst) return;
        const tplKey = selectedTemplate.value;
        const tpl = TEMPLATES[tplKey];
        const agents = tpl.agents;
        const leadPrompt = buildFullLeadPrompt(editedLeadPrompt.value, agents, inst);
        team.launchTeam(inst, leadPrompt, agents);
        teamInstruction.value = '';
        // Reset template state for next time
        selectedTemplate.value = 'custom';
        editedLeadPrompt.value = TEMPLATES.custom.leadPrompt;
        leadPromptExpanded.value = false;
      },
      formatTeamTime(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      },
      getTaskAgent(task) {
        const assignee = task.assignee || task.assignedTo;
        if (!assignee) return null;
        return team.findAgent(assignee);
      },
      viewAgentWithHistory(agentId) {
        team.viewAgent(agentId);
        // For historical teams, request agent conversation history from server
        if (team.historicalTeam.value && team.historicalTeam.value.teamId) {
          team.requestAgentHistory(team.historicalTeam.value.teamId, agentId);
        }
      },
      feedAgentName(entry) {
        if (!entry.agentId) return null;
        const agent = team.findAgent(entry.agentId);
        if (!agent || !agent.name) return null;
        // Verify the content actually starts with this agent name
        if (entry.content && entry.content.startsWith(agent.name)) {
          return agent.name;
        }
        return null;
      },
      feedContentRest(entry) {
        const name = this.feedAgentName(entry);
        if (name && entry.content && entry.content.startsWith(name)) {
          return entry.content.slice(name.length);
        }
        return entry.content || '';
      },
      getLatestAgentActivity(agentId) {
        // Find the latest feed entry for this agent
        const t = team.displayTeam.value;
        if (!t || !t.feed) return '';
        for (let i = t.feed.length - 1; i >= 0; i--) {
          const entry = t.feed[i];
          if (entry.agentId === agentId && entry.type === 'tool_call') {
            // Strip agent name prefix since it's already shown on the card
            const agent = team.findAgent(agentId);
            if (agent && agent.name && entry.content.startsWith(agent.name)) {
              return entry.content.slice(agent.name.length).trimStart();
            }
            return entry.content;
          }
        }
        return '';
      },
      // Loop mode
      loop,
      loopsList: loop.loopsList,
      selectedLoop: loop.selectedLoop,
      selectedExecution: loop.selectedExecution,
      executionHistory: loop.executionHistory,
      executionMessages: loop.executionMessages,
      runningLoops: loop.runningLoops,
      loadingExecutions: loop.loadingExecutions,
      loadingExecution: loop.loadingExecution,
      editingLoopId: loop.editingLoopId,
      hasRunningLoop: loop.hasRunningLoop,
      firstRunningLoop: loop.firstRunningLoop,
      loopError: loop.loopError,
      hasMoreExecutions: loop.hasMoreExecutions,
      loadingMoreExecutions: loop.loadingMoreExecutions,
      toggleLoop: loop.toggleLoop,
      runNow: loop.runNow,
      cancelLoopExecution: loop.cancelExecution,
      viewLoopDetail: loop.viewLoopDetail,
      viewExecution: loop.viewExecution,
      backToLoopsList: loop.backToLoopsList,
      backToLoopDetail: loop.backToLoopDetail,
      LOOP_TEMPLATES, LOOP_TEMPLATE_KEYS,
      buildCronExpression, formatSchedule,
      // Loop form state
      loopName, loopPrompt, loopScheduleType,
      loopScheduleHour, loopScheduleMinute, loopScheduleDayOfWeek,
      loopCronExpr, loopSelectedTemplate,
      loopDeleteConfirmOpen, loopDeleteConfirmId, loopDeleteConfirmName,
      renamingLoopId, renameLoopText,
      startLoopRename(l) {
        renamingLoopId.value = l.id;
        renameLoopText.value = l.name || '';
      },
      confirmLoopRename() {
        const lid = renamingLoopId.value;
        const name = renameLoopText.value.trim();
        if (!lid || !name) { renamingLoopId.value = null; renameLoopText.value = ''; return; }
        loop.updateExistingLoop(lid, { name });
        renamingLoopId.value = null;
        renameLoopText.value = '';
      },
      cancelLoopRename() {
        renamingLoopId.value = null;
        renameLoopText.value = '';
      },
      requestLoopsList() {
        loadingLoops.value = true;
        loop.requestLoopsList();
      },
      newLoop() {
        loop.backToLoopsList();
        loop.editingLoopId.value = null;
        loopSelectedTemplate.value = null;
        loopName.value = '';
        loopPrompt.value = '';
        loopScheduleType.value = 'daily';
        loopScheduleHour.value = 9;
        loopScheduleMinute.value = 0;
        loopScheduleDayOfWeek.value = 1;
        loopCronExpr.value = '0 9 * * *';
        team.viewMode.value = 'loop';
      },
      viewLoop(loopId) {
        loop.viewLoopDetail(loopId);
        team.viewMode.value = 'loop';
      },
      selectLoopTemplate(key) {
        loopSelectedTemplate.value = key;
        const tpl = LOOP_TEMPLATES[key];
        if (!tpl) return;
        loopName.value = tpl.name || '';
        loopPrompt.value = tpl.prompt || '';
        loopScheduleType.value = tpl.scheduleType || 'daily';
        const cfg = tpl.scheduleConfig || {};
        loopScheduleHour.value = cfg.hour ?? 9;
        loopScheduleMinute.value = cfg.minute ?? 0;
        loopScheduleDayOfWeek.value = cfg.dayOfWeek ?? 1;
        loopCronExpr.value = buildCronExpression(tpl.scheduleType || 'daily', cfg);
      },
      resetLoopForm() {
        loopSelectedTemplate.value = null;
        loopName.value = '';
        loopPrompt.value = '';
        loopScheduleType.value = 'daily';
        loopScheduleHour.value = 9;
        loopScheduleMinute.value = 0;
        loopScheduleDayOfWeek.value = 1;
        loopCronExpr.value = '0 9 * * *';
        loop.editingLoopId.value = null;
      },
      createLoopFromPanel() {
        const name = loopName.value.trim();
        const prompt = loopPrompt.value.trim();
        if (!name || !prompt) return;
        loop.clearLoopError();
        const schedCfg = { hour: loopScheduleHour.value, minute: loopScheduleMinute.value };
        if (loopScheduleType.value === 'weekly') schedCfg.dayOfWeek = loopScheduleDayOfWeek.value;
        if (loopScheduleType.value === 'cron') schedCfg.cronExpression = loopCronExpr.value;
        const schedule = loopScheduleType.value === 'manual' ? ''
          : loopScheduleType.value === 'cron' ? loopCronExpr.value
          : buildCronExpression(loopScheduleType.value, schedCfg);
        loop.createNewLoop({ name, prompt, schedule, scheduleType: loopScheduleType.value, scheduleConfig: schedCfg });
        // Reset form
        loopSelectedTemplate.value = null;
        loopName.value = '';
        loopPrompt.value = '';
        loopScheduleType.value = 'daily';
        loopScheduleHour.value = 9;
        loopScheduleMinute.value = 0;
        loopScheduleDayOfWeek.value = 1;
        loopCronExpr.value = '0 9 * * *';
      },
      startEditingLoop(l) {
        loop.editingLoopId.value = l.id;
        loopName.value = l.name || '';
        loopPrompt.value = l.prompt || '';
        loopScheduleType.value = l.scheduleType || 'daily';
        const cfg = l.scheduleConfig || {};
        loopScheduleHour.value = cfg.hour ?? 9;
        loopScheduleMinute.value = cfg.minute ?? 0;
        loopScheduleDayOfWeek.value = cfg.dayOfWeek ?? 1;
        loopCronExpr.value = l.schedule || buildCronExpression(l.scheduleType || 'daily', cfg);
      },
      saveLoopEdits() {
        const lid = loop.editingLoopId.value;
        if (!lid) return;
        const name = loopName.value.trim();
        const prompt = loopPrompt.value.trim();
        if (!name || !prompt) return;
        loop.clearLoopError();
        const schedCfg = { hour: loopScheduleHour.value, minute: loopScheduleMinute.value };
        if (loopScheduleType.value === 'weekly') schedCfg.dayOfWeek = loopScheduleDayOfWeek.value;
        if (loopScheduleType.value === 'cron') schedCfg.cronExpression = loopCronExpr.value;
        const schedule = loopScheduleType.value === 'manual' ? ''
          : loopScheduleType.value === 'cron' ? loopCronExpr.value
          : buildCronExpression(loopScheduleType.value, schedCfg);
        loop.updateExistingLoop(lid, { name, prompt, schedule, scheduleType: loopScheduleType.value, scheduleConfig: schedCfg });
        loop.editingLoopId.value = null;
        loopName.value = '';
        loopPrompt.value = '';
      },
      cancelEditingLoop() {
        loop.editingLoopId.value = null;
        loopName.value = '';
        loopPrompt.value = '';
        loopScheduleType.value = 'daily';
        loopScheduleHour.value = 9;
        loopScheduleMinute.value = 0;
      },
      requestDeleteLoop(l) {
        loopDeleteConfirmId.value = l.id;
        loopDeleteConfirmName.value = l.name || l.id.slice(0, 8);
        loopDeleteConfirmOpen.value = true;
      },
      confirmDeleteLoop() {
        if (!loopDeleteConfirmId.value) return;
        loop.deleteExistingLoop(loopDeleteConfirmId.value);
        loopDeleteConfirmOpen.value = false;
        loopDeleteConfirmId.value = null;
      },
      cancelDeleteLoop() {
        loopDeleteConfirmOpen.value = false;
        loopDeleteConfirmId.value = null;
      },
      loadMoreExecutions() {
        loop.loadMoreExecutions();
      },
      clearLoopError() {
        loop.clearLoopError();
      },
      loopScheduleDisplay(l) {
        return formatSchedule(l.scheduleType, l.scheduleConfig || {}, l.schedule);
      },
      loopLastRunDisplay(l) {
        if (!l.lastExecution) return '';
        const exec = l.lastExecution;
        const ago = formatRelativeTime(exec.startedAt, t);
        const icon = exec.status === 'success' ? 'OK' : exec.status === 'error' ? 'ERR' : exec.status;
        return ago + ' ' + icon;
      },
      formatExecTime(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      },
      formatDuration(ms) {
        if (!ms && ms !== 0) return '';
        const secs = Math.floor(ms / 1000);
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        return m + 'm ' + String(s).padStart(2, '0') + 's';
      },
      isLoopRunning(loopId) {
        return !!loop.runningLoops.value[loopId];
      },
      padTwo(n) {
        return String(n).padStart(2, '0');
      },
    };
  },
  template: `
    <div class="layout">
      <header class="top-bar">
        <div class="top-bar-left">
          <button class="sidebar-toggle" @click="toggleSidebar" :title="t('header.toggleSidebar')">
            <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>
          </button>
          <h1>AgentLink</h1>
        </div>
        <div class="top-bar-info">
          <span :class="['badge', status.toLowerCase()]">{{ displayStatus }}</span>
          <span v-if="latency !== null && status === 'Connected'" class="latency" :class="{ good: latency < 100, ok: latency >= 100 && latency < 500, bad: latency >= 500 }">{{ latency }}ms</span>
          <span v-if="agentName" class="agent-label">{{ agentName }}</span>
          <div class="team-mode-toggle">
            <button :class="['team-mode-btn', { active: viewMode === 'chat' }]" @click="viewMode = 'chat'">{{ t('header.chat') }}</button>
            <button :class="['team-mode-btn', { active: viewMode === 'team' }]" @click="viewMode = 'team'">{{ t('header.team') }}</button>
            <button :class="['team-mode-btn', { active: viewMode === 'loop' }]" @click="viewMode = 'loop'">{{ t('header.loop') }}</button>
          </div>
          <select class="team-mode-select" :value="viewMode" @change="viewMode = $event.target.value">
            <option value="chat">{{ t('header.chat') }}</option>
            <option value="team">{{ t('header.team') }}</option>
            <option value="loop">{{ t('header.loop') }}</option>
          </select>
          <button class="theme-toggle" @click="toggleTheme" :title="theme === 'dark' ? t('header.lightMode') : t('header.darkMode')">
            <svg v-if="theme === 'dark'" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58a.996.996 0 0 0-1.41 0 .996.996 0 0 0 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37a.996.996 0 0 0-1.41 0 .996.996 0 0 0 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0a.996.996 0 0 0 0-1.41l-1.06-1.06zm1.06-10.96a.996.996 0 0 0 0-1.41.996.996 0 0 0-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36a.996.996 0 0 0 0-1.41.996.996 0 0 0-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z"/></svg>
            <svg v-else viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/></svg>
          </button>
          <button class="theme-toggle" @click="toggleLocale" :title="localeLabel">{{ localeLabel }}</button>
        </div>
      </header>

      <div v-if="status === 'No Session' || (status !== 'Connected' && status !== 'Connecting...' && status !== 'Reconnecting...' && messages.length === 0)" class="center-card">
        <div class="status-card">
          <p class="status">
            <span class="label">{{ t('statusCard.status') }}</span>
            <span :class="['badge', status.toLowerCase()]">{{ displayStatus }}</span>
          </p>
          <p v-if="agentName" class="info"><span class="label">{{ t('statusCard.agent') }}</span> {{ agentName }}</p>
          <p v-if="workDir" class="info"><span class="label">{{ t('statusCard.directory') }}</span> {{ workDir }}</p>
          <p v-if="sessionId" class="info muted"><span class="label">{{ t('statusCard.session') }}</span> {{ sessionId }}</p>
          <p v-if="error" class="error-msg">{{ error }}</p>
        </div>
      </div>

      <div v-else class="main-body">
        <!-- Sidebar backdrop (mobile) -->
        <div v-if="sidebarOpen" class="sidebar-backdrop" @click="toggleSidebar(); sidebarView = 'sessions'"></div>
        <!-- Sidebar -->
        <aside v-if="sidebarOpen" class="sidebar">
          <!-- Mobile: file browser view -->
          <div v-if="isMobile && sidebarView === 'files'" class="file-panel-mobile">
            <div class="file-panel-mobile-header">
              <button class="file-panel-mobile-back" @click="sidebarView = 'sessions'">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
                {{ t('sidebar.sessions') }}
              </button>
              <button class="file-panel-btn" @click="fileBrowser.refreshTree()" :title="t('sidebar.refresh')">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
              </button>
            </div>
            <div class="file-panel-breadcrumb" :title="workDir">{{ workDir }}</div>
            <div v-if="fileTreeLoading" class="file-panel-loading">{{ t('filePanel.loading') }}</div>
            <div v-else-if="!fileTreeRoot || !fileTreeRoot.children || fileTreeRoot.children.length === 0" class="file-panel-empty">
              {{ t('filePanel.noFiles') }}
            </div>
            <div v-else class="file-tree">
              <template v-for="item in flattenedTree" :key="item.node.path">
                <div
                  class="file-tree-item"
                  :class="{ folder: item.node.type === 'directory' }"
                  :style="{ paddingLeft: (item.depth * 16 + 8) + 'px' }"
                  @click="item.node.type === 'directory' ? fileBrowser.toggleFolder(item.node) : filePreview.openPreview(item.node.path)"
                  @contextmenu.prevent="item.node.type !== 'directory' ? fileBrowser.onFileClick($event, item.node) : null"
                >
                  <span v-if="item.node.type === 'directory'" class="file-tree-arrow" :class="{ expanded: item.node.expanded }">&#9654;</span>
                  <span v-else class="file-tree-file-icon">
                    <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></svg>
                  </span>
                  <span class="file-tree-name" :title="item.node.path">{{ item.node.name }}</span>
                  <span v-if="item.node.loading" class="file-tree-spinner"></span>
                </div>
                <div v-if="item.node.type === 'directory' && item.node.expanded && item.node.children && item.node.children.length === 0 && !item.node.loading" class="file-tree-empty" :style="{ paddingLeft: ((item.depth + 1) * 16 + 8) + 'px' }">{{ t('filePanel.empty') }}</div>
                <div v-if="item.node.error" class="file-tree-error" :style="{ paddingLeft: ((item.depth + 1) * 16 + 8) + 'px' }">{{ item.node.error }}</div>
              </template>
            </div>
          </div>

          <!-- Mobile: file preview view -->
          <div v-else-if="isMobile && sidebarView === 'preview'" class="file-preview-mobile">
            <div class="file-preview-mobile-header">
              <button class="file-panel-mobile-back" @click="filePreview.closePreview()">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
                {{ t('sidebar.files') }}
              </button>
              <div class="preview-header-actions">
                <button v-if="previewFile?.content && filePreview.isMarkdownFile(previewFile.fileName)"
                        class="preview-md-toggle" :class="{ active: previewMarkdownRendered }"
                        @click="previewMarkdownRendered = !previewMarkdownRendered"
                        :title="previewMarkdownRendered ? t('preview.showSource') : t('preview.renderMarkdown')">
                  <svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M14.85 3H1.15C.52 3 0 3.52 0 4.15v7.69C0 12.48.52 13 1.15 13h13.69c.64 0 1.15-.52 1.15-1.15v-7.7C16 3.52 15.48 3 14.85 3zM9 11H7V8L5.5 9.92 4 8v3H2V5h2l1.5 2L7 5h2v6zm2.99.5L9.5 8H11V5h2v3h1.5l-2.51 3.5z"/></svg>
                </button>
                <span v-if="previewFile" class="file-preview-mobile-size">
                  {{ filePreview.formatFileSize(previewFile.totalSize) }}
                </span>
              </div>
            </div>
            <div class="file-preview-mobile-filename" :title="previewFile?.filePath">
              {{ previewFile?.fileName || t('preview.preview') }}
            </div>
            <div class="preview-panel-body">
              <div v-if="previewLoading" class="preview-loading">{{ t('preview.loading') }}</div>
              <div v-else-if="previewFile?.error" class="preview-error">
                {{ previewFile.error }}
              </div>
              <div v-else-if="previewFile?.encoding === 'base64' && previewFile?.content"
                   class="preview-image-container">
                <img :src="'data:' + previewFile.mimeType + ';base64,' + previewFile.content"
                     :alt="previewFile.fileName" class="preview-image" />
              </div>
              <div v-else-if="previewFile?.content && previewMarkdownRendered && filePreview.isMarkdownFile(previewFile.fileName)"
                   class="preview-markdown-rendered markdown-body" v-html="filePreview.renderedMarkdownHtml(previewFile.content)">
              </div>
              <div v-else-if="previewFile?.content" class="preview-text-container">
                <pre class="preview-code"><code v-html="filePreview.highlightCode(previewFile.content, previewFile.fileName)"></code></pre>
                <div v-if="previewFile.truncated" class="preview-truncated-notice">
                  {{ t('preview.fileTruncated', { size: filePreview.formatFileSize(previewFile.totalSize) }) }}
                </div>
              </div>
              <div v-else-if="previewFile && !previewFile.content && !previewFile.error" class="preview-binary-info">
                <p>{{ t('preview.binaryFile') }} — {{ previewFile.mimeType }}</p>
                <p>{{ filePreview.formatFileSize(previewFile.totalSize) }}</p>
              </div>
            </div>
          </div>

          <!-- Normal sidebar content (sessions view) -->
          <template v-else>
          <div class="sidebar-section">
            <div class="sidebar-workdir">
              <div v-if="hostname" class="sidebar-hostname">
                <svg class="sidebar-hostname-icon" viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M3.5 2A1.5 1.5 0 0 0 2 3.5v5A1.5 1.5 0 0 0 3.5 10h9A1.5 1.5 0 0 0 14 8.5v-5A1.5 1.5 0 0 0 12.5 2h-9zM.5 3.5A3 3 0 0 1 3.5.5h9A3 3 0 0 1 15.5 3.5v5a3 3 0 0 1-3 3h-9a3 3 0 0 1-3-3v-5zM5 13.25a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75zM3.25 15a.75.75 0 0 0 0 1.5h9.5a.75.75 0 0 0 0-1.5h-9.5z"/></svg>
                <span>{{ hostname }}</span>
              </div>
              <div class="sidebar-workdir-header">
                <div class="sidebar-workdir-label">{{ t('sidebar.workingDirectory') }}</div>
              </div>
              <div class="sidebar-workdir-path-row" @click.stop="toggleWorkdirMenu()">
                <div class="sidebar-workdir-path" :title="workDir">{{ workDir }}</div>
                <svg class="sidebar-workdir-chevron" :class="{ open: workdirMenuOpen }" viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M7 10l5 5 5-5z"/></svg>
              </div>
              <div v-if="workdirMenuOpen" class="workdir-menu">
                <div class="workdir-menu-item" @click.stop="workdirMenuBrowse()">
                  <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10zM8 13h8v2H8v-2z"/></svg>
                  <span>{{ t('sidebar.browseFiles') }}</span>
                </div>
                <div class="workdir-menu-item" @click.stop="workdirMenuChangeDir()">
                  <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
                  <span>{{ t('sidebar.changeDirectory') }}</span>
                </div>
                <div class="workdir-menu-item" @click.stop="workdirMenuCopyPath()">
                  <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                  <span>{{ t('sidebar.copyPath') }}</span>
                </div>
              </div>
              <div v-if="filteredWorkdirHistory.length > 0" class="workdir-history">
                <div class="workdir-history-label">{{ t('sidebar.recentDirectories') }}</div>
                <div class="workdir-history-list">
                  <div
                    v-for="path in filteredWorkdirHistory" :key="path"
                    class="workdir-history-item"
                    @click="switchToWorkdir(path)"
                    :title="path"
                  >
                    <span class="workdir-history-path">{{ path }}</span>
                    <button class="workdir-history-delete" @click.stop="removeFromWorkdirHistory(path)" :title="t('sidebar.removeFromHistory')">
                      <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Chat History section -->
          <div class="sidebar-section sidebar-sessions" :style="{ flex: chatsCollapsed ? '0 0 auto' : '1 1 0', minHeight: chatsCollapsed ? 'auto' : '0' }">
            <div class="sidebar-section-header" @click="chatsCollapsed = !chatsCollapsed" style="cursor: pointer;">
              <span>{{ t('sidebar.chatHistory') }}</span>
              <span class="sidebar-section-header-actions">
                <button class="sidebar-refresh-btn" @click.stop="requestSessionList" :title="t('sidebar.refresh')" :disabled="loadingSessions">
                  <svg :class="{ spinning: loadingSessions }" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
                </button>
                <button class="sidebar-collapse-btn" :title="chatsCollapsed ? t('sidebar.expand') : t('sidebar.collapse')">
                  <svg :class="{ collapsed: chatsCollapsed }" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>
                </button>
              </span>
            </div>

            <div v-show="!chatsCollapsed" class="sidebar-section-collapsible">
            <button class="new-conversation-btn" @click="newConversation">
              <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
              {{ t('sidebar.newConversation') }}
            </button>

            <div v-if="loadingSessions && historySessions.length === 0" class="sidebar-loading">
              {{ t('sidebar.loadingSessions') }}
            </div>
            <div v-else-if="historySessions.length === 0" class="sidebar-empty">
              {{ t('sidebar.noSessions') }}
            </div>
            <div v-else class="session-list">
              <div v-for="group in groupedSessions" :key="group.label" class="session-group">
                <div class="session-group-label">{{ group.label }}</div>
                <div
                  v-for="s in group.sessions" :key="s.sessionId"
                  :class="['session-item', { active: currentClaudeSessionId === s.sessionId, processing: isSessionProcessing(s.sessionId) }]"
                  @click="renamingSessionId !== s.sessionId && resumeSession(s)"
                  :title="s.preview"
                  :aria-label="(s.title || s.sessionId.slice(0, 8)) + (isSessionProcessing(s.sessionId) ? ' (processing)' : '')"
                >
                  <div v-if="renamingSessionId === s.sessionId" class="session-rename-row">
                    <input
                      class="session-rename-input"
                      v-model="renameText"
                      @click.stop
                      @keydown.enter.stop="confirmRename"
                      @keydown.escape.stop="cancelRename"
                      @vue:mounted="$event.el.focus()"
                    />
                    <button class="session-rename-ok" @click.stop="confirmRename" :title="t('sidebar.confirm')">&#10003;</button>
                    <button class="session-rename-cancel" @click.stop="cancelRename" :title="t('sidebar.cancel')">&times;</button>
                  </div>
                  <div v-else class="session-title">
                    <svg v-if="s.title && s.title.startsWith('You are a team lead')" class="session-team-icon" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
                    {{ s.title }}
                  </div>
                  <div class="session-meta">
                    <span>{{ formatRelativeTime(s.lastModified) }}</span>
                    <span v-if="renamingSessionId !== s.sessionId" class="session-actions">
                      <button
                        class="session-rename-btn"
                        @click.stop="startRename(s)"
                        :title="t('sidebar.renameSession')"
                      >
                        <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                      </button>
                      <button
                        v-if="currentClaudeSessionId !== s.sessionId"
                        class="session-delete-btn"
                        @click.stop="deleteSession(s)"
                        :title="t('sidebar.deleteSession')"
                      >
                        <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                      </button>
                    </span>
                  </div>
                </div>
              </div>
            </div>
            </div>
          </div>

          <!-- Teams section -->
          <div class="sidebar-section sidebar-teams" :style="{ flex: teamsCollapsed ? '0 0 auto' : '1 1 0', minHeight: teamsCollapsed ? 'auto' : '0' }">
            <div class="sidebar-section-header" @click="teamsCollapsed = !teamsCollapsed" style="cursor: pointer;">
              <span>{{ t('sidebar.teamsHistory') }}</span>
              <span class="sidebar-section-header-actions">
                <button class="sidebar-refresh-btn" @click.stop="requestTeamsList" :title="t('sidebar.refresh')" :disabled="loadingTeams">
                  <svg :class="{ spinning: loadingTeams }" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
                </button>
                <button class="sidebar-collapse-btn" :title="teamsCollapsed ? t('sidebar.expand') : t('sidebar.collapse')">
                  <svg :class="{ collapsed: teamsCollapsed }" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>
                </button>
              </span>
            </div>

            <div v-show="!teamsCollapsed" class="sidebar-section-collapsible">
            <button class="new-conversation-btn" @click="newTeam" :disabled="isTeamActive">
              <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
              {{ t('sidebar.newTeam') }}
            </button>

            <div class="team-history-list">
              <div
                v-for="tm in teamsList" :key="tm.teamId"
                :class="['team-history-item', { active: displayTeam && displayTeam.teamId === tm.teamId }]"
                @click="renamingTeamId !== tm.teamId && viewHistoricalTeam(tm.teamId)"
                :title="tm.title"
              >
                <div class="team-history-info">
                  <div v-if="renamingTeamId === tm.teamId" class="session-rename-row">
                    <input
                      class="session-rename-input"
                      v-model="renameTeamText"
                      @click.stop
                      @keydown.enter.stop="confirmTeamRename"
                      @keydown.escape.stop="cancelTeamRename"
                      @vue:mounted="$event.el.focus()"
                    />
                    <button class="session-rename-ok" @click.stop="confirmTeamRename" :title="t('sidebar.confirm')">&#10003;</button>
                    <button class="session-rename-cancel" @click.stop="cancelTeamRename" :title="t('sidebar.cancel')">&times;</button>
                  </div>
                  <div v-else class="team-history-title">{{ tm.title || t('sidebar.untitledTeam') }}</div>
                  <div v-if="renamingTeamId !== tm.teamId" class="team-history-meta">
                    <span :class="['team-status-badge', 'team-status-badge-sm', 'team-status-' + tm.status]">{{ tm.status }}</span>
                    <span v-if="tm.taskCount" class="team-history-tasks">{{ tm.taskCount }} {{ t('sidebar.tasks') }}</span>
                    <span v-if="tm.totalCost" class="team-history-tasks">{{'$' + tm.totalCost.toFixed(2) }}</span>
                    <span class="session-actions">
                      <button class="session-rename-btn" @click.stop="startTeamRename(tm)" :title="t('sidebar.renameTeam')">
                        <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                      </button>
                      <button class="session-delete-btn" @click.stop="requestDeleteTeam(tm)" :title="t('sidebar.deleteTeam')">
                        <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                      </button>
                    </span>
                  </div>
                </div>
              </div>
            </div>
            </div>
          </div>

          <!-- Loops section -->
          <div class="sidebar-section sidebar-loops" :style="{ flex: loopsCollapsed ? '0 0 auto' : '1 1 0', minHeight: loopsCollapsed ? 'auto' : '0' }">
            <div class="sidebar-section-header" @click="loopsCollapsed = !loopsCollapsed" style="cursor: pointer;">
              <span>{{ t('sidebar.loops') }}</span>
              <span class="sidebar-section-header-actions">
                <button class="sidebar-refresh-btn" @click.stop="requestLoopsList" :title="t('sidebar.refresh')" :disabled="loadingLoops">
                  <svg :class="{ spinning: loadingLoops }" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
                </button>
                <button class="sidebar-collapse-btn" :title="loopsCollapsed ? t('sidebar.expand') : t('sidebar.collapse')">
                  <svg :class="{ collapsed: loopsCollapsed }" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>
                </button>
              </span>
            </div>

            <div v-show="!loopsCollapsed" class="sidebar-section-collapsible">
            <button class="new-conversation-btn" @click="newLoop">
              <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
              {{ t('sidebar.newLoop') }}
            </button>

            <div v-if="loopsList.length === 0 && !loadingLoops" class="sidebar-empty">
              {{ t('sidebar.noLoops') }}
            </div>
            <div v-else class="loop-history-list">
              <div
                v-for="l in loopsList" :key="l.id"
                :class="['team-history-item', { active: selectedLoop?.id === l.id }]"
                @click="renamingLoopId !== l.id && viewLoop(l.id)"
                :title="l.name"
              >
                <div class="team-history-info">
                  <div v-if="renamingLoopId === l.id" class="session-rename-row">
                    <input
                      class="session-rename-input"
                      v-model="renameLoopText"
                      @click.stop
                      @keydown.enter.stop="confirmLoopRename"
                      @keydown.escape.stop="cancelLoopRename"
                      @vue:mounted="$event.el.focus()"
                    />
                    <button class="session-rename-ok" @click.stop="confirmLoopRename" :title="t('sidebar.confirm')">&#10003;</button>
                    <button class="session-rename-cancel" @click.stop="cancelLoopRename" :title="t('sidebar.cancel')">&times;</button>
                  </div>
                  <div v-else class="team-history-title">{{ l.name || t('sidebar.untitledLoop') }}</div>
                  <div v-if="renamingLoopId !== l.id" class="team-history-meta">
                    <span :class="['team-status-badge', 'team-status-badge-sm', l.enabled ? 'team-status-running' : 'team-status-completed']">{{ l.enabled ? t('sidebar.active') : t('sidebar.paused') }}</span>
                    <span v-if="l.scheduleType" class="team-history-tasks">{{ formatSchedule(l.scheduleType, l.scheduleConfig || {}, l.schedule) }}</span>
                    <span class="session-actions">
                      <button class="session-rename-btn" @click.stop="startLoopRename(l)" :title="t('sidebar.renameLoop')">
                        <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                      </button>
                      <button class="session-delete-btn" @click.stop="requestDeleteLoop(l)" :title="t('sidebar.deleteLoop')">
                        <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                      </button>
                    </span>
                  </div>
                </div>
              </div>
            </div>
            </div>
          </div>

          <div v-if="serverVersion || agentVersion" class="sidebar-version-footer">
            <span v-if="serverVersion">{{ t('sidebar.server') }} {{ serverVersion }}</span>
            <span v-if="serverVersion && agentVersion" class="sidebar-version-sep">/</span>
            <span v-if="agentVersion">{{ t('sidebar.agent') }} {{ agentVersion }}</span>
          </div>
          </template>
        </aside>

        <!-- File browser panel (desktop) -->
        <Transition name="file-panel">
        <div v-if="filePanelOpen && !isMobile" class="file-panel" :style="{ width: filePanelWidth + 'px' }">
          <div class="file-panel-resize-handle" @mousedown="fileBrowser.onResizeStart($event)" @touchstart="fileBrowser.onResizeStart($event)"></div>
          <div class="file-panel-header">
            <span class="file-panel-title">{{ t('filePanel.files') }}</span>
            <div class="file-panel-actions">
              <button class="file-panel-btn" @click="fileBrowser.refreshTree()" :title="t('sidebar.refresh')">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
              </button>
              <button class="file-panel-btn" @click="filePanelOpen = false" :title="t('sidebar.close')">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
              </button>
            </div>
          </div>
          <div class="file-panel-breadcrumb" :title="workDir">{{ workDir }}</div>
          <div v-if="fileTreeLoading" class="file-panel-loading">{{ t('filePanel.loading') }}</div>
          <div v-else-if="!fileTreeRoot || !fileTreeRoot.children || fileTreeRoot.children.length === 0" class="file-panel-empty">
            {{ t('filePanel.noFiles') }}
          </div>
          <div v-else class="file-tree">
            <template v-for="item in flattenedTree" :key="item.node.path">
              <div
                class="file-tree-item"
                :class="{ folder: item.node.type === 'directory' }"
                :style="{ paddingLeft: (item.depth * 16 + 8) + 'px' }"
                @click="item.node.type === 'directory' ? fileBrowser.toggleFolder(item.node) : filePreview.openPreview(item.node.path)"
                @contextmenu.prevent="item.node.type !== 'directory' ? fileBrowser.onFileClick($event, item.node) : null"
              >
                <span v-if="item.node.type === 'directory'" class="file-tree-arrow" :class="{ expanded: item.node.expanded }">&#9654;</span>
                <span v-else class="file-tree-file-icon">
                  <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></svg>
                </span>
                <span class="file-tree-name" :title="item.node.path">{{ item.node.name }}</span>
                <span v-if="item.node.loading" class="file-tree-spinner"></span>
              </div>
              <div v-if="item.node.type === 'directory' && item.node.expanded && item.node.children && item.node.children.length === 0 && !item.node.loading" class="file-tree-empty" :style="{ paddingLeft: ((item.depth + 1) * 16 + 8) + 'px' }">{{ t('filePanel.empty') }}</div>
              <div v-if="item.node.error" class="file-tree-error" :style="{ paddingLeft: ((item.depth + 1) * 16 + 8) + 'px' }">{{ item.node.error }}</div>
            </template>
          </div>
        </div>
        </Transition>

        <!-- Chat area -->
        <div class="chat-area">

          <!-- ══ Team Dashboard ══ -->
          <template v-if="viewMode === 'team'">

            <!-- Team creation panel (no active team) -->
            <div v-if="!displayTeam" class="team-create-panel">
              <div class="team-create-inner">
                <div class="team-create-header">
                  <svg viewBox="0 0 24 24" width="28" height="28"><path fill="currentColor" opacity="0.5" d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
                  <h2>{{ t('team.launchAgentTeam') }}</h2>
                </div>
                <p class="team-create-desc">{{ t('team.selectTemplateDesc') }}</p>

                <!-- Template selector -->
                <div class="team-tpl-section">
                  <label class="team-tpl-label">{{ t('team.template') }}</label>
                  <select class="team-tpl-select" :value="selectedTemplate" @change="onTemplateChange($event.target.value)">
                    <option v-for="key in TEMPLATE_KEYS" :key="key" :value="key">{{ TEMPLATES[key].label }}</option>
                  </select>
                  <span class="team-tpl-desc">{{ TEMPLATES[selectedTemplate].description }}</span>
                </div>

                <!-- Collapsible lead prompt -->
                <div class="team-lead-prompt-section">
                  <div class="team-lead-prompt-header" @click="leadPromptExpanded = !leadPromptExpanded">
                    <svg class="team-lead-prompt-arrow" :class="{ expanded: leadPromptExpanded }" viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>
                    <span class="team-lead-prompt-title">{{ t('team.leadPrompt') }}</span>
                    <span v-if="!leadPromptExpanded" class="team-lead-prompt-preview">{{ leadPromptPreview() }}</span>
                  </div>
                  <div v-if="leadPromptExpanded" class="team-lead-prompt-body">
                    <textarea
                      v-model="editedLeadPrompt"
                      class="team-lead-prompt-textarea"
                      rows="10"
                    ></textarea>
                    <div class="team-lead-prompt-actions">
                      <button class="team-lead-prompt-reset" @click="resetLeadPrompt()" :title="t('team.reset')">{{ t('team.reset') }}</button>
                    </div>
                  </div>
                </div>

                <!-- Task description -->
                <div class="team-tpl-section">
                  <label class="team-tpl-label">{{ t('team.taskDescription') }}</label>
                  <textarea
                    v-model="teamInstruction"
                    class="team-create-textarea"
                    :placeholder="t('team.taskPlaceholder')"
                    rows="4"
                  ></textarea>
                </div>

                <div class="team-create-actions">
                  <button class="team-create-launch" :disabled="!teamInstruction.trim()" @click="launchTeamFromPanel()">
                    <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                    {{ t('team.launchTeam') }}
                  </button>
                  <button class="team-create-cancel" @click="backToChat()">{{ t('team.backToChat') }}</button>
                </div>

                <!-- Example instructions -->
                <div class="team-examples-section">
                  <div class="team-examples-header">{{ t('team.examples') }}</div>
                  <div class="team-examples-list">
                    <div class="team-example-card" v-for="(ex, i) in teamExamples" :key="i">
                      <div class="team-example-icon" v-html="ex.icon"></div>
                      <div class="team-example-body">
                        <div class="team-example-title">{{ ex.title }}</div>
                        <div class="team-example-text">{{ ex.text }}</div>
                      </div>
                      <button class="team-example-try" @click="onTemplateChange(ex.template); teamInstruction = ex.text">{{ t('team.tryIt') }}</button>
                    </div>
                  </div>
                </div>

                <!-- Historical teams -->
                <div v-if="teamsList.length > 0" class="team-history-section">
                  <div class="team-history-section-header">{{ t('team.previousTeams') }}</div>
                  <div class="team-history-list">
                    <div
                      v-for="tm in teamsList" :key="tm.teamId"
                      class="team-history-item"
                      @click="viewHistoricalTeam(tm.teamId)"
                      :title="tm.title"
                    >
                      <div class="team-history-info">
                        <div class="team-history-title">{{ tm.title || t('sidebar.untitledTeam') }}</div>
                        <div class="team-history-meta">
                          <span :class="['team-status-badge', 'team-status-badge-sm', 'team-status-' + tm.status]">{{ tm.status }}</span>
                          <span v-if="tm.taskCount" class="team-history-tasks">{{ tm.taskCount }} {{ t('sidebar.tasks') }}</span>
                          <span v-if="tm.totalCost" class="team-history-tasks">{{'$' + tm.totalCost.toFixed(2) }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Active/historical team dashboard -->
            <div v-else class="team-dashboard">
              <!-- Dashboard header -->
              <div class="team-dash-header">
                <div class="team-dash-header-top">
                  <span :class="['team-status-badge', 'team-status-' + displayTeam.status]">{{ displayTeam.status }}</span>
                  <div class="team-dash-header-right">
                    <button v-if="isTeamRunning" class="team-dissolve-btn" @click="dissolveTeam()">{{ t('team.dissolveTeam') }}</button>
                    <button v-if="!isTeamActive" class="team-new-btn" @click="newTeam()">{{ t('team.newTeam') }}</button>
                    <button v-if="!isTeamActive" class="team-back-btn" @click="backToChat()">{{ t('team.backToChat') }}</button>
                  </div>
                </div>
                <div class="team-dash-instruction" :class="{ expanded: instructionExpanded }">
                  <div class="team-dash-instruction-text">{{ displayTeam.config?.instruction || displayTeam.title || t('team.agentTeam') }}</div>
                  <button v-if="(displayTeam.config?.instruction || '').length > 120" class="team-dash-instruction-toggle" @click="instructionExpanded = !instructionExpanded">
                    {{ instructionExpanded ? t('team.showLess') : t('team.showMore') }}
                  </button>
                </div>
              </div>

              <!-- Lead status bar (clickable to view lead detail) -->
              <div v-if="displayTeam.leadStatus && (displayTeam.status === 'planning' || displayTeam.status === 'running' || displayTeam.status === 'summarizing')" class="team-lead-bar team-lead-bar-clickable" @click="viewAgent('lead')">
                <span class="team-lead-dot"></span>
                <span class="team-lead-label">{{ t('team.lead') }}</span>
                <span class="team-lead-text">{{ displayTeam.leadStatus }}</span>
              </div>

              <!-- Dashboard body -->
              <div class="team-dash-body">

                <!-- Main content: kanban + agents + feed (dashboard view) -->
                <div v-if="!activeAgentView" class="team-dash-main">

                  <!-- Kanban board (collapsible) -->
                  <div class="team-kanban-section">
                    <div class="team-kanban-section-header" @click="kanbanExpanded = !kanbanExpanded">
                      <span class="team-kanban-section-toggle">{{ kanbanExpanded ? '\u25BC' : '\u25B6' }}</span>
                      <span class="team-kanban-section-title">{{ t('team.tasks') }}</span>
                      <span class="team-kanban-section-summary">{{ doneTasks.length }}/{{ displayTeam.tasks.length }} {{ t('team.done') }}</span>
                    </div>
                    <div v-show="kanbanExpanded" class="team-kanban">
                      <div class="team-kanban-col">
                        <div class="team-kanban-col-header">
                          <span class="team-kanban-col-dot pending"></span>
                          {{ t('team.pending') }}
                          <span class="team-kanban-col-count">{{ pendingTasks.length }}</span>
                        </div>
                        <div class="team-kanban-col-body">
                          <div v-for="task in pendingTasks" :key="task.id" class="team-task-card">
                            <div class="team-task-title">{{ task.title }}</div>
                            <div v-if="task.description" class="team-task-desc team-task-desc-clamp" @click.stop="$event.target.classList.toggle('team-task-desc-expanded')">{{ task.description }}</div>
                          </div>
                          <div v-if="pendingTasks.length === 0" class="team-kanban-empty">{{ t('team.noTasks') }}</div>
                        </div>
                      </div>
                      <div class="team-kanban-col">
                        <div class="team-kanban-col-header">
                          <span class="team-kanban-col-dot active"></span>
                          {{ t('team.activeCol') }}
                          <span class="team-kanban-col-count">{{ activeTasks.length }}</span>
                        </div>
                        <div class="team-kanban-col-body">
                          <div v-for="task in activeTasks" :key="task.id" class="team-task-card active">
                            <div class="team-task-title">{{ task.title }}</div>
                            <div v-if="task.description" class="team-task-desc team-task-desc-clamp" @click.stop="$event.target.classList.toggle('team-task-desc-expanded')">{{ task.description }}</div>
                            <div v-if="getTaskAgent(task)" class="team-task-assignee">
                              <span class="team-agent-dot" :style="{ background: getAgentColor(task.assignee || task.assignedTo) }"></span>
                              {{ getTaskAgent(task).name || task.assignee || task.assignedTo }}
                            </div>
                          </div>
                          <div v-if="activeTasks.length === 0" class="team-kanban-empty">{{ t('team.noTasks') }}</div>
                        </div>
                      </div>
                      <div class="team-kanban-col">
                        <div class="team-kanban-col-header">
                          <span class="team-kanban-col-dot done"></span>
                          {{ t('team.doneCol') }}
                          <span class="team-kanban-col-count">{{ doneTasks.length }}</span>
                        </div>
                        <div class="team-kanban-col-body">
                          <div v-for="task in doneTasks" :key="task.id" class="team-task-card done">
                            <div class="team-task-title">{{ task.title }}</div>
                            <div v-if="task.description" class="team-task-desc team-task-desc-clamp" @click.stop="$event.target.classList.toggle('team-task-desc-expanded')">{{ task.description }}</div>
                            <div v-if="getTaskAgent(task)" class="team-task-assignee">
                              <span class="team-agent-dot" :style="{ background: getAgentColor(task.assignee || task.assignedTo) }"></span>
                              {{ getTaskAgent(task).name || task.assignee || task.assignedTo }}
                            </div>
                          </div>
                          <div v-if="doneTasks.length === 0" class="team-kanban-empty">{{ t('team.noTasks') }}</div>
                        </div>
                      </div>
                      <div v-if="failedTasks.length > 0" class="team-kanban-col">
                        <div class="team-kanban-col-header">
                          <span class="team-kanban-col-dot failed"></span>
                          {{ t('team.failed') }}
                          <span class="team-kanban-col-count">{{ failedTasks.length }}</span>
                        </div>
                        <div class="team-kanban-col-body">
                          <div v-for="task in failedTasks" :key="task.id" class="team-task-card failed">
                            <div class="team-task-title">{{ task.title }}</div>
                            <div v-if="task.description" class="team-task-desc team-task-desc-clamp" @click.stop="$event.target.classList.toggle('team-task-desc-expanded')">{{ task.description }}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Agent cards (horizontal) -->
                  <div class="team-agents-bar">
                    <div class="team-agents-bar-header">{{ t('team.agents') }}</div>
                    <div class="team-agents-bar-list">
                      <div
                        v-for="agent in (displayTeam.agents || [])" :key="agent.id"
                        class="team-agent-card"
                        @click="historicalTeam ? viewAgentWithHistory(agent.id) : viewAgent(agent.id)"
                      >
                        <div class="team-agent-card-top">
                          <span :class="['team-agent-dot', { working: agent.status === 'working' || agent.status === 'starting' }]" :style="{ background: getAgentColor(agent.id) }"></span>
                          <span class="team-agent-card-name">{{ agent.name || agent.id }}</span>
                          <span :class="['team-agent-card-status', 'team-agent-card-status-' + agent.status]">{{ agent.status }}</span>
                        </div>
                        <div v-if="getLatestAgentActivity(agent.id)" class="team-agent-card-activity">{{ getLatestAgentActivity(agent.id) }}</div>
                      </div>
                      <div v-if="!displayTeam.agents || displayTeam.agents.length === 0" class="team-agents-empty">
                        <span v-if="displayTeam.status === 'planning'">{{ t('team.planningTasks') }}</span>
                        <span v-else>{{ t('team.noAgents') }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- Activity feed -->
                  <div v-if="displayTeam.feed && displayTeam.feed.length > 0" class="team-feed">
                    <div class="team-feed-header">{{ t('team.activity') }}</div>
                    <div class="team-feed-list">
                      <div v-for="(entry, fi) in displayTeam.feed" :key="fi" class="team-feed-entry">
                        <span v-if="entry.agentId" class="team-agent-dot" :style="{ background: getAgentColor(entry.agentId) }"></span>
                        <span v-else class="team-agent-dot" style="background: #666;"></span>
                        <span class="team-feed-time">{{ formatTeamTime(entry.timestamp) }}</span>
                        <span class="team-feed-text"><span v-if="feedAgentName(entry)" class="team-feed-agent-name" :style="{ color: getAgentColor(entry.agentId) }">{{ feedAgentName(entry) }}</span>{{ feedContentRest(entry) }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- Completion stats -->
                  <div v-if="displayTeam.status === 'completed' || displayTeam.status === 'failed'" class="team-stats-bar">
                    <div class="team-stat">
                      <span class="team-stat-label">{{ t('team.tasksStat') }}</span>
                      <span class="team-stat-value">{{ doneTasks.length }}/{{ displayTeam.tasks.length }}</span>
                    </div>
                    <div v-if="displayTeam.durationMs" class="team-stat">
                      <span class="team-stat-label">{{ t('team.duration') }}</span>
                      <span class="team-stat-value">{{ Math.round(displayTeam.durationMs / 1000) }}s</span>
                    </div>
                    <div v-if="displayTeam.totalCost" class="team-stat">
                      <span class="team-stat-label">{{ t('team.cost') }}</span>
                      <span class="team-stat-value">{{ '$' + displayTeam.totalCost.toFixed(2) }}</span>
                    </div>
                    <div class="team-stat">
                      <span class="team-stat-label">{{ t('team.agentsStat') }}</span>
                      <span class="team-stat-value">{{ (displayTeam.agents || []).length }}</span>
                    </div>
                  </div>

                  <!-- Completion summary -->
                  <div v-if="displayTeam.status === 'completed' && displayTeam.summary" class="team-summary">
                    <div class="team-summary-header">{{ t('team.summary') }}</div>
                    <div class="team-summary-body markdown-body" v-html="getRenderedContent({ role: 'assistant', content: displayTeam.summary })"></div>
                  </div>

                  <!-- New team launcher after completion -->
                  <div v-if="!historicalTeam && (displayTeam.status === 'completed' || displayTeam.status === 'failed')" class="team-new-launcher">
                    <textarea
                      v-model="teamInstruction"
                      class="team-new-launcher-input"
                      :placeholder="t('team.launchAnotherPlaceholder')"
                      rows="2"
                      @keydown.enter.ctrl="launchTeamFromPanel()"
                    ></textarea>
                    <div class="team-new-launcher-actions">
                      <button class="team-create-launch" :disabled="!teamInstruction.trim()" @click="launchTeamFromPanel()">
                        <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                        {{ t('team.newTeam') }}
                      </button>
                      <button class="team-create-cancel" @click="backToChat()">{{ t('team.backToChat') }}</button>
                    </div>
                  </div>
                </div>

                <!-- Agent detail view -->
                <div v-else class="team-agent-detail">
                  <div class="team-agent-detail-header" :style="{ borderBottom: '2px solid ' + getAgentColor(activeAgentView) }">
                    <button class="team-agent-back-btn" @click="viewDashboard()">
                      <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
                      {{ t('team.dashboard') }}
                    </button>
                    <span :class="['team-agent-dot', { working: findAgent(activeAgentView)?.status === 'working' || findAgent(activeAgentView)?.status === 'starting' }]" :style="{ background: getAgentColor(activeAgentView) }"></span>
                    <span class="team-agent-detail-name" :style="{ color: getAgentColor(activeAgentView) }">{{ findAgent(activeAgentView)?.name || activeAgentView }}</span>
                    <span class="team-agent-detail-status">{{ findAgent(activeAgentView)?.status }}</span>
                  </div>
                  <div class="team-agent-messages">
                    <div class="team-agent-messages-inner">
                      <div v-if="getAgentMessages(activeAgentView).length === 0" class="team-agent-empty-msg">
                        {{ t('team.noMessages') }}
                      </div>
                      <template v-for="(msg, mi) in getAgentMessages(activeAgentView)" :key="msg.id">
                        <!-- Agent user/prompt message -->
                        <div v-if="msg.role === 'user' && msg.content" class="team-agent-prompt">
                          <div class="team-agent-prompt-label">{{ t('team.taskPrompt') }}</div>
                          <div class="team-agent-prompt-body markdown-body" v-html="getRenderedContent(msg)"></div>
                        </div>
                        <!-- System notice (e.g. completion message) -->
                        <div v-else-if="msg.role === 'system'" class="team-agent-empty-msg">
                          {{ msg.content }}
                        </div>
                        <!-- Agent assistant text -->
                        <div v-else-if="msg.role === 'assistant'" :class="['message', 'message-assistant']">
                          <div class="team-agent-detail-name-tag" :style="{ color: getAgentColor(activeAgentView) }">{{ findAgent(activeAgentView)?.name || activeAgentView }}</div>
                          <div :class="['message-bubble', 'assistant-bubble', { streaming: msg.isStreaming }]">
                            <div class="message-content markdown-body" v-html="getRenderedContent(msg)"></div>
                          </div>
                        </div>
                        <!-- Agent tool use -->
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
                      </template>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </template>

          <!-- ══ Loop Dashboard ══ -->
          <template v-else-if="viewMode === 'loop'">

            <!-- ── Execution detail view ── -->
            <div v-if="selectedLoop && selectedExecution" class="team-create-panel">
              <div class="team-create-inner">
                <div class="loop-detail-header">
                  <button class="team-agent-back-btn" @click="backToLoopDetail()">
                    <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
                    {{ selectedLoop.name }}
                  </button>
                </div>

                <div v-if="loadingExecution" class="loop-loading">
                  <div class="history-loading-spinner"></div>
                  <span>{{ t('loop.loadingExecution') }}</span>
                </div>

                <div v-else class="loop-exec-messages">
                  <div v-if="executionMessages.length === 0" class="team-agent-empty-msg">{{ t('loop.noExecMessages') }}</div>
                  <template v-for="(msg, mi) in executionMessages" :key="msg.id">
                    <div v-if="msg.role === 'user' && msg.content" class="team-agent-prompt">
                      <div class="team-agent-prompt-label">{{ t('loop.loopPrompt') }}</div>
                      <div class="team-agent-prompt-body markdown-body" v-html="getRenderedContent(msg)"></div>
                    </div>
                    <div v-else-if="msg.role === 'assistant'" :class="['message', 'message-assistant']">
                      <div :class="['message-bubble', 'assistant-bubble', { streaming: msg.isStreaming }]">
                        <div class="message-content markdown-body" v-html="getRenderedContent(msg)"></div>
                      </div>
                    </div>
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
                  </template>
                </div>
              </div>
            </div>

            <!-- ── Loop detail view (execution history) ── -->
            <div v-else-if="selectedLoop" class="team-create-panel">
              <div class="team-create-inner">
                <div class="loop-detail-header">
                  <button class="team-agent-back-btn" @click="backToLoopsList()">
                    <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
                    {{ t('loop.backToLoops') }}
                  </button>
                </div>
                <div class="loop-detail-info">
                  <h2 class="loop-detail-name">{{ selectedLoop.name }}</h2>
                  <div class="loop-detail-meta">
                    <span class="loop-detail-schedule">{{ loopScheduleDisplay(selectedLoop) }}</span>
                    <span :class="['loop-status-badge', selectedLoop.enabled ? 'loop-status-enabled' : 'loop-status-disabled']">{{ selectedLoop.enabled ? t('loop.enabled') : t('loop.disabled') }}</span>
                  </div>
                  <div class="loop-detail-actions">
                    <button class="loop-action-btn" @click="startEditingLoop(selectedLoop); selectedLoop = null">{{ t('loop.edit') }}</button>
                    <button class="loop-action-btn loop-action-run" @click="runNow(selectedLoop.id)" :disabled="isLoopRunning(selectedLoop.id)">{{ t('loop.runNow') }}</button>
                    <button class="loop-action-btn" @click="toggleLoop(selectedLoop.id)">{{ selectedLoop.enabled ? t('loop.disable') : t('loop.enable') }}</button>
                  </div>
                </div>

                <div class="loop-detail-prompt-section">
                  <div class="loop-detail-prompt-label">{{ t('loop.prompt') }}</div>
                  <div class="loop-detail-prompt-text">{{ selectedLoop.prompt }}</div>
                </div>

                <div class="loop-exec-history-section">
                  <div class="loop-exec-history-header">{{ t('loop.executionHistory') }}</div>
                  <div v-if="loadingExecutions" class="loop-loading">
                    <div class="history-loading-spinner"></div>
                    <span>{{ t('loop.loadingExecutions') }}</span>
                  </div>
                  <div v-else-if="executionHistory.length === 0" class="loop-exec-empty">{{ t('loop.noExecutions') }}</div>
                  <div v-else class="loop-exec-list">
                    <div v-for="exec in executionHistory" :key="exec.id" class="loop-exec-item">
                      <div class="loop-exec-item-left">
                        <span :class="['loop-exec-status-icon', 'loop-exec-status-' + exec.status]">
                          <template v-if="exec.status === 'running'">\u{21BB}</template>
                          <template v-else-if="exec.status === 'success'">\u{2713}</template>
                          <template v-else-if="exec.status === 'error'">\u{2717}</template>
                          <template v-else-if="exec.status === 'cancelled'">\u{25CB}</template>
                          <template v-else>?</template>
                        </span>
                        <span class="loop-exec-time">{{ formatExecTime(exec.startedAt) }}</span>
                        <span v-if="exec.status === 'running'" class="loop-exec-running-label">{{ t('loop.running') }}</span>
                        <span v-else-if="exec.durationMs" class="loop-exec-duration">{{ formatDuration(exec.durationMs) }}</span>
                        <span v-if="exec.error" class="loop-exec-error-text" :title="exec.error">{{ exec.error.length > 40 ? exec.error.slice(0, 40) + '...' : exec.error }}</span>
                        <span v-if="exec.trigger === 'manual'" class="loop-exec-trigger-badge">{{ t('loop.manualBadge') }}</span>
                      </div>
                      <div class="loop-exec-item-right">
                        <button v-if="exec.status === 'running'" class="loop-action-btn" @click="viewExecution(selectedLoop.id, exec.id)">{{ t('loop.view') }}</button>
                        <button v-if="exec.status === 'running'" class="loop-action-btn loop-action-cancel" @click="cancelLoopExecution(selectedLoop.id)">{{ t('loop.cancelExec') }}</button>
                        <button v-if="exec.status !== 'running'" class="loop-action-btn" @click="viewExecution(selectedLoop.id, exec.id)">{{ t('loop.view') }}</button>
                      </div>
                    </div>
                    <!-- Load more executions -->
                    <div v-if="hasMoreExecutions && !loadingExecutions" class="loop-load-more">
                      <button class="loop-action-btn" :disabled="loadingMoreExecutions" @click="loadMoreExecutions()">
                        {{ loadingMoreExecutions ? t('filePanel.loading') : t('loop.loadMore') }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- ── Loop creation panel (default) ── -->
            <div v-else class="team-create-panel">
              <div class="team-create-inner">
                <div class="team-create-header">
                  <svg viewBox="0 0 24 24" width="28" height="28"><path fill="currentColor" opacity="0.5" d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>
                  <h2>{{ editingLoopId ? t('loop.editLoop') : t('loop.createLoop') }}</h2>
                </div>
                <p class="team-create-desc">{{ t('loop.createDesc') }}</p>

                <!-- Template cards -->
                <div v-if="!editingLoopId" class="team-examples-section" style="margin-top: 0;">
                  <div class="team-examples-header">{{ t('loop.templates') }}</div>
                  <div class="team-examples-list">
                    <div v-for="key in LOOP_TEMPLATE_KEYS" :key="key"
                         :class="['team-example-card', { 'loop-template-selected': loopSelectedTemplate === key }]"
                    >
                      <div class="team-example-icon">
                        <svg v-if="key === 'competitive-intel'" viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95a15.65 15.65 0 0 0-1.38-3.56A8.03 8.03 0 0 1 18.92 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2s.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56A7.987 7.987 0 0 1 5.08 16zm2.95-8H5.08a7.987 7.987 0 0 1 4.33-3.56A15.65 15.65 0 0 0 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2s.07-1.35.16-2h4.68c.09.65.16 1.32.16 2s-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 0 1-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2s-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z"/></svg>
                        <svg v-else-if="key === 'knowledge-base'" viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
                        <svg v-else viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>
                      </div>
                      <div class="team-example-body">
                        <div class="team-example-title">{{ LOOP_TEMPLATES[key].label }}</div>
                        <div class="team-example-text">{{ LOOP_TEMPLATES[key].description }}</div>
                      </div>
                      <button class="team-example-try" @click="selectLoopTemplate(key)">{{ t('team.tryIt') }}</button>
                    </div>
                  </div>
                </div>

                <!-- Name field -->
                <div class="team-tpl-section">
                  <label class="team-tpl-label">{{ t('loop.name') }}</label>
                  <input
                    v-model="loopName"
                    type="text"
                    class="loop-name-input"
                    :placeholder="t('loop.namePlaceholder')"
                  />
                </div>

                <!-- Prompt field -->
                <div class="team-tpl-section">
                  <label class="team-tpl-label">{{ t('loop.prompt') }}</label>
                  <textarea
                    v-model="loopPrompt"
                    class="team-create-textarea"
                    :placeholder="t('loop.promptPlaceholder')"
                    rows="5"
                  ></textarea>
                </div>

                <!-- Schedule selector -->
                <div class="team-tpl-section">
                  <label class="team-tpl-label">{{ t('loop.schedule') }}</label>
                  <div class="loop-schedule-options">
                    <label class="loop-schedule-radio">
                      <input type="radio" v-model="loopScheduleType" value="manual" />
                      <span>{{ t('loop.manual') }}</span>
                      <span v-if="loopScheduleType === 'manual'" class="loop-schedule-detail" style="opacity:0.6">{{ t('loop.manualDetail') }}</span>
                    </label>
                    <label class="loop-schedule-radio">
                      <input type="radio" v-model="loopScheduleType" value="hourly" />
                      <span>{{ t('loop.everyHour') }}</span>
                      <span v-if="loopScheduleType === 'hourly'" class="loop-schedule-detail">at minute {{ padTwo(loopScheduleMinute) }}</span>
                    </label>
                    <label class="loop-schedule-radio">
                      <input type="radio" v-model="loopScheduleType" value="daily" />
                      <span>{{ t('loop.everyDay') }}</span>
                      <span v-if="loopScheduleType === 'daily'" class="loop-schedule-detail">
                        at
                        <input type="number" v-model.number="loopScheduleHour" min="0" max="23" class="loop-time-input" />
                        :
                        <input type="number" v-model.number="loopScheduleMinute" min="0" max="59" class="loop-time-input" />
                      </span>
                    </label>
                    <label class="loop-schedule-radio">
                      <input type="radio" v-model="loopScheduleType" value="cron" />
                      <span>{{ t('loop.advancedCron') }}</span>
                      <span v-if="loopScheduleType === 'cron'" class="loop-schedule-detail">
                        <input type="text" v-model="loopCronExpr" class="loop-cron-input" placeholder="0 9 * * *" />
                      </span>
                    </label>
                  </div>
                </div>

                <!-- Action buttons -->
                <div class="team-create-actions">
                  <button v-if="editingLoopId" class="team-create-launch" :disabled="!loopName.trim() || !loopPrompt.trim()" @click="saveLoopEdits()">
                    {{ t('loop.saveChanges') }}
                  </button>
                  <button v-else class="team-create-launch" :disabled="!loopName.trim() || !loopPrompt.trim()" @click="createLoopFromPanel()">
                    <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>
                    {{ t('loop.createLoopBtn') }}
                  </button>
                  <button v-if="editingLoopId" class="team-create-cancel" @click="cancelEditingLoop()">{{ t('loop.cancel') }}</button>
                  <button class="team-create-cancel" @click="backToChat()">{{ t('loop.backToChat') }}</button>
                </div>

                <!-- Error message -->
                <div v-if="loopError" class="loop-error-banner" @click="clearLoopError()">
                  <span class="loop-error-icon">\u{26A0}</span>
                  <span class="loop-error-text">{{ loopError }}</span>
                  <span class="loop-error-dismiss">\u{2715}</span>
                </div>

                <!-- Active Loops list -->
                <div v-if="loopsList.length > 0" class="loop-active-section">
                  <div class="loop-active-header">{{ t('loop.activeLoops') }}</div>
                  <div class="loop-active-list">
                    <div v-for="l in loopsList" :key="l.id" class="loop-active-item">
                      <div class="loop-active-item-info" @click="viewLoop(l.id)">
                        <div class="loop-active-item-top">
                          <span class="loop-active-item-name">{{ l.name }}</span>
                          <span :class="['loop-status-dot', l.enabled ? 'loop-status-dot-on' : 'loop-status-dot-off']"></span>
                        </div>
                        <div class="loop-active-item-meta">
                          <span class="loop-active-item-schedule">{{ loopScheduleDisplay(l) }}</span>
                          <span v-if="l.lastExecution" class="loop-active-item-last">
                            Last: {{ loopLastRunDisplay(l) }}
                          </span>
                          <span v-if="isLoopRunning(l.id)" class="loop-exec-running-label">{{ t('loop.running') }}</span>
                        </div>
                      </div>
                      <div class="loop-active-item-actions">
                        <button class="loop-action-btn loop-action-sm" @click="startEditingLoop(l)" :title="t('loop.edit')">{{ t('loop.edit') }}</button>
                        <button class="loop-action-btn loop-action-sm loop-action-run" @click="runNow(l.id)" :disabled="isLoopRunning(l.id)" :title="t('loop.runNow')">{{ t('loop.run') }}</button>
                        <button class="loop-action-btn loop-action-sm" @click="toggleLoop(l.id)" :title="l.enabled ? t('loop.disable') : t('loop.enable')">{{ l.enabled ? t('loop.pause') : t('loop.resume') }}</button>
                        <button v-if="!l.enabled" class="loop-action-btn loop-action-sm loop-action-delete" @click="requestDeleteLoop(l)" :title="t('loop.deleteLoop')">{{ t('loop.del') }}</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Running Loop notification banner -->
            <div v-if="hasRunningLoop && !selectedLoop" class="loop-running-banner">
              <span class="loop-running-banner-dot"></span>
              <span>{{ firstRunningLoop.name }} {{ t('loop.isRunning') }}</span>
              <button class="loop-action-btn loop-action-sm" @click="viewLoop(firstRunningLoop.loopId)">{{ t('loop.view') }}</button>
            </div>

            <!-- Loop delete confirm dialog -->
            <div v-if="loopDeleteConfirmOpen" class="modal-overlay" @click.self="cancelDeleteLoop()">
              <div class="modal-dialog">
                <div class="modal-title">{{ t('loop.deleteLoop') }}</div>
                <div class="modal-body" v-html="t('loop.deleteConfirm', { name: loopDeleteConfirmName })"></div>
                <div class="modal-actions">
                  <button class="modal-confirm-btn" @click="confirmDeleteLoop()">{{ t('loop.delete') }}</button>
                  <button class="modal-cancel-btn" @click="cancelDeleteLoop()">{{ t('loop.cancel') }}</button>
                </div>
              </div>
            </div>
          </template>

          <!-- ══ Normal Chat ══ -->
          <template v-else-if="viewMode === 'chat'">
          <div class="message-list" @scroll="onMessageListScroll">
            <div class="message-list-inner">
              <div v-if="messages.length === 0 && status === 'Connected' && !loadingHistory" class="empty-state">
                <div class="empty-state-icon">
                  <svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" opacity="0.4" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>
                </div>
                <p>{{ t('chat.connectedTo') }} <strong>{{ agentName }}</strong></p>
                <p class="muted">{{ workDir }}</p>
                <p class="muted" style="margin-top: 0.5rem;">{{ t('chat.sendToStart') }}</p>
              </div>

              <div v-if="loadingHistory" class="history-loading">
                <div class="history-loading-spinner"></div>
                <span>{{ t('chat.loadingHistory') }}</span>
              </div>

              <div v-if="hasMoreMessages" class="load-more-wrapper">
                <button class="load-more-btn" @click="loadMoreMessages">{{ t('chat.loadEarlier') }}</button>
              </div>

              <div v-for="(msg, msgIdx) in visibleMessages" :key="msg.id" :class="['message', 'message-' + msg.role]">

                <!-- User message -->
                <template v-if="msg.role === 'user'">
                  <div class="message-role-label user-label">{{ t('chat.you') }}</div>
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
                  <div v-if="!isPrevAssistant(msgIdx)" class="message-role-label assistant-label">{{ t('chat.claude') }}</div>
                  <div :class="['message-bubble', 'assistant-bubble', { streaming: msg.isStreaming }]" :title="formatTimestamp(msg.timestamp)">
                    <div class="message-actions">
                      <button class="icon-btn" @click="copyMessage(msg)" :title="msg.copied ? t('chat.copied') : t('chat.copy')">
                        <svg v-if="!msg.copied" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                        <svg v-else viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                      </button>
                    </div>
                    <div class="message-content markdown-body" v-html="getRenderedContent(msg)"></div>
                  </div>
                </template>

                <!-- Agent tool call (team-styled) -->
                <div v-else-if="msg.role === 'tool' && msg.toolName === 'Agent'" class="tool-line-wrapper team-agent-tool-wrapper">
                  <div :class="['tool-line', 'team-agent-tool-line', { completed: msg.hasResult, running: !msg.hasResult }]" @click="toggleTool(msg)">
                    <span class="team-agent-tool-icon">
                      <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                    </span>
                    <span class="team-agent-tool-name">Agent</span>
                    <span class="team-agent-tool-desc">{{ getToolSummary(msg) }}</span>
                    <span class="tool-status-icon" v-if="msg.hasResult">\u{2713}</span>
                    <span class="tool-status-icon running-dots" v-else>
                      <span></span><span></span><span></span>
                    </span>
                    <span class="tool-toggle">{{ msg.expanded ? '\u{25B2}' : '\u{25BC}' }}</span>
                  </div>
                  <div v-show="msg.expanded" class="tool-expand team-agent-tool-expand">
                    <pre v-if="msg.toolInput" class="tool-block">{{ msg.toolInput }}</pre>
                    <div v-if="msg.toolOutput" class="team-agent-tool-result">
                      <div class="team-agent-tool-result-label">{{ t('team.agentResult') }}</div>
                      <div class="team-agent-tool-result-content markdown-body" v-html="getRenderedContent({ role: 'assistant', content: msg.toolOutput })"></div>
                    </div>
                  </div>
                </div>

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
                          :placeholder="t('chat.customResponse')"
                          @input="msg.selectedAnswers[qi] = q.multiSelect ? [] : null"
                          @keydown.enter="hasQuestionAnswer(msg) && submitQuestionAnswer(msg)"
                        />
                      </div>
                    </div>
                    <div class="ask-question-actions">
                      <button class="ask-question-submit" :disabled="!hasQuestionAnswer(msg)" @click="submitQuestionAnswer(msg)">
                        {{ t('chat.submit') }}
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
                    <span class="context-summary-label">{{ t('chat.contextContinued') }}</span>
                    <span class="context-summary-toggle">{{ msg.contextExpanded ? t('chat.hide') : t('chat.show') }}</span>
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
          </template>

          <!-- Input area (shown in both chat and team create mode) -->
          <div class="input-area" v-if="viewMode === 'chat'">
            <input
              type="file"
              ref="fileInputRef"
              multiple
              style="display: none"
              @change="handleFileSelect"
              accept="image/*,text/*,.pdf,.json,.md,.py,.js,.ts,.tsx,.jsx,.css,.html,.xml,.yaml,.yml,.toml,.sh,.sql,.csv"
            />
            <div v-if="queuedMessages.length > 0" class="queue-bar">
              <div v-for="(qm, qi) in queuedMessages" :key="qm.id" class="queue-item">
                <span class="queue-item-num">{{ qi + 1 }}.</span>
                <span class="queue-item-text">{{ qm.content }}</span>
                <span v-if="qm.attachments && qm.attachments.length" class="queue-item-attach" :title="qm.attachments.map(a => a.name).join(', ')">
                  <svg viewBox="0 0 24 24" width="11" height="11"><path fill="currentColor" d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 0 0 5 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg>
                  {{ qm.attachments.length }}
                </span>
                <button class="queue-item-remove" @click="removeQueuedMessage(qm.id)" :title="t('input.removeFromQueue')">&times;</button>
              </div>
            </div>
            <div v-if="usageStats" class="usage-bar">{{ formatUsage(usageStats) }}</div>
            <div v-if="slashMenuVisible && filteredSlashCommands.length > 0" class="slash-menu">
              <div v-for="(cmd, i) in filteredSlashCommands" :key="cmd.command"
                   :class="['slash-menu-item', { active: i === slashMenuIndex }]"
                   @mouseenter="slashMenuIndex = i"
                   @click="selectSlashCommand(cmd)">
                <span class="slash-menu-cmd">{{ cmd.command }}</span>
                <span class="slash-menu-desc">{{ t(cmd.descKey) }}</span>
              </div>
            </div>
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
                :placeholder="isCompacting ? t('input.compacting') : t('input.placeholder')"
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
                  <button class="attachment-remove" @click="removeAttachment(i)" :title="t('input.remove')">&times;</button>
                </div>
              </div>
              <div class="input-bottom-row">
                <button class="attach-btn" @click="triggerFileInput" :disabled="status !== 'Connected' || isCompacting || attachments.length >= 5" :title="t('input.attachFiles')">
                  <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 0 0 5 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg>
                </button>
                <button v-if="isProcessing && !hasInput" @click="cancelExecution" class="send-btn stop-btn" :title="t('input.stopGeneration')">
                  <svg viewBox="0 0 24 24" width="14" height="14"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>
                </button>
                <button v-else @click="sendMessage" :disabled="!canSend" class="send-btn" :title="t('input.send')">
                  <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Preview Panel (desktop) -->
        <Transition name="file-panel">
        <div v-if="previewPanelOpen && !isMobile" class="preview-panel" :style="{ width: previewPanelWidth + 'px' }">
          <div class="preview-panel-resize-handle"
               @mousedown="filePreview.onResizeStart($event)"
               @touchstart="filePreview.onResizeStart($event)"></div>
          <div class="preview-panel-header">
            <span class="preview-panel-filename" :title="previewFile?.filePath">
              {{ previewFile?.fileName || t('preview.preview') }}
            </span>
            <button v-if="previewFile?.content && filePreview.isMarkdownFile(previewFile.fileName)"
                    class="preview-md-toggle" :class="{ active: previewMarkdownRendered }"
                    @click="previewMarkdownRendered = !previewMarkdownRendered"
                    :title="previewMarkdownRendered ? t('preview.showSource') : t('preview.renderMarkdown')">
              <svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M14.85 3H1.15C.52 3 0 3.52 0 4.15v7.69C0 12.48.52 13 1.15 13h13.69c.64 0 1.15-.52 1.15-1.15v-7.7C16 3.52 15.48 3 14.85 3zM9 11H7V8L5.5 9.92 4 8v3H2V5h2l1.5 2L7 5h2v6zm2.99.5L9.5 8H11V5h2v3h1.5l-2.51 3.5z"/></svg>
            </button>
            <span v-if="previewFile" class="preview-panel-size">
              {{ filePreview.formatFileSize(previewFile.totalSize) }}
            </span>
            <button class="preview-panel-close" @click="filePreview.closePreview()" :title="t('preview.closePreview')">&times;</button>
          </div>
          <div class="preview-panel-body">
            <div v-if="previewLoading" class="preview-loading">{{ t('preview.loading') }}</div>
            <div v-else-if="previewFile?.error" class="preview-error">
              {{ previewFile.error }}
            </div>
            <div v-else-if="previewFile?.encoding === 'base64' && previewFile?.content"
                 class="preview-image-container">
              <img :src="'data:' + previewFile.mimeType + ';base64,' + previewFile.content"
                   :alt="previewFile.fileName" class="preview-image" />
            </div>
            <div v-else-if="previewFile?.content && previewMarkdownRendered && filePreview.isMarkdownFile(previewFile.fileName)"
                 class="preview-markdown-rendered markdown-body" v-html="filePreview.renderedMarkdownHtml(previewFile.content)">
            </div>
            <div v-else-if="previewFile?.content" class="preview-text-container">
              <pre class="preview-code"><code v-html="filePreview.highlightCode(previewFile.content, previewFile.fileName)"></code></pre>
              <div v-if="previewFile.truncated" class="preview-truncated-notice">
                {{ t('preview.fileTruncated', { size: filePreview.formatFileSize(previewFile.totalSize) }) }}
              </div>
            </div>
            <div v-else-if="previewFile && !previewFile.content && !previewFile.error" class="preview-binary-info">
              <div class="preview-binary-icon">
                <svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" opacity="0.4" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></svg>
              </div>
              <p>{{ t('preview.binaryFile') }}</p>
              <p class="preview-binary-meta">{{ previewFile.mimeType }}</p>
              <p class="preview-binary-meta">{{ filePreview.formatFileSize(previewFile.totalSize) }}</p>
            </div>
          </div>
        </div>
        </Transition>

      </div>

      <!-- Folder Picker Modal -->
      <div class="folder-picker-overlay" v-if="folderPickerOpen" @click.self="folderPickerOpen = false">
        <div class="folder-picker-dialog">
          <div class="folder-picker-header">
            <span>{{ t('folderPicker.title') }}</span>
            <button class="folder-picker-close" @click="folderPickerOpen = false">&times;</button>
          </div>
          <div class="folder-picker-nav">
            <button class="folder-picker-up" @click="folderPickerNavigateUp" :disabled="!folderPickerPath" :title="t('folderPicker.parentDir')">
              <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
            </button>
            <input class="folder-picker-path-input" type="text" v-model="folderPickerPath" @keydown.enter="folderPickerGoToPath" :placeholder="t('folderPicker.pathPlaceholder')" spellcheck="false" />
          </div>
          <div class="folder-picker-list">
            <div v-if="folderPickerLoading" class="folder-picker-loading">
              <div class="history-loading-spinner"></div>
              <span>{{ t('preview.loading') }}</span>            </div>
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
              <div v-if="folderPickerEntries.length === 0" class="folder-picker-empty">{{ t('folderPicker.noSubdirs') }}</div>
            </template>
          </div>
          <div class="folder-picker-footer">
            <button class="folder-picker-cancel" @click="folderPickerOpen = false">{{ t('folderPicker.cancel') }}</button>
            <button class="folder-picker-confirm" @click="confirmFolderPicker" :disabled="!folderPickerPath">{{ t('folderPicker.open') }}</button>
          </div>
        </div>
      </div>

      <!-- Delete Session Confirmation Dialog -->
      <div class="folder-picker-overlay" v-if="deleteConfirmOpen" @click.self="cancelDeleteSession">
        <div class="delete-confirm-dialog">
          <div class="delete-confirm-header">{{ t('dialog.deleteSession') }}</div>
          <div class="delete-confirm-body">
            <p>{{ t('dialog.deleteSessionConfirm') }}</p>
            <p class="delete-confirm-title">{{ deleteConfirmTitle }}</p>
            <p class="delete-confirm-warning">{{ t('dialog.cannotUndo') }}</p>
          </div>
          <div class="delete-confirm-footer">
            <button class="folder-picker-cancel" @click="cancelDeleteSession">{{ t('dialog.cancel') }}</button>
            <button class="delete-confirm-btn" @click="confirmDeleteSession">{{ t('dialog.delete') }}</button>
          </div>
        </div>
      </div>

      <!-- Delete Team Confirmation Dialog -->
      <div class="folder-picker-overlay" v-if="deleteTeamConfirmOpen" @click.self="cancelDeleteTeam">
        <div class="delete-confirm-dialog">
          <div class="delete-confirm-header">{{ t('dialog.deleteTeam') }}</div>
          <div class="delete-confirm-body">
            <p>{{ t('dialog.deleteTeamConfirm') }}</p>
            <p class="delete-confirm-title">{{ deleteTeamConfirmTitle }}</p>
            <p class="delete-confirm-warning">{{ t('dialog.cannotUndo') }}</p>
          </div>
          <div class="delete-confirm-footer">
            <button class="folder-picker-cancel" @click="cancelDeleteTeam">{{ t('dialog.cancel') }}</button>
            <button class="delete-confirm-btn" @click="confirmDeleteTeam">{{ t('dialog.delete') }}</button>
          </div>
        </div>
      </div>

      <!-- Password Authentication Dialog -->
      <div class="folder-picker-overlay" v-if="authRequired && !authLocked">
        <div class="auth-dialog">
          <div class="auth-dialog-header">
            <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
            <span>{{ t('auth.sessionProtected') }}</span>
          </div>
          <div class="auth-dialog-body">
            <p>{{ t('auth.passwordRequired') }}</p>
            <input
              type="password"
              class="auth-password-input"
              v-model="authPassword"
              @keydown.enter="submitPassword"
              :placeholder="t('auth.passwordPlaceholder')"
              autofocus
            />
            <p v-if="authError" class="auth-error">{{ authError }}</p>
            <p v-if="authAttempts" class="auth-attempts">{{ authAttempts }}</p>
          </div>
          <div class="auth-dialog-footer">
            <button class="auth-submit-btn" @click="submitPassword" :disabled="!authPassword.trim()">{{ t('auth.unlock') }}</button>
          </div>
        </div>
      </div>

      <!-- Auth Locked Out -->
      <div class="folder-picker-overlay" v-if="authLocked">
        <div class="auth-dialog auth-dialog-locked">
          <div class="auth-dialog-header">
            <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>
            <span>{{ t('auth.accessLocked') }}</span>
          </div>
          <div class="auth-dialog-body">
            <p>{{ authError }}</p>
            <p class="auth-locked-hint">{{ t('auth.tryAgainLater') }}</p>
          </div>
        </div>
      </div>

      <!-- Workdir switching overlay -->
      <Transition name="fade">
        <div v-if="workdirSwitching" class="workdir-switching-overlay">
          <div class="workdir-switching-spinner"></div>
          <div class="workdir-switching-text">{{ t('workdir.switching') }}</div>
        </div>
      </Transition>

      <!-- File context menu -->
      <div
        v-if="fileContextMenu"
        class="file-context-menu"
        :style="{ left: fileContextMenu.x + 'px', top: fileContextMenu.y + 'px' }"
      >
        <div class="file-context-item" @click="fileBrowser.askClaudeRead()">
          <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zM5 15h14v2H5zm0-4h14v2H5zm0-4h14v2H5z"/></svg>
          {{ t('contextMenu.askClaudeRead') }}
        </div>
        <div class="file-context-item" @click="fileBrowser.copyPath()">
          <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
          {{ fileContextMenu.copied ? t('contextMenu.copied') : t('contextMenu.copyPath') }}
        </div>
        <div class="file-context-item" @click="fileBrowser.insertPath()">
          <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/></svg>
          {{ t('contextMenu.insertPath') }}
        </div>
      </div>
    </div>
  `
};

const app = createApp(App);
app.mount('#app');
