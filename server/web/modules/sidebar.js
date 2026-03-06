// ── Sidebar: session management, folder picker, grouped sessions ─────────────
const { computed } = Vue;

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
 */
export function createSidebar(deps) {
  const {
    wsSend, messages, isProcessing, sidebarOpen,
    historySessions, currentClaudeSessionId, needsResume,
    loadingSessions, loadingHistory, workDir, visibleLimit,
    folderPickerOpen, folderPickerPath, folderPickerEntries,
    folderPickerLoading, folderPickerSelected, streaming,
    hostname, workdirHistory, workdirSwitching,
    // Multi-session parallel
    currentConversationId, conversationCache, processingConversations,
    switchConversation,
  } = deps;

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

    // Multi-session: just switch to a new blank conversation
    if (switchConversation) {
      const newConvId = crypto.randomUUID();
      switchConversation(newConvId);
      messages.value.push({
        id: streaming.nextId(), role: 'system',
        content: 'New conversation started.',
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

  /** Session pending delete confirmation (null = dialog closed) */
  let pendingDeleteSession = null;
  const deleteConfirmOpen = deps.deleteConfirmOpen;
  const deleteConfirmTitle = deps.deleteConfirmTitle;

  function deleteSession(session) {
    if (currentClaudeSessionId.value === session.sessionId) return; // guard: foreground
    // Guard: check background conversations that are actively processing
    if (conversationCache) {
      for (const [, cached] of Object.entries(conversationCache.value)) {
        if (cached.claudeSessionId === session.sessionId && cached.isProcessing) return;
      }
    }
    pendingDeleteSession = session;
    deleteConfirmTitle.value = session.title || session.sessionId.slice(0, 8);
    deleteConfirmOpen.value = true;
  }

  function confirmDeleteSession() {
    if (!pendingDeleteSession) return;
    wsSend({ type: 'delete_session', sessionId: pendingDeleteSession.sessionId });
    deleteConfirmOpen.value = false;
    pendingDeleteSession = null;
  }

  function cancelDeleteSession() {
    deleteConfirmOpen.value = false;
    pendingDeleteSession = null;
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
  // Used by sidebar template to show processing indicator on session items
  function isSessionProcessing(claudeSessionId) {
    if (!conversationCache || !processingConversations) return false;
    // Check cached background conversations
    for (const [convId, cached] of Object.entries(conversationCache.value)) {
      if (cached.claudeSessionId === claudeSessionId && cached.isProcessing) {
        return true;
      }
    }
    // Check current foreground conversation
    if (currentClaudeSessionId.value === claudeSessionId && isProcessing.value) {
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
    const order = ['Today', 'Yesterday', 'This week', 'Earlier'];
    return order.filter(k => groups[k]).map(k => ({ label: k, sessions: groups[k] }));
  });

  return {
    requestSessionList, resumeSession, newConversation, toggleSidebar,
    deleteSession, confirmDeleteSession, cancelDeleteSession,
    startRename, confirmRename, cancelRename,
    openFolderPicker, folderPickerNavigateUp, folderPickerSelectItem,
    folderPickerEnter, folderPickerGoToPath, confirmFolderPicker,
    groupedSessions, isSessionProcessing,
    loadWorkdirHistory, addToWorkdirHistory, removeFromWorkdirHistory,
    switchToWorkdir, filteredWorkdirHistory,
  };
}
