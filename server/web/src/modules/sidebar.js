// ── Sidebar: session management, folder picker, grouped sessions ─────────────
import { computed } from 'vue';
import { useConfirmDialog } from '../composables/useConfirmDialog.js';

/**
 * Creates sidebar functionality bound to reactive state.
 * @param {object} deps
 * @param {Function} deps.wsSend
 * @param {import('vue').Ref} deps.messages
 * @param {import('vue').Ref} deps.isProcessing
 * @param {import('vue').Ref} deps.sidebarOpen
 * @param {import('vue').Ref} deps.historySessions
 * @param {import('vue').Ref} deps.currentClaudeSessionId
 * @param {import('vue').Ref} deps.needsResume
 * @param {import('vue').Ref} deps.loadingSessions
 * @param {import('vue').Ref} deps.loadingHistory
 * @param {import('vue').Ref} deps.workDir
 * @param {import('vue').Ref} deps.visibleLimit
 * @param {import('vue').Ref} deps.folderPickerOpen
 * @param {import('vue').Ref} deps.folderPickerPath
 * @param {import('vue').Ref} deps.folderPickerEntries
 * @param {import('vue').Ref} deps.folderPickerLoading
 * @param {import('vue').Ref} deps.folderPickerSelected
 * @param {object} deps.streaming - streaming controller
 * @param {import('vue').Ref} deps.hostname
 * @param {import('vue').Ref} deps.workdirHistory
 * @param {import('vue').Ref} deps.workdirCollapsed
 */
export function createSidebar(deps) {
  const {
    wsSend, messages, isProcessing, sidebarOpen, sidebarWidth,
    historySessions, currentClaudeSessionId, needsResume,
    loadingSessions, loadingHistory, workDir, visibleLimit,
    folderPickerOpen, folderPickerPath, folderPickerEntries,
    folderPickerLoading, folderPickerSelected, streaming,
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
  } = deps;

  // Late-binding: set after fileBrowser is created
  let _fileBrowser = null;
  function setFileBrowser(fb) { _fileBrowser = fb; }

  // Late-binding: set after git module is created
  let _git = null;
  function setGit(g) { _git = g; }

  // Late-binding callback: called when user switches to a normal chat session
  let _onSwitchToChat = null;
  function setOnSwitchToChat(fn) { _onSwitchToChat = fn; }

  // ── Workdir switching timeout ──
  let _workdirSwitchTimer = null;
  function setWorkdirSwitching() {
    workdirSwitching.value = true;
    clearTimeout(_workdirSwitchTimer);
    _workdirSwitchTimer = setTimeout(() => { workdirSwitching.value = false; }, 10000);
  }

  // ── Session management ──

  let _sessionListTimer = null;

  function requestSessionList() {
    // Debounce: coalesce rapid calls (e.g. session_started + turn_completed)
    // into a single request. First call fires immediately, subsequent calls
    // within 2s are deferred.
    if (_sessionListTimer) {
      clearTimeout(_sessionListTimer);
      _sessionListTimer = setTimeout(() => {
        _sessionListTimer = null;
        loadingSessions.value = true;
        wsSend({ type: 'list_sessions' });
      }, 2000);
      return;
    }
    loadingSessions.value = true;
    wsSend({ type: 'list_sessions' });
    _sessionListTimer = setTimeout(() => { _sessionListTimer = null; }, 2000);
  }

  function resumeSession(session) {
    if (window.innerWidth <= 768) sidebarOpen.value = false;
    if (_onSwitchToChat) _onSwitchToChat();

    // Multi-session: check if we already have a conversation loaded for this claudeSessionId
    if (switchConversation && conversationCache) {
      // Check cache for existing conversation with this claudeSessionId
      for (const [convId, cached] of Object.entries(conversationCache.value)) {
        if (cached.claudeSessionId === session.sessionId) {
          switchConversation(convId);
          return;
        }
      }
      // Check if current foreground already shows this session
      if (currentClaudeSessionId.value === session.sessionId) {
        return;
      }
      // Create new conversationId, switch to it, then send resume
      const newConvId = crypto.randomUUID();
      switchConversation(newConvId);
      currentClaudeSessionId.value = session.sessionId;
      needsResume.value = true;
      loadingHistory.value = true;
      wsSend({
        type: 'resume_conversation',
        conversationId: newConvId,
        claudeSessionId: session.sessionId,
      });
      return;
    }

    // Legacy fallback (no multi-session)
    if (isProcessing.value) return;
    messages.value = [];
    visibleLimit.value = 50;
    streaming.setMessageIdCounter(0);
    streaming.setStreamingMessageId(null);
    streaming.reset();

    currentClaudeSessionId.value = session.sessionId;
    needsResume.value = true;
    loadingHistory.value = true;

    wsSend({
      type: 'resume_conversation',
      claudeSessionId: session.sessionId,
    });
  }

  function newConversation() {
    if (window.innerWidth <= 768) sidebarOpen.value = false;
    if (_onSwitchToChat) _onSwitchToChat();

    // Multi-session: just switch to a new blank conversation
    if (switchConversation) {
      const newConvId = crypto.randomUUID();
      switchConversation(newConvId);
      // Re-enable brain mode if currently in Brain Home directory
      // (switchConversation resets brainMode to false)
      if (setBrainMode) {
        const dir = (workDir.value || '').replace(/\\/g, '/');
        if (dir.endsWith('/.brain/BrainCore')) setBrainMode(true);
      }
      messages.value.push({
        id: streaming.nextId(), role: 'system',
        content: t('system.newConversation'),
        timestamp: new Date(),
      });
      return;
    }

    // Legacy fallback (no multi-session)
    if (isProcessing.value) return;
    messages.value = [];
    visibleLimit.value = 50;
    streaming.setMessageIdCounter(0);
    streaming.setStreamingMessageId(null);
    streaming.reset();
    currentClaudeSessionId.value = null;
    needsResume.value = false;

    // Tell the agent to clear its lastClaudeSessionId so the next message
    // starts a fresh session instead of auto-resuming the previous one.
    wsSend({ type: 'new_conversation' });

    messages.value.push({
      id: streaming.nextId(), role: 'system',
      content: 'New conversation started.',
      timestamp: new Date(),
    });
  }

  function toggleSidebar() {
    sidebarOpen.value = !sidebarOpen.value;
  }

  // ── Delete session ──

  const { showConfirm } = useConfirmDialog();

  function deleteSession(session) {
    if (currentClaudeSessionId.value === session.sessionId) return; // guard: foreground
    // Guard: check background conversations that are actively processing
    if (conversationCache) {
      for (const [, cached] of Object.entries(conversationCache.value)) {
        if (cached.claudeSessionId === session.sessionId && cached.isProcessing) return;
      }
    }
    const title = session.title || session.sessionId.slice(0, 8);
    showConfirm({
      title: t('dialog.deleteSession'),
      message: t('dialog.deleteSessionConfirm'),
      itemName: title,
      warning: t('dialog.cannotUndo'),
      confirmText: t('dialog.delete'),
      onConfirm: () => {
        wsSend({ type: 'delete_session', sessionId: session.sessionId });
      },
    });
  }

  // ── Rename session ──

  const renamingSessionId = deps.renamingSessionId;
  const renameText = deps.renameText;

  function startRename(session) {
    renamingSessionId.value = session.sessionId;
    renameText.value = session.title || '';
  }

  function confirmRename() {
    const sid = renamingSessionId.value;
    const title = renameText.value.trim();
    if (!sid || !title) {
      cancelRename();
      return;
    }
    wsSend({ type: 'rename_session', sessionId: sid, newTitle: title });
    renamingSessionId.value = null;
    renameText.value = '';
  }

  function cancelRename() {
    renamingSessionId.value = null;
    renameText.value = '';
  }

  // ── Folder picker ──

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
    setWorkdirSwitching();
    wsSend({ type: 'change_workdir', workDir: path });
  }

  // ── Working directory history ──

  const WORKDIR_HISTORY_MAX = 10;

  function getWorkdirHistoryKey() {
    return `agentlink-workdir-history-${hostname.value}`;
  }

  function loadWorkdirHistory() {
    try {
      const stored = localStorage.getItem(getWorkdirHistoryKey());
      workdirHistory.value = stored ? JSON.parse(stored) : [];
    } catch {
      workdirHistory.value = [];
    }
  }

  function saveWorkdirHistory() {
    localStorage.setItem(getWorkdirHistoryKey(), JSON.stringify(workdirHistory.value));
  }

  function addToWorkdirHistory(path) {
    if (!path) return;
    const filtered = workdirHistory.value.filter(p => p !== path);
    filtered.unshift(path);
    workdirHistory.value = filtered.slice(0, WORKDIR_HISTORY_MAX);
    saveWorkdirHistory();
  }

  function removeFromWorkdirHistory(path) {
    workdirHistory.value = workdirHistory.value.filter(p => p !== path);
    saveWorkdirHistory();
  }

  function switchToWorkdir(path) {
    setWorkdirSwitching();
    wsSend({ type: 'change_workdir', workDir: path });
  }

  const filteredWorkdirHistory = computed(() => {
    return workdirHistory.value.filter(p => p !== workDir.value);
  });

  // ── isSessionProcessing ──
  // Used by sidebar template to show processing indicator on session items.
  // IMPORTANT: All reactive deps are read up-front (no short-circuit) so that
  // Vue's dependency tracker always registers them during render, ensuring
  // the component re-renders when any of these values change.
  function isSessionProcessing(claudeSessionId) {
    // Read all reactive dependencies eagerly so Vue always tracks them
    const activeSet = activeClaudeSessions && activeClaudeSessions.value;
    const curSessionId = currentClaudeSessionId.value;
    const processing = isProcessing.value;
    const cache = conversationCache ? conversationCache.value : null;

    if (!claudeSessionId) return false;

    // Check 1: activeClaudeSessions (set by active_conversations response on connect/reconnect)
    if (activeSet instanceof Set && activeSet.has(claudeSessionId)) {
      return true;
    }
    // Check 2: cached background conversations
    if (cache) {
      for (const [convId, cached] of Object.entries(cache)) {
        if (cached.claudeSessionId === claudeSessionId && cached.isProcessing) {
          return true;
        }
      }
    }
    // Check 3: current foreground conversation
    if (curSessionId === claudeSessionId && processing) {
      return true;
    }
    return false;
  }

  // ── Grouped sessions ──

  const groupedSessions = computed(() => {
    if (!historySessions.value.length) return [];
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 86400000;
    const weekStart = todayStart - 6 * 86400000;

    const GROUP_KEYS = {
      today: 'session.today',
      yesterday: 'session.yesterday',
      thisWeek: 'session.thisWeek',
      earlier: 'session.earlier',
    };

    const groups = {};
    for (const s of historySessions.value) {
      if (s.recapId) continue;
      let key;
      if (s.lastModified >= todayStart) key = 'today';
      else if (s.lastModified >= yesterdayStart) key = 'yesterday';
      else if (s.lastModified >= weekStart) key = 'thisWeek';
      else key = 'earlier';
      if (!groups[key]) groups[key] = [];
      groups[key].push(s);
    }
    const order = ['today', 'yesterday', 'thisWeek', 'earlier'];
    return order.filter(k => groups[k]).map(k => ({ label: t(GROUP_KEYS[k]), sessions: groups[k] }));
  });

  // ── Workdir menu actions ──

  function toggleWorkdirMenu() {
    workdirMenuOpen.value = !workdirMenuOpen.value;
  }

  function workdirMenuBrowse() {
    workdirMenuOpen.value = false;
    if (isMobile.value) { sidebarView.value = 'files'; _fileBrowser.openPanel(); }
    else { memoryPanelOpen.value = false; gitPanelOpen.value = false; _fileBrowser.togglePanel(); }
  }

  function workdirMenuChangeDir() {
    workdirMenuOpen.value = false;
    openFolderPicker();
  }

  function workdirMenuCopyPath() {
    workdirMenuOpen.value = false;
    _fileBrowser.copyToClipboard(deps.workDir.value);
  }

  function workdirMenuGit() {
    workdirMenuOpen.value = false;
    if (_git) _git.openPanel();
  }

  // ── Sidebar resize handle (mouse + touch) ──

  let _resizing = false;
  let _startX = 0;
  let _startWidth = 0;
  const MIN_WIDTH = 220;
  const MAX_WIDTH = 480;

  function onSidebarResizeStart(e) {
    e.preventDefault();
    _resizing = true;
    _startX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
    _startWidth = sidebarWidth.value;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    if (e.type === 'touchstart') {
      document.addEventListener('touchmove', onSidebarResizeMove, { passive: false });
      document.addEventListener('touchend', onSidebarResizeEnd);
    } else {
      document.addEventListener('mousemove', onSidebarResizeMove);
      document.addEventListener('mouseup', onSidebarResizeEnd);
    }
  }

  function onSidebarResizeMove(e) {
    if (!_resizing) return;
    if (e.type === 'touchmove') e.preventDefault();
    const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
    const delta = clientX - _startX;
    const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, _startWidth + delta));
    sidebarWidth.value = newWidth;
  }

  function onSidebarResizeEnd() {
    if (!_resizing) return;
    _resizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onSidebarResizeMove);
    document.removeEventListener('mouseup', onSidebarResizeEnd);
    document.removeEventListener('touchmove', onSidebarResizeMove);
    document.removeEventListener('touchend', onSidebarResizeEnd);
    localStorage.setItem('agentlink-sidebar-width', String(sidebarWidth.value));
  }

  // ── Global recent sessions ──

  let _globalSessionsLoaded = false;

  function requestGlobalSessions() {
    if (requireVersion && !requireVersion('0.1.127', 'Global Sessions')) return;
    if (_globalSessionsLoaded && globalRecentSessions.value.length > 0) return;
    loadingGlobalSessions.value = true;
    wsSend({ type: 'list_recent_sessions', limit: 20 });
    _globalSessionsLoaded = true;
  }

  function refreshGlobalSessions() {
    loadingGlobalSessions.value = true;
    wsSend({ type: 'list_recent_sessions', limit: 20 });
  }

  function resumeGlobalSession(session) {
    if (requireVersion && !requireVersion('0.1.127', 'Global Sessions')) return;
    if (window.innerWidth <= 768) sidebarOpen.value = false;
    if (_onSwitchToChat) _onSwitchToChat();

    const currentDir = (workDir.value || '').replace(/[/\\]+$/, '');
    const sessionDir = (session.projectPath || '').replace(/[/\\]+$/, '');
    const sameWorkDir = currentDir.toLowerCase() === sessionDir.toLowerCase();

    if (sameWorkDir) {
      // Same workDir — resume directly (reuse resumeSession logic)
      resumeSession({ sessionId: session.sessionId, title: session.title });
    } else {
      // Different workDir — change first, then resume after workdir_changed
      setWorkdirSwitching();
      wsSend({ type: 'change_workdir', workDir: session.projectPath });
      // Wait for workdir_changed, then send resume
      _pendingGlobalResume = session.sessionId;
    }
  }

  // Pending cross-workDir resume: called by onWorkdirChanged (exposed via return)
  let _pendingGlobalResume = null;

  function onWorkdirChanged() {
    workdirSwitching.value = false;
    clearTimeout(_workdirSwitchTimer);
    if (_pendingGlobalResume) {
      const sid = _pendingGlobalResume;
      _pendingGlobalResume = null;
      // After workDir switch, resume the session
      resumeSession({ sessionId: sid });
      return true; // signal: skip default new-conversation logic
    }
    return false;
  }

  return {
    requestSessionList, resumeSession, newConversation, toggleSidebar,
    onSidebarResizeStart,
    setOnSwitchToChat, setFileBrowser, setGit,
    deleteSession,
    startRename, confirmRename, cancelRename,
    openFolderPicker, folderPickerNavigateUp, folderPickerSelectItem,
    folderPickerEnter, folderPickerGoToPath, confirmFolderPicker,
    groupedSessions, isSessionProcessing,
    loadWorkdirHistory, addToWorkdirHistory, removeFromWorkdirHistory,
    switchToWorkdir, filteredWorkdirHistory, workdirCollapsed,
    toggleWorkdirMenu, workdirMenuBrowse, workdirMenuChangeDir, workdirMenuCopyPath, workdirMenuGit,
    requestGlobalSessions, refreshGlobalSessions, resumeGlobalSession, onWorkdirChanged,
  };
}
