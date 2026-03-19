// ── AgenticWorker Web UI — Store (state management + module wiring) ────────────
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
import { createMemory } from './modules/memory.js';
import { createGit } from './modules/git.js';
import { createLoop } from './modules/loop.js';
import { createScrollManager, createHighlightScheduler, formatUsage } from './modules/appHelpers.js';
import { createI18n } from './modules/i18n.js';
import { useTheme } from './composables/useTheme.js';
import { useSlashMenu } from './composables/useSlashMenu.js';
import { useToast } from './composables/useToast.js';
import { meetsMinVersion } from './modules/version.js';

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
  const activeClaudeSessions = ref(new Set());

  // Plan mode state
  const planMode = ref(false);
  const pendingPlanMode = ref(null);

  // Brain mode state (per-conversation, locks after first message)
  const brainMode = ref(false);
  const brainModeLocked = ref(false);

  // File browser state
  const filePanelOpen = ref(false);
  const filePanelWidth = ref(parseInt(localStorage.getItem('agentlink-file-panel-width'), 10) || 280);
  const fileTreeRoot = ref(null);
  const fileTreeLoading = ref(false);
  const fileContextMenu = ref(null);
  // Inline input state for creating new files/folders in file browser
  // { type: 'file'|'folder', dirPath: string, parentNode: object } or null
  const newItemInput = ref(null);
  const sidebarView = ref('sessions');
  const isMobile = ref(window.innerWidth <= 768);
  const workdirMenuOpen = ref(false);
  // Memory management state
  const memoryPanelOpen = ref(false);
  // Git panel state
  const gitPanelOpen = ref(false);
  const memoryFiles = ref([]);
  const memoryDir = ref(null);
  const memoryLoading = ref(false);
  const memoryEditing = ref(false);
  const memoryEditContent = ref('');
  const memorySaving = ref(false);
  // General file editing state
  const fileEditing = ref(false);
  const fileEditContent = ref('');
  const fileSaving = ref(false);
  const teamsCollapsed = ref(false);
  const chatsCollapsed = ref(false);
  const loopsCollapsed = ref(false);

  const _sidebarCollapseKey = () => hostname.value ? `agentlink-sidebar-collapsed-${hostname.value}` : null;
  const loadingTeams = ref(false);
  const loadingLoops = ref(false);

  // Team creation state

  // Loop creation/editing form state

  // File preview state
  const previewPanelOpen = ref(false);
  const previewPanelWidth = ref(parseInt(localStorage.getItem('agentlink-preview-panel-width'), 10) || 400);
  const previewFile = ref(null);
  const previewLoading = ref(false);
  const previewMarkdownRendered = ref(false);

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
        brainMode: brainMode.value,
        brainModeLocked: brainModeLocked.value,
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
      brainMode.value = cached.brainMode || false;
      brainModeLocked.value = cached.brainModeLocked || false;
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
      brainMode.value = false;
      brainModeLocked.value = false;
    }

    currentConversationId.value = newConvId;
    scrollToBottom(true);
  }

  // Theme
  const { theme, toggleTheme } = useTheme();

  // ── Toast notifications ──
  const { showToast, dismissToast } = useToast();

  function requireVersion(minVer, featureName) {
    if (meetsMinVersion(agentVersion.value, minVer)) return true;
    showToast(`${featureName} requires agent ${minVer}+. Run <code>agentlink-client upgrade</code>`);
    return false;
  }

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

  // ── Slash command menu ──
  const {
    slashMenuIndex, slashMenuOpen, slashMenuVisible, filteredSlashCommands,
    selectSlashCommand, openSlashMenu, handleSlashMenuKeydown,
  } = useSlashMenu({ inputText, inputRef, brainMode });

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
    workdirMenuOpen, memoryPanelOpen, filePanelOpen, gitPanelOpen,
    isMobile, sidebarView,
    // Multi-session parallel
    currentConversationId, conversationCache, processingConversations, activeClaudeSessions,
    switchConversation,
    // Brain mode
    setBrainMode,
    // i18n
    t,
  });
  const { connect, wsSend, closeWs, submitPassword, setDequeueNext, setFileBrowser, setFilePreview, setTeam, setLoop, setGit, getToolMsgMap, restoreToolMsgMap, clearToolMsgMap } = createConnection({
    status, agentName, hostname, workDir, sessionId, error,
    serverVersion, agentVersion, latency,
    messages, isProcessing, isCompacting, visibleLimit, queuedMessages, usageStats,
    historySessions, currentClaudeSessionId, needsResume, loadingSessions, loadingHistory,
    folderPickerLoading, folderPickerEntries, folderPickerPath,
    authRequired, authPassword, authError, authAttempts, authLocked,
    streaming, sidebar, scrollToBottom,
    workdirSwitching,
    // Multi-session parallel
    currentConversationId, processingConversations, conversationCache, activeClaudeSessions,
    switchConversation,
    // Memory management
    memoryFiles, memoryDir, memoryLoading, memoryEditing, memoryEditContent, memorySaving, memoryPanelOpen,
    // File creation inline input
    newItemInput, showToast,
    // Side question (/btw)
    btwState, btwPending,
    // Plan mode
    setPlanMode,
    // Brain mode
    setBrainMode,
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
    setViewMode: (mode) => { team.viewMode.value = mode; },
    formatRelativeTime: (ts) => formatRelativeTime(ts, t),
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
    sidebarOpen, sidebarView, newItemInput, requireVersion, t,
    previewFile, closePreview: () => filePreview.closePreview(),
  });
  setFileBrowser(fileBrowser);
  sidebar.setFileBrowser(fileBrowser);

  // File preview module
  const filePreview = createFilePreview({
    wsSend, previewPanelOpen, previewPanelWidth, previewFile, previewLoading,
    previewMarkdownRendered, sidebarView, sidebarOpen, isMobile, renderMarkdown,
    fileEditing, fileEditContent, fileSaving, memoryDir,
  });

  // Memory module
  const memory = createMemory({
    wsSend, workDir,
    memoryPanelOpen, memoryFiles, memoryDir, memoryLoading,
    memoryEditing, memoryEditContent, memorySaving,
    previewFile, filePreview,
    isMobile, sidebarView, workdirMenuOpen, filePanelOpen, gitPanelOpen, t,
  });
  setFilePreview(filePreview);

  // Git module
  const git = createGit({
    wsSend: (msg) => _wsSend(msg),
    workDir, gitPanelOpen, filePanelOpen, memoryPanelOpen,
    previewFile, previewPanelOpen,
    isMobile, sidebarView, workdirMenuOpen,
    t,
  });
  setGit(git);
  sidebar.setGit(git);

  const isMemoryPreview = computed(() => {
    if (!previewFile.value?.filePath || !memoryDir.value) return false;
    const fp = previewFile.value.filePath.replace(/\\/g, '/');
    const md = memoryDir.value.replace(/\\/g, '/');
    return fp.startsWith(md);
  });

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
    if (brainMode.value) {
      payload.brainMode = true;
    }
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

  // ── Brain mode ──
  function isSessionBrainMode(claudeSessionId) {
    if (!claudeSessionId) return false;
    return !!historySessions.value.find(s => s.sessionId === claudeSessionId)?.brainMode;
  }

  function setBrainMode(enabled) {
    brainMode.value = enabled;
    brainModeLocked.value = enabled;
  }

  function toggleBrainMode() {
    if (brainModeLocked.value) return;
    brainMode.value = true;
    brainModeLocked.value = true;
  }

  // Hide brain button for resumed non-brain sessions
  const showBrainButton = computed(() => brainMode.value || !currentClaudeSessionId.value);

  function handleKeydown(e) {
    // Slash menu key handling (must come before btw overlay so Escape closes menu first)
    if (handleSlashMenuKeydown(e)) return;
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
    document.title = name ? `${name} \u2014 AgenticWorker` : 'AgenticWorker';
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
    document.removeEventListener('keydown', _workdirMenuKeyHandler);
    document.removeEventListener('visibilitychange', _onVisibilityChange);
  });

  // ── Public API ──
  // Domain modules exposed for App.vue to provide() separately
  const _team = team;
  const _loop = loop;
  const _sidebar = {
    ...sidebar,
    // State refs owned by store but used by sidebar consumers
    sidebarOpen, historySessions, currentClaudeSessionId, loadingSessions, loadingHistory,
    processingConversations,
    // Folder picker state
    folderPickerOpen, folderPickerPath, folderPickerEntries,
    folderPickerLoading, folderPickerSelected,
    // Delete/rename session state
    deleteConfirmOpen, deleteConfirmTitle,
    renamingSessionId, renameText,
    // Working directory
    workdirHistory, workdirSwitching, workdirMenuOpen,
    // Sidebar collapse states
    teamsCollapsed, chatsCollapsed, loopsCollapsed, loadingTeams, loadingLoops,
    formatRelativeTime: (ts) => formatRelativeTime(ts, t),
    isSessionBrainMode,
  };
  const _files = {
    fileBrowser, filePreview,
    flattenedTree: fileBrowser.flattenedTree,
    // File browser state
    filePanelOpen, filePanelWidth, fileTreeRoot, fileTreeLoading, fileContextMenu, newItemInput,
    // File preview state
    previewPanelOpen, previewPanelWidth, previewFile, previewLoading, previewMarkdownRendered,
    isMemoryPreview,
    // Memory management
    memoryPanelOpen, memoryFiles, memoryDir, memoryLoading,
    memoryEditing, memoryEditContent, memorySaving,
    // General file editing
    fileEditing, fileEditContent, fileSaving,
    canEditFile: filePreview.canEditFile,
    startFileEdit: filePreview.startFileEdit,
    cancelFileEdit: filePreview.cancelFileEdit,
    saveFileEdit: filePreview.saveFileEdit,
    workdirMenuMemory: memory.workdirMenuMemory,
    refreshMemory: memory.refreshMemory,
    openMemoryFile: memory.openMemoryFile,
    startMemoryEdit: memory.startMemoryEdit,
    cancelMemoryEdit: memory.cancelMemoryEdit,
    saveMemoryEdit: memory.saveMemoryEdit,
    deleteMemoryFile: memory.deleteMemoryFile,
    // Git panel
    gitPanelOpen, git,
  };

  return {
    // Connection
    status, agentName, hostname, workDir, sessionId, error,
    serverVersion, agentVersion, latency, wsSend,
    // Messages
    messages, visibleMessages, hasMoreMessages, loadMoreMessages,
    inputText, isProcessing, isCompacting, canSend, hasInput, hasStreamingMessage,
    inputRef, queuedMessages, usageStats,
    // Slash menu
    slashMenuVisible, filteredSlashCommands, slashMenuIndex, slashMenuOpen,
    selectSlashCommand, openSlashMenu,
    // Actions
    sendMessage, handleKeydown, cancelExecution, removeQueuedMessage,
    onMessageListScroll, autoResize,
    // Plan mode
    planMode, pendingPlanMode, togglePlanMode,
    // Brain mode
    brainMode, brainModeLocked, toggleBrainMode, showBrainButton,
    // Side question (/btw)
    btwState, btwPending, dismissBtw,
    // Message rendering helpers
    renderMarkdown, getRenderedContent, copyMessage, toggleTool,
    isPrevAssistant: _isPrevAssistant,
    toggleContextSummary, formatTimestamp,
    formatUsage: (u) => formatUsage(u, t),
    getToolIcon,
    getToolSummary: (msg) => getToolSummary(msg, t),
    isEditTool,
    getEditDiffHtml: (msg) => getEditDiffHtml(msg, t),
    getFormattedToolInput: (msg) => getFormattedToolInput(msg, t),
    // AskUserQuestion
    selectQuestionOption,
    submitQuestionAnswer: _submitQuestionAnswer,
    hasQuestionAnswer, getQuestionResponseSummary,
    // Theme
    theme, toggleTheme,
    // Toast & version gating
    showToast, dismissToast, requireVersion,
    // i18n
    t, locale, toggleLocale, localeLabel, displayStatus,
    // Auth
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
    // Shared utility
    formatDuration: loop.formatDuration,
    // UI state
    viewMode: team.viewMode,
    sidebarView, isMobile, loadingHistory,
    // Team feed helpers (depend on both store + team)
    feedAgentName, feedContentRest,
    // Domain modules (for App.vue to provide separately)
    _team, _loop, _sidebar, _files,
  };
}
