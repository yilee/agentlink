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
    hostname, workdirHistory,
  } = deps;

  // ── Session management ──

  function requestSessionList() {
    loadingSessions.value = true;
    wsSend({ type: 'list_sessions' });
  }

  function resumeSession(session) {
    if (isProcessing.value) return;
    if (window.innerWidth <= 768) sidebarOpen.value = false;
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
    if (isProcessing.value) return;
    if (window.innerWidth <= 768) sidebarOpen.value = false;
    messages.value = [];
    visibleLimit.value = 50;
    streaming.setMessageIdCounter(0);
    streaming.setStreamingMessageId(null);
    streaming.reset();
    currentClaudeSessionId.value = null;
    needsResume.value = false;

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
    if (isProcessing.value) return;
    if (currentClaudeSessionId.value === session.sessionId) return; // guard
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
    if (isProcessing.value) return;
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
    if (isProcessing.value) return;
    wsSend({ type: 'change_workdir', workDir: path });
  }

  const filteredWorkdirHistory = computed(() => {
    return workdirHistory.value.filter(p => p !== workDir.value);
  });

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
    groupedSessions,
    loadWorkdirHistory, addToWorkdirHistory, removeFromWorkdirHistory,
    switchToWorkdir, filteredWorkdirHistory,
  };
}
