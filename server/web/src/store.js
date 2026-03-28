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
import { createRecap } from './modules/recap.js';
import { createBriefing } from './modules/briefing.js';
import { createDevops } from './modules/devops.js';
import { createProject } from './modules/project.js';
import { createRouter } from './modules/router.js';
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

  // Outline panel state
  const outlineOpen = ref(false);

  // Sidebar state
  const sidebarOpen = ref(window.innerWidth > 768);
  const sidebarWidth = ref(parseInt(localStorage.getItem('agentlink-sidebar-width'), 10) || 260);
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

  // Rename session state
  const renamingSessionId = ref(null);
  const renameText = ref('');

  // Team rename/delete state

  // Working directory history
  const workdirHistory = ref([]);
  const workdirCollapsed = ref(false);

  // Global recent sessions (cross-workdir)
  const globalRecentSessions = ref([]);
  const loadingGlobalSessions = ref(false);
  const recentTab = ref('dirs'); // 'dirs' | 'sessions'

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
  const currentView = ref('chat'); // 'chat' | 'recap-feed' | 'recap-detail'

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
        outlineOpen: outlineOpen.value,
        scrollTop: getScrollTop(),
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
      outlineOpen.value = cached.outlineOpen || false;
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
      outlineOpen.value = false;
    }

    currentConversationId.value = newConvId;
    if (cached && cached.scrollTop != null) {
      nextTick(() => setScrollTop(cached.scrollTop));
    } else {
      scrollToBottom(true);
    }
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
  const { onScroll: onMessageListScroll, scrollToBottom, cleanup: cleanupScroll, getScrollTop, setScrollTop } = createScrollManager('.message-list');

  // ── Highlight.js scheduling ──
  const { scheduleHighlight, cleanup: cleanupHighlight } = createHighlightScheduler();

  // ── Slash command menu ──
  const {
    slashMenuIndex, slashMenuOpen, slashMenuVisible, filteredSlashCommands,
    selectSlashCommand, openSlashMenu, handleSlashMenuKeydown,
  } = useSlashMenu({ inputText, inputRef, brainMode });

  // ── Create module instances ──

  const streaming = createStreaming({ messages, scrollToBottom });

  const router = createRouter();

  const fileAttach = createFileAttachments(attachments, fileInputRef, dragOver);

  // Sidebar needs wsSend, but connection creates wsSend.
  // Resolve circular dependency with a forwarding function.
  let _wsSend = () => {};

  const sidebar = createSidebar({
    wsSend: (msg) => _wsSend(msg),
    messages, isProcessing, sidebarOpen, sidebarWidth,
    historySessions, currentClaudeSessionId, needsResume,
    loadingSessions, loadingHistory, workDir, visibleLimit,
    folderPickerOpen, folderPickerPath, folderPickerEntries,
    folderPickerLoading, folderPickerSelected, streaming,
    renamingSessionId, renameText,
    hostname, workdirHistory, workdirCollapsed, workdirSwitching,
    workdirMenuOpen, memoryPanelOpen, filePanelOpen, gitPanelOpen,
    isMobile, sidebarView,
    // Global recent sessions
    globalRecentSessions, loadingGlobalSessions, recentTab,
    // Multi-session parallel
    currentConversationId, conversationCache, processingConversations, activeClaudeSessions,
    switchConversation,
    // Brain mode
    setBrainMode,
    // Version gating
    requireVersion,
    // i18n
    t,
  });
  const { connect, wsSend, closeWs, submitPassword, setDequeueNext, setFileBrowser, setFilePreview, setTeam, setLoop, setGit, setRecap, setBriefing, setDevops, setProject, getToolMsgMap, restoreToolMsgMap, clearToolMsgMap } = createConnection({
    status, agentName, hostname, workDir, sessionId, error,
    serverVersion, agentVersion, latency,
    messages, isProcessing, isCompacting, visibleLimit, queuedMessages, usageStats,
    historySessions, currentClaudeSessionId, needsResume, loadingSessions, loadingHistory,
    globalRecentSessions, loadingGlobalSessions,
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
    // Router — start after WebSocket connects
    onConnected: () => router.start(),
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
    wsSend, scrollToBottom, loadingTeams, t,
  });
  setTeam(team);
  // Loop module
  const loop = createLoop({
    wsSend, scrollToBottom, loadingLoops, showToast, t,
    setViewMode: (mode) => { team.viewMode.value = mode; },
    formatRelativeTime: (ts) => formatRelativeTime(ts, t),
    requireVersion,
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

  // Recap module (only in brain/ms mode)
  const isMsRoute = window.location.pathname.startsWith('/ms/');
  const recap = isMsRoute ? createRecap({
    wsSend,
    switchConversation,
    conversationCache,
    messages,
    isProcessing,
    currentConversationId,
    currentClaudeSessionId,
    needsResume,
    loadingHistory,
    setBrainMode,
    scrollToBottom,
    historySessions,
    loadingSessions,
    currentView,
  }) : null;
  if (recap) setRecap(recap);
  if (recap) recap.setRequestSessionList(sidebar.requestSessionList);

  // Briefing module (only in brain/ms mode)
  const briefing = isMsRoute ? createBriefing({
    wsSend,
    currentView,
    switchConversation,
    conversationCache,
    messages,
    currentConversationId,
    currentClaudeSessionId,
    needsResume,
    loadingHistory,
    setBrainMode,
    scrollToBottom,
    historySessions,
    loadingSessions,
  }) : null;
  if (briefing) setBriefing(briefing);
  if (briefing) briefing.setRequestSessionList(sidebar.requestSessionList);

  // DevOps module (only in brain/ms mode)
  const devops = isMsRoute ? createDevops({
    wsSend,
    currentView,
    switchConversation,
    conversationCache,
    messages,
    currentConversationId,
    currentClaudeSessionId,
    needsResume,
    loadingHistory,
    setBrainMode,
    scrollToBottom,
    historySessions,
    loadingSessions,
  }) : null;
  if (devops) setDevops(devops);
  if (devops) devops.setRequestSessionList(sidebar.requestSessionList);

  const project = isMsRoute ? createProject({
    wsSend,
    currentView,
    switchConversation,
    conversationCache,
    messages,
    currentConversationId,
    currentClaudeSessionId,
    needsResume,
    loadingHistory,
    setBrainMode,
    scrollToBottom,
    historySessions,
    loadingSessions,
  }) : null;
  if (project) setProject(project);
  if (project) project.setRequestSessionList(sidebar.requestSessionList);

  // ── Hash router — route registration ──
  // Register routes AFTER all modules are created so handlers can access module state.

  // #/ → Chat (default)
  router.addRoute('/', () => {
    team.viewMode.value = 'chat';
    if (recap) {
      recap.goBackToFeed();
      currentView.value = 'chat';
    }
  });

  // #/chat/:sessionId → Resume historical session
  router.addRoute('/chat/:sessionId', ({ sessionId: claudeId }) => {
    team.viewMode.value = 'chat';
    if (recap) currentView.value = 'chat';
    sidebar.resumeSession({ sessionId: claudeId });
  });

  // #/team → Team dashboard
  router.addRoute('/team', () => {
    team.viewMode.value = 'team';
    team.activeAgentView.value = null;
  });

  // #/loop → Loop list
  router.addRoute('/loop', () => {
    team.viewMode.value = 'loop';
  });

  // #/recap → Recap feed
  if (recap) {
    router.addRoute('/recap', () => {
      team.viewMode.value = 'feed';
      currentView.value = 'recap-feed';
      recap.goBackToFeed();
    });

    // #/recap/:recapId → Recap detail
    router.addRoute('/recap/:recapId', ({ recapId }) => {
      team.viewMode.value = 'feed';
      currentView.value = 'recap-detail';
      // Look up sidecarPath from loaded feed entries
      const entry = recap.feedEntries.value.find(e => e.recap_id === recapId);
      if (entry) {
        recap.selectRecap(recapId, entry.sidecar_path);
      } else {
        // Feed not loaded yet — set selectedRecapId; detail will load when feed arrives
        recap.selectedRecapId.value = recapId;
      }
    });
  }

  // #/briefing → Briefing feed
  if (briefing) {
    router.addRoute('/briefing', () => {
      team.viewMode.value = 'feed';
      currentView.value = 'briefing-feed';
      briefing.goBackToFeed();
    });

    // #/briefing/:date → Briefing detail
    router.addRoute('/briefing/:date', ({ date }) => {
      team.viewMode.value = 'feed';
      currentView.value = 'briefing-detail';
      briefing.selectBriefing(date);
    });
  }

  // #/devops → DevOps feed
  if (devops) {
    router.addRoute('/devops', () => {
      team.viewMode.value = 'feed';
      currentView.value = 'devops-feed';
      devops.goBackToFeed();
    });

    // #/devops/pr/:id → DevOps PR detail
    router.addRoute('/devops/pr/:id', ({ id }) => {
      team.viewMode.value = 'feed';
      currentView.value = 'devops-detail';
      devops.selectEntity('pr', id);
    });

    // #/devops/wi/:id → DevOps WI detail
    router.addRoute('/devops/wi/:id', ({ id }) => {
      team.viewMode.value = 'feed';
      currentView.value = 'devops-detail';
      devops.selectEntity('wi', id);
    });
  }

  // #/project → Project feed
  if (project) {
    router.addRoute('/project', () => {
      team.viewMode.value = 'feed';
      currentView.value = 'project-feed';
      project.goBackToFeed();
    });

    // #/project/:name → Project detail
    router.addRoute('/project/:name', ({ name }) => {
      team.viewMode.value = 'feed';
      currentView.value = 'project-detail';
      project.selectProject(decodeURIComponent(name));
    });
  }

  // ── Hash router — state → hash sync watchers ──

  // viewMode changes → push hash
  watch(team.viewMode, (mode) => {
    if (router.isRestoring()) return;
    if (mode === 'chat') {
      // Only push #/ if no session is active (otherwise #/chat/:id takes precedence)
      if (!currentClaudeSessionId.value) router.push('/');
    } else if (mode === 'team') {
      router.push('/team');
    } else if (mode === 'loop') {
      router.push('/loop');
    } else if (mode === 'feed') {
      // Push the hash for whichever feed tab was last active
      if (currentView.value === 'briefing-feed' || currentView.value === 'briefing-detail') {
        router.push('/briefing');
      } else if (currentView.value === 'devops-feed' || currentView.value === 'devops-detail') {
        router.push('/devops');
      } else if (currentView.value === 'project-feed' || currentView.value === 'project-detail') {
        router.push('/project');
      } else {
        router.push('/recap');
      }
    }
  });

  // Claude session changes → push #/chat/:sessionId or #/
  watch(currentClaudeSessionId, (id) => {
    if (router.isRestoring()) return;
    if (team.viewMode.value !== 'chat') return;
    if (recap && recap.recapChatActive.value) return; // recap chat has its own routing
    if (briefing && briefing.briefingChatActive.value) return; // briefing chat has its own routing
    if (devops && devops.devopsChatActive.value) return; // devops chat has its own routing
    if (project && project.projectChatActive.value) return; // project chat has its own routing
    router.push(id ? `/chat/${id}` : '/');
  });

  // Recap detail selection → push #/recap/:recapId or #/recap
  if (recap) {
    watch(recap.selectedRecapId, (id) => {
      if (router.isRestoring()) return;
      if (team.viewMode.value !== 'feed') return;
      router.push(id ? `/recap/${id}` : '/recap');
    });
  }

  // Briefing detail selection → push #/briefing/:date or #/briefing
  if (briefing) {
    watch(briefing.selectedDate, (date) => {
      if (router.isRestoring()) return;
      if (team.viewMode.value !== 'feed') return;
      router.push(date ? `/briefing/${date}` : '/briefing');
    });
  }

  // DevOps detail selection → push #/devops/pr/:id or #/devops/wi/:id or #/devops
  if (devops) {
    watch(devops.selectedEntityId, (id) => {
      if (router.isRestoring()) return;
      if (team.viewMode.value !== 'feed') return;
      if (id) {
        router.push(`/devops/${devops.selectedEntityType.value}/${id}`);
      } else {
        router.push('/devops');
      }
    });
  }

  // Project detail selection → push #/project/:name or #/project
  if (project) {
    watch(project.selectedProjectName, (name) => {
      if (router.isRestoring()) return;
      if (team.viewMode.value !== 'feed') return;
      if (name) {
        router.push(`/project/${encodeURIComponent(name)}`);
      } else {
        router.push('/project');
      }
    });
  }

  // Feed tab switch (recap-feed ↔ briefing-feed) → push hash
  watch(currentView, (view) => {
    if (router.isRestoring()) return;
    if (team.viewMode.value !== 'feed') return;
    if (view === 'recap-feed') router.push('/recap');
    else if (view === 'briefing-feed') router.push('/briefing');
    else if (view === 'devops-feed') router.push('/devops');
    else if (view === 'project-feed') router.push('/project');
  });

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

    // Recap chat — route through recap module when in recap detail view
    if (recap && recap.recapChatActive.value && currentView.value === 'recap-detail') {
      const recapId = recap.selectedRecapId.value;
      const detail = recap.selectedDetail.value;
      inputText.value = '';
      if (inputRef.value) inputRef.value.style.height = 'auto';
      const userMsg = {
        id: streaming.nextId(), role: 'user',
        content: text, timestamp: new Date(), status: 'sent',
      };
      messages.value.push(userMsg);
      isProcessing.value = true;
      if (currentConversationId.value) {
        processingConversations.value[currentConversationId.value] = true;
      }
      recap.sendRecapChat(text, recapId, detail);
      scrollToBottom(true);
      return;
    }

    // Briefing chat — route through briefing module when in briefing detail view
    if (briefing && briefing.briefingChatActive.value && currentView.value === 'briefing-detail') {
      const date = briefing.selectedDate.value;
      const content = briefing.selectedContent.value;
      inputText.value = '';
      if (inputRef.value) inputRef.value.style.height = 'auto';
      const userMsg = {
        id: streaming.nextId(), role: 'user',
        content: text, timestamp: new Date(), status: 'sent',
      };
      messages.value.push(userMsg);
      isProcessing.value = true;
      if (currentConversationId.value) {
        processingConversations.value[currentConversationId.value] = true;
      }
      briefing.sendBriefingChat(text, date, content);
      scrollToBottom(true);
      return;
    }

    // DevOps chat — route through devops module when in devops detail view
    if (devops && devops.devopsChatActive.value && currentView.value === 'devops-detail') {
      const entityType = devops.selectedEntityType.value;
      const entityId = devops.selectedEntityId.value;
      const description = devops.selectedDescription.value;
      const mentions = devops.selectedMentions.value;
      const entityTitle = devops.selectedEntity.value?.title || null;
      inputText.value = '';
      if (inputRef.value) inputRef.value.style.height = 'auto';
      const userMsg = {
        id: streaming.nextId(), role: 'user',
        content: text, timestamp: new Date(), status: 'sent',
      };
      messages.value.push(userMsg);
      isProcessing.value = true;
      if (currentConversationId.value) {
        processingConversations.value[currentConversationId.value] = true;
      }
      devops.sendDevopsChat(text, entityType, entityId, description, mentions, entityTitle);
      scrollToBottom(true);
      return;
    }

    // Project chat — route through project module when in project detail view
    if (project && project.projectChatActive.value && currentView.value === 'project-detail') {
      const projectName = project.selectedProjectName.value;
      const allContent = project.selectedAllContent.value;
      inputText.value = '';
      if (inputRef.value) inputRef.value.style.height = 'auto';
      const userMsg = {
        id: streaming.nextId(), role: 'user',
        content: text, timestamp: new Date(), status: 'sent',
      };
      messages.value.push(userMsg);
      isProcessing.value = true;
      if (currentConversationId.value) {
        processingConversations.value[currentConversationId.value] = true;
      }
      project.sendProjectChat(text, projectName, allContent);
      scrollToBottom(true);
      return;
    }

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

  // ── Outline panel ──
  function toggleOutline() {
    outlineOpen.value = !outlineOpen.value;
  }

  function scrollToMessage(msgIdx) {
    // Ensure the target message is within the rendered (visible) range
    const needed = messages.value.length - msgIdx;
    if (needed > visibleLimit.value) {
      visibleLimit.value = needed;
    }

    nextTick(() => {
      const msg = messages.value[msgIdx];
      if (!msg) return;
      const el = document.querySelector(`[data-msg-id="${msg.id}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.classList.add('outline-highlight');
        setTimeout(() => el.classList.remove('outline-highlight'), 1500);
      }
    });
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
    wsSend({ type: 'set_plan_mode', enabled: newMode, conversationId: currentConversationId.value });
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

  // Hide brain button for resumed non-brain sessions, and only show on /ms/ routes
  const showBrainButton = computed(() => isMsRoute && (brainMode.value || !currentClaudeSessionId.value));

  function handleKeydown(e) {
    // Slash menu key handling (must come before btw overlay so Escape closes menu first)
    if (handleSlashMenuKeydown(e)) return;
    // Btw overlay dismiss (after slash menu so menu Escape takes priority)
    if (e.key === 'Escape' && btwState.value) {
      dismissBtw();
      e.preventDefault();
      return;
    }

    // Outline toggle shortcut
    if (e.key === 'O' && e.ctrlKey && e.shiftKey) {
      e.preventDefault();
      toggleOutline();
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
        if (saved.workdir !== undefined) workdirCollapsed.value = saved.workdir;
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
        workdir: workdirCollapsed.value,
      }));
    }
  };
  watch(chatsCollapsed, _saveSidebarCollapsed);
  watch(teamsCollapsed, _saveSidebarCollapsed);
  watch(loopsCollapsed, _saveSidebarCollapsed);
  watch(workdirCollapsed, _saveSidebarCollapsed);

  // Sync feed mode lifecycle: enter/exit feed triggers recap/briefing/devops load/autorefresh
  if (recap || briefing || devops || project) {
    watch(team.viewMode, (newMode, oldMode) => {
      if (newMode === 'feed') {
        // During hash-restore the route handler already set currentView precisely
        // (e.g. 'recap-detail', 'briefing-feed'), so skip the blanket override.
        if (!router.isRestoring()) currentView.value = 'recap-feed';
        if (recap) { recap.loadFeed(); recap.startAutoRefresh(); }
        if (briefing) { briefing.loadFeed(); briefing.startAutoRefresh(); }
        if (devops) { devops.loadFeed(); devops.startAutoRefresh(); }
        if (project) { project.loadFeed(); project.startAutoRefresh(); }
      } else if (oldMode === 'feed') {
        currentView.value = 'chat';
        if (recap) recap.stopAutoRefresh();
        if (briefing) briefing.stopAutoRefresh();
        if (devops) devops.stopAutoRefresh();
        if (project) project.stopAutoRefresh();
      }
    });
  }

  // loadingTeams/loadingLoops are cleared in their respective message handlers
  // (teams_list / loops_list), not via watch, to avoid false resets when
  // clearing lists during workdir change.

  // ── Lifecycle ──
  function _forceRepaint() {
    const el = document.querySelector('.message-list');
    if (!el) return;
    el.style.transform = 'translateZ(0)';
    requestAnimationFrame(() => { el.style.transform = ''; });
  }

  function _onVisibilityChange() {
    if (!document.hidden) {
      // Safari/WebKit on iPad may freeze rendering of chat messages when the
      // tab loses focus (e.g. switching apps). Force a repaint on return.
      _forceRepaint();
      nextTick(() => scrollToBottom());
    }
  }

  function _onPageShow(e) {
    // pageshow fires more reliably than visibilitychange on iOS Safari when
    // returning from another app. persisted=true means bfcache restore.
    if (e.persisted) {
      _forceRepaint();
      nextTick(() => scrollToBottom());
    }
  }

  onMounted(() => {
    connect(scheduleHighlight);
    document.addEventListener('visibilitychange', _onVisibilityChange);
    window.addEventListener('pageshow', _onPageShow);
  });
  onUnmounted(() => {
    closeWs(); streaming.cleanup(); cleanupScroll(); cleanupHighlight();
    router.stop();
    window.removeEventListener('resize', _resizeHandler);
    document.removeEventListener('click', _workdirMenuClickHandler);
    document.removeEventListener('keydown', _workdirMenuKeyHandler);
    document.removeEventListener('visibilitychange', _onVisibilityChange);
    window.removeEventListener('pageshow', _onPageShow);
  });

  // ── Public API ──
  // Domain modules exposed for App.vue to provide() separately
  const _team = team;
  const _loop = loop;
  const _sidebar = {
    ...sidebar,
    // State refs owned by store but used by sidebar consumers
    sidebarOpen, sidebarWidth, historySessions, currentClaudeSessionId, loadingSessions, loadingHistory,
    processingConversations,
    // Folder picker state
    folderPickerOpen, folderPickerPath, folderPickerEntries,
    folderPickerLoading, folderPickerSelected,
    // Rename session state
    renamingSessionId, renameText,
    // Working directory
    workdirHistory, workdirCollapsed, workdirSwitching, workdirMenuOpen,
    // Global recent sessions
    globalRecentSessions, loadingGlobalSessions, recentTab,
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
    currentView,
    // Side question (/btw)
    btwState, btwPending, dismissBtw,
    // Outline panel
    outlineOpen, toggleOutline, scrollToMessage,
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
    isMsRoute,
    sidebarView, isMobile, loadingHistory,
    // Team feed helpers (depend on both store + team)
    feedAgentName, feedContentRest,
    // Domain modules (for App.vue to provide separately)
    _team, _loop, _sidebar, _files, _recap: recap, _briefing: briefing, _devops: devops, _project: project,
  };
}
