// ── AgentLink Web UI — Store (state management + module wiring) ────────────
import { ref, nextTick, computed, watch, onMounted, onUnmounted } from 'vue';

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
  { command: '/btw', descKey: 'slash.btw', isPrefix: true },
  { command: '/cost', descKey: 'slash.cost' },
  { command: '/context', descKey: 'slash.context' },
  { command: '/compact', descKey: 'slash.compact' },
];

/**
 * Creates the application store.
 * Must be called inside a Vue component setup() context (uses onMounted/onUnmounted).
 */
export function createStore() {
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
  const slashMenuOpen = ref(false);

  // Side question (/btw) state
  const btwState = ref(null);
  const btwPending = ref(false);

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
  const conversationCache = ref({});
  const currentConversationId = ref(crypto.randomUUID());
  const processingConversations = ref({});

  // Plan mode state
  const planMode = ref(false);
  const pendingPlanMode = ref(null);

  // File browser state
  const filePanelOpen = ref(false);
  const filePanelWidth = ref(parseInt(localStorage.getItem('agentlink-file-panel-width'), 10) || 280);
  const fileTreeRoot = ref(null);
  const fileTreeLoading = ref(false);
  const fileContextMenu = ref(null);
  const sidebarView = ref('sessions');
  const isMobile = ref(window.innerWidth <= 768);
  const workdirMenuOpen = ref(false);
  const teamsCollapsed = ref(false);
  const chatsCollapsed = ref(false);
  const loopsCollapsed = ref(false);

  // Memory management state
  const memoryPanelOpen = ref(false);
  const memoryFiles = ref([]);
  const memoryDir = ref(null);
  const memoryLoading = ref(false);
  const memoryEditing = ref(false);
  const memoryEditContent = ref('');
  const memorySaving = ref(false);
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
      title: '\u4EE3\u7801\u5BA1\u67E5',
      template: 'code-review',
      text: '\u5BA1\u67E5\u5F53\u524D\u9879\u76EE\u7684\u4EE3\u7801\u8D28\u91CF\u3001\u5B89\u5168\u6F0F\u6D1E\u548C\u6D4B\u8BD5\u8986\u76D6\u7387\uFF0C\u6309\u4E25\u91CD\u7A0B\u5EA6\u751F\u6210\u5206\u7EA7\u62A5\u544A\uFF0C\u5E76\u7ED9\u51FA\u4FEE\u590D\u5EFA\u8BAE\u3002',
    },
    {
      icon: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>',
      title: '\u6280\u672F\u6587\u6863',
      template: 'content',
      text: '\u4E3A\u5F53\u524D\u9879\u76EE\u7F16\u5199\u4E00\u4EFD\u5B8C\u6574\u7684\u6280\u672F\u6587\u6863\uFF1A\u5148\u8C03\u7814\u9879\u76EE\u7ED3\u6784\u548C\u6838\u5FC3\u6A21\u5757\uFF0C\u7136\u540E\u64B0\u5199\u5305\u542B\u67B6\u6784\u6982\u89C8\u3001API \u53C2\u8003\u548C\u4F7F\u7528\u6307\u5357\u7684\u6587\u6863\uFF0C\u6700\u540E\u6821\u5BA1\u786E\u4FDD\u51C6\u786E\u6027\u548C\u53EF\u8BFB\u6027\u3002',
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
  const isMemoryPreview = computed(() => {
    if (!previewFile.value?.filePath || !memoryDir.value) return false;
    const fp = previewFile.value.filePath.replace(/\\/g, '/');
    const md = memoryDir.value.replace(/\\/g, '/');
    return fp.startsWith(md);
  });

  // ── switchConversation: save current → load target ──
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
        planMode: planMode.value,
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
      streaming.setMessageIdCounter(cached.messageIdCounter || 0);
      _restoreToolMsgMap(cached.toolMsgMap || new Map());
      queuedMessages.value = cached.queuedMessages || [];
      usageStats.value = cached.usageStats || null;
      planMode.value = cached.planMode || false;
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
      planMode.value = false;
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
    // Memory management
    memoryFiles, memoryDir, memoryLoading, memoryEditing, memoryEditContent, memorySaving, memoryPanelOpen,
    // Side question (/btw)
    btwState, btwPending,
    // Plan mode
    setPlanMode,
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
    wsSend, scrollToBottom, loadingTeams,
  });
  setTeam(team);
  // Loop module
  const loop = createLoop({
    wsSend, scrollToBottom, loadingLoops,
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

  // Track mobile state on resize (rAF-throttled)
  let _resizeRafId = 0;
  let _resizeHandler = () => {
    if (_resizeRafId) return;
    _resizeRafId = requestAnimationFrame(() => {
      _resizeRafId = 0;
      isMobile.value = window.innerWidth <= 768;
    });
  };
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
  const hasPendingQuestion = computed(() => messages.value.some(m => m.role === 'ask-question' && !m.answered));
  const canSend = computed(() =>
    status.value === 'Connected' && hasInput.value && !isCompacting.value && !hasPendingQuestion.value
  );
  const hasStreamingMessage = computed(() => messages.value.some(m => m.isStreaming));

  // ── Slash command menu ──
  const slashMenuVisible = computed(() => {
    if (slashMenuOpen.value) return true;
    const txt = inputText.value;
    return txt.startsWith('/') && !/\s/.test(txt.slice(1));
  });
  const filteredSlashCommands = computed(() => {
    if (slashMenuOpen.value && !inputText.value.startsWith('/')) return SLASH_COMMANDS;
    if (!inputText.value.startsWith('/')) return SLASH_COMMANDS;
    const txt = inputText.value.toLowerCase();
    return SLASH_COMMANDS.filter(c => c.command.startsWith(txt));
  });
  watch(filteredSlashCommands, () => { slashMenuIndex.value = 0; });

  // ── Auto-resize textarea ──
  let _autoResizeRaf = null;
  function autoResize() {
    if (_autoResizeRaf) return;
    _autoResizeRaf = requestAnimationFrame(() => {
      _autoResizeRaf = null;
      const ta = inputRef.value;
      if (ta) {
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
      }
    });
  }

  // ── Send message ──
  function sendMessage() {
    const text = inputText.value.trim();

    // Side question — /btw <question> (allowed even during compaction)
    if (text === '/btw' || text.startsWith('/btw ')) {
      if (status.value !== 'Connected') return;
      const question = text.startsWith('/btw ') ? text.slice(5).trim() : '';
      if (!question) return;
      btwState.value = { question, answer: '', done: false, error: null };
      btwPending.value = true;
      inputText.value = '';
      if (inputRef.value) inputRef.value.style.height = 'auto';
      wsSend({ type: 'btw_question', question, conversationId: currentConversationId.value, claudeSessionId: currentClaudeSessionId.value });
      return;
    }

    if (!canSend.value) return;

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

  function dismissBtw() {
    btwState.value = null;
    btwPending.value = false;
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

  // ── Plan mode ──
  function togglePlanMode() {
    if (isProcessing.value) return;
    const newMode = !planMode.value;
    pendingPlanMode.value = newMode ? 'enter' : 'exit';
    isProcessing.value = true;
    if (currentConversationId.value) {
      processingConversations.value[currentConversationId.value] = true;
    }
    const instruction = newMode ? 'Enter plan mode now.' : 'Exit plan mode now.';
    messages.value.push({
      id: streaming.nextId(), role: 'user', content: instruction,
      status: 'sent', timestamp: new Date(),
    });
    wsSend({ type: 'set_plan_mode', enabled: newMode, conversationId: currentConversationId.value, claudeSessionId: currentClaudeSessionId.value });
    nextTick(() => scrollToBottom());
  }
  function setPlanMode(enabled) {
    planMode.value = enabled;
    pendingPlanMode.value = null;
  }

  function selectSlashCommand(cmd) {
    slashMenuOpen.value = false;
    if (cmd.isPrefix) {
      inputText.value = cmd.command + ' ';
      nextTick(() => inputRef.value?.focus());
    } else {
      inputText.value = cmd.command;
      sendMessage();
    }
  }

  function openSlashMenu() {
    slashMenuOpen.value = !slashMenuOpen.value;
    slashMenuIndex.value = 0;
  }

  function _slashMenuClickOutside(e) {
    if (slashMenuOpen.value && !e.target.closest('.slash-btn') && !e.target.closest('.slash-menu')) {
      slashMenuOpen.value = false;
    }
  }
  document.addEventListener('click', _slashMenuClickOutside);

  function handleKeydown(e) {
    // Slash menu key handling (must come before btw overlay so Escape closes menu first)
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
        slashMenuOpen.value = false;
        inputText.value = '';
        return;
      }
    }
    // Btw overlay dismiss (after slash menu so menu Escape takes priority)
    if (e.key === 'Escape' && btwState.value) {
      dismissBtw();
      e.preventDefault();
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  }

  // ── Template adapter wrappers ──
  function _isPrevAssistant(idx) {
    return isPrevAssistant(visibleMessages.value, idx);
  }

  function _submitQuestionAnswer(msg) {
    submitQuestionAnswer(msg, wsSend);
  }

  // ── feedAgentName / feedContentRest (refactored from this-based to direct calls) ──
  function feedAgentName(entry) {
    if (!entry.agentId) return null;
    const agent = team.findAgent(entry.agentId);
    if (!agent || !agent.name) return null;
    if (entry.content && entry.content.startsWith(agent.name)) {
      return agent.name;
    }
    return null;
  }

  function feedContentRest(entry) {
    const name = feedAgentName(entry);
    if (name && entry.content && entry.content.startsWith(name)) {
      return entry.content.slice(name.length);
    }
    return entry.content || '';
  }

  // ── Watchers ──
  const messageCount = computed(() => messages.value.length);
  watch(messageCount, () => { nextTick(scheduleHighlight); });

  watch(hostname, (name) => {
    document.title = name ? `${name} \u2014 AgentLink` : 'AgentLink';
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
  function _onVisibilityChange() {
    if (!document.hidden) {
      nextTick(() => scrollToBottom(true));
    }
  }

  onMounted(() => {
    connect(scheduleHighlight);
    document.addEventListener('visibilitychange', _onVisibilityChange);
  });
  onUnmounted(() => {
    closeWs(); streaming.cleanup(); cleanupScroll(); cleanupHighlight();
    window.removeEventListener('resize', _resizeHandler);
    document.removeEventListener('click', _workdirMenuClickHandler);
    document.removeEventListener('click', _slashMenuClickOutside);
    document.removeEventListener('keydown', _workdirMenuKeyHandler);
    document.removeEventListener('visibilitychange', _onVisibilityChange);
  });

  return {
    status, agentName, hostname, workDir, sessionId, error,
    serverVersion, agentVersion, latency,
    messages, visibleMessages, hasMoreMessages, loadMoreMessages,
    inputText, isProcessing, isCompacting, canSend, hasInput, hasStreamingMessage, inputRef, queuedMessages, usageStats,
    slashMenuVisible, filteredSlashCommands, slashMenuIndex, slashMenuOpen, selectSlashCommand, openSlashMenu,
    sendMessage, handleKeydown, cancelExecution, removeQueuedMessage, onMessageListScroll,
    // Plan mode
    planMode, pendingPlanMode, togglePlanMode,
    // Side question (/btw)
    btwState, btwPending, dismissBtw, renderMarkdown,
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
      else { memoryPanelOpen.value = false; fileBrowser.togglePanel(); }
    },
    workdirMenuChangeDir() {
      workdirMenuOpen.value = false;
      sidebar.openFolderPicker();
    },
    workdirMenuCopyPath() {
      workdirMenuOpen.value = false;
      fileBrowser.copyToClipboard(workDir.value);
    },
    // Memory management
    memoryPanelOpen, memoryFiles, memoryDir, memoryLoading,
    memoryEditing, memoryEditContent, memorySaving, isMemoryPreview,
    workdirMenuMemory() {
      workdirMenuOpen.value = false;
      if (isMobile.value) {
        sidebarView.value = 'memory';
      } else {
        memoryPanelOpen.value = !memoryPanelOpen.value;
        if (memoryPanelOpen.value) filePanelOpen.value = false;
      }
      if (!memoryFiles.value.length) {
        memoryLoading.value = true;
        wsSend({ type: 'list_memory' });
      }
    },
    refreshMemory() {
      memoryLoading.value = true;
      wsSend({ type: 'list_memory' });
    },
    openMemoryFile(file) {
      memoryEditing.value = false;
      memoryEditContent.value = '';
      if (memoryDir.value) {
        const sep = memoryDir.value.includes('\\') ? '\\' : '/';
        filePreview.openPreview(memoryDir.value + sep + file.name);
      }
      if (isMobile.value) sidebarView.value = 'preview';
    },
    startMemoryEdit() {
      memoryEditing.value = true;
      memoryEditContent.value = previewFile.value?.content || '';
    },
    cancelMemoryEdit() {
      if (memoryEditContent.value !== (previewFile.value?.content || '')) {
        if (!confirm(t('memory.discardChanges'))) return;
      }
      memoryEditing.value = false;
      memoryEditContent.value = '';
    },
    saveMemoryEdit() {
      if (!previewFile.value) return;
      memorySaving.value = true;
      wsSend({
        type: 'update_memory',
        filename: previewFile.value.fileName,
        content: memoryEditContent.value,
      });
    },
    deleteMemoryFile(file) {
      if (!confirm(t('memory.deleteConfirm', { name: file.name }))) return;
      wsSend({ type: 'delete_memory', filename: file.name });
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
    feedAgentName,
    feedContentRest,
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
      const totalSecs = Math.floor(ms / 1000);
      if (totalSecs < 60) return totalSecs + 's';
      const m = Math.floor(totalSecs / 60);
      const s = totalSecs % 60;
      if (m < 60) return m + 'm ' + String(s).padStart(2, '0') + 's';
      const h = Math.floor(m / 60);
      const rm = m % 60;
      return h + 'h ' + String(rm).padStart(2, '0') + 'm';
    },
    isLoopRunning(loopId) {
      return !!loop.runningLoops.value[loopId];
    },
    padTwo(n) {
      return String(n).padStart(2, '0');
    },
  };
}
