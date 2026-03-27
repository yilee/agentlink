// ── DevOps module — DevOps Board feed, detail, and chat ───────────────────
import { ref, computed, nextTick } from 'vue';
import { useConfirmDialog } from '../composables/useConfirmDialog.js';

/**
 * Build devops context string for injecting into first chat message.
 * Pure function — easily testable.
 */
export function buildDevopsContext(description, mentions, entityType, entityId) {
  if (!description && !mentions) return '';
  const label = entityType === 'pr' ? `Pull Request #${entityId}` : `Work Item #${entityId}`;
  let ctx = `[DevOps Context — You are answering questions about this ${label}]\n\n`;
  if (description) ctx += description + '\n';
  if (mentions) ctx += '\n' + mentions + '\n';
  const subdir = entityType === 'pr' ? 'pull_requests/pr_' : 'work_items/wi_';
  ctx += '\n## Source Files (relative to working directory ~/BrainData/)\n'
    + `- Description: devops/${subdir}${entityId}/description.md\n`
    + `- Mentions: devops/${subdir}${entityId}/mentions.md\n\n`
    + 'You can Read these files for the full content if needed.\n';
  ctx += '\n---\n';
  return ctx;
}

/**
 * Group PRs by user role: My PRs, Reviewing, Other.
 */
function groupPrsByRole(prs, userName) {
  const groups = { 'My PRs': [], 'Reviewing': [], 'Other': [] };
  const lowerUser = (userName || '').toLowerCase();

  for (const pr of prs) {
    const isAuthor = pr.created_by && pr.created_by.toLowerCase().includes(lowerUser);
    const isReviewer = !isAuthor && pr.reviewers &&
      pr.reviewers.some(r => r.name.toLowerCase().includes(lowerUser));

    if (isAuthor) groups['My PRs'].push(pr);
    else if (isReviewer) groups['Reviewing'].push(pr);
    else groups['Other'].push(pr);
  }

  return ['My PRs', 'Reviewing', 'Other']
    .filter(g => groups[g].length > 0)
    .map(g => ({ label: g, count: groups[g].length, entries: groups[g] }));
}

/**
 * Group WIs by state. Active items first, then closed.
 */
function groupWisByState(wis) {
  const stateOrder = ['New', 'Active', 'Resolved', 'Closed'];
  const groups = {};

  for (const wi of wis) {
    const state = wi.state || 'New';
    if (!groups[state]) groups[state] = [];
    groups[state].push(wi);
  }

  return stateOrder
    .filter(s => groups[s])
    .map(s => ({ label: s, count: groups[s].length, entries: groups[s] }));
}

/**
 * Creates the devops state module.
 * @param {object} deps - { wsSend, currentView, switchConversation, conversationCache,
 *   messages, currentConversationId, currentClaudeSessionId, needsResume, loadingHistory,
 *   setBrainMode, scrollToBottom, historySessions, loadingSessions }
 */
export function createDevops({ wsSend, currentView, switchConversation, conversationCache,
                               messages, currentConversationId, currentClaudeSessionId,
                               needsResume, loadingHistory, setBrainMode, scrollToBottom,
                               historySessions, loadingSessions }) {
  // ── Feed State ──
  const prEntries = ref([]);
  const wiEntries = ref([]);
  const userName = ref('');
  const activeTab = ref('pr'); // 'pr' | 'wi'
  const loading = ref(false);

  // ── Detail State ──
  const selectedEntityType = ref(null); // 'pr' | 'wi'
  const selectedEntityId = ref(null);
  const selectedDescription = ref(null);
  const selectedMentions = ref(null);
  const detailLoading = ref(false);
  const detailExpanded = ref(false);
  const detailHeight = ref(parseInt(localStorage.getItem('agentlink-devops-detail-height')) || 0);

  // ── Detail / Chat resize handle ──
  const MIN_DETAIL_HEIGHT = 60;
  const MAX_DETAIL_RATIO = 0.7;
  let _resizing = false;
  let _startY = 0;
  let _startHeight = 0;
  let _containerEl = null;

  function onDetailResizeStart(e, containerEl) {
    e.preventDefault();
    _resizing = true;
    _startY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
    const contentEl = containerEl.querySelector('.devops-detail-content');
    _startHeight = contentEl ? contentEl.offsetHeight : 200;
    _containerEl = containerEl;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    if (e.type === 'touchstart') {
      document.addEventListener('touchmove', onDetailResizeMove, { passive: false });
      document.addEventListener('touchend', onDetailResizeEnd);
    } else {
      document.addEventListener('mousemove', onDetailResizeMove);
      document.addEventListener('mouseup', onDetailResizeEnd);
    }
  }

  function onDetailResizeMove(e) {
    if (!_resizing || !_containerEl) return;
    if (e.type === 'touchmove') e.preventDefault();
    const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
    const delta = clientY - _startY;
    const maxHeight = _containerEl.offsetHeight * MAX_DETAIL_RATIO;
    const newHeight = Math.max(MIN_DETAIL_HEIGHT, Math.min(maxHeight, _startHeight + delta));
    detailHeight.value = Math.round(newHeight);
  }

  function onDetailResizeEnd() {
    if (!_resizing) return;
    _resizing = false;
    _containerEl = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onDetailResizeMove);
    document.removeEventListener('mouseup', onDetailResizeEnd);
    document.removeEventListener('touchmove', onDetailResizeMove);
    document.removeEventListener('touchend', onDetailResizeEnd);
    if (detailHeight.value > 0) {
      localStorage.setItem('agentlink-devops-detail-height', String(detailHeight.value));
    }
  }

  // ── Chat State ──
  const devopsChatActive = ref(false);
  const activeDevopsSessionId = ref(null);
  const collapsedGroups = ref({});

  // ── Computed: grouped entries ──

  const groupedPrEntries = computed(() => groupPrsByRole(prEntries.value, userName.value));
  const groupedWiEntries = computed(() => groupWisByState(wiEntries.value));

  let autoRefreshTimer = null;
  const AUTO_REFRESH_MS = 30 * 60 * 1000;
  let _previousConvId = null;
  let _pendingDevopsTitle = null;
  let _requestSessionList = null;

  // ── Feed ──

  function loadFeed() {
    loading.value = true;
    wsSend({ type: 'list_devops' });
  }

  function handleDevopsList(msg) {
    prEntries.value = msg.pullRequests || [];
    wiEntries.value = msg.workItems || [];
    userName.value = msg.userName || '';
    loading.value = false;
  }

  // ── Detail ──

  /** Get the selected entity object from feed data. */
  const selectedEntity = computed(() => {
    if (!selectedEntityType.value || !selectedEntityId.value) return null;
    if (selectedEntityType.value === 'pr') {
      return prEntries.value.find(p => p.pr_number === selectedEntityId.value) || null;
    }
    return wiEntries.value.find(w => w.work_item_id === selectedEntityId.value) || null;
  });

  function selectEntity(entityType, entityId) {
    selectedEntityType.value = entityType;
    selectedEntityId.value = entityId;
    selectedDescription.value = null;
    selectedMentions.value = null;
    detailLoading.value = true;
    detailExpanded.value = true;
    currentView.value = 'devops-detail';
    wsSend({ type: 'get_devops_detail', entityType, entityId });
  }

  function handleDevopsDetail(msg) {
    if (msg.entityType === selectedEntityType.value && msg.entityId === selectedEntityId.value) {
      selectedDescription.value = msg.description || null;
      selectedMentions.value = msg.mentions || null;
    }
    detailLoading.value = false;
  }

  function goBackToFeed() {
    if (devopsChatActive.value) {
      exitDevopsChat();
    }
    selectedEntityType.value = null;
    selectedEntityId.value = null;
    selectedDescription.value = null;
    selectedMentions.value = null;
    detailLoading.value = false;
    currentView.value = 'devops-feed';
  }

  // ── Auto-refresh ──

  function startAutoRefresh() {
    stopAutoRefresh();
    autoRefreshTimer = setInterval(() => {
      if (!loading.value) loadFeed();
    }, AUTO_REFRESH_MS);
  }

  function stopAutoRefresh() {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  }

  // ── DevOps Chat Functions ──

  function enterDevopsChat(entityType, entityId) {
    const convId = `devops-chat-${entityType}-${entityId}`;
    _previousConvId = currentConversationId.value;
    if (conversationCache.value[convId]) {
      delete conversationCache.value[convId];
    }
    switchConversation(convId);
    devopsChatActive.value = true;
    activeDevopsSessionId.value = null;
    setBrainMode(true);
    currentClaudeSessionId.value = null;
    nextTick(() => nextTick(() => scrollToBottom(true)));
  }

  function enterDevopsChatSession(entityType, entityId, claudeSessionId) {
    const convId = `devops-chat-${claudeSessionId}`;
    _previousConvId = currentConversationId.value;
    switchConversation(convId);
    devopsChatActive.value = true;
    activeDevopsSessionId.value = claudeSessionId;
    setBrainMode(true);

    nextTick(() => nextTick(() => scrollToBottom(true)));

    const cached = conversationCache.value[convId];
    const hasHistory = (cached && cached.messages && cached.messages.length > 0)
                    || messages.value.length > 0;
    if (!hasHistory) {
      currentClaudeSessionId.value = claudeSessionId;
      needsResume.value = true;
      loadingHistory.value = true;
      wsSend({
        type: 'resume_conversation',
        conversationId: convId,
        claudeSessionId,
      });
    }
  }

  function exitDevopsChat() {
    if (_previousConvId) {
      switchConversation(_previousConvId);
    }
    devopsChatActive.value = false;
    activeDevopsSessionId.value = null;
    _previousConvId = null;
  }

  function sendDevopsChat(text, entityType, entityId, description, mentions) {
    let prompt = text;
    if (!currentClaudeSessionId.value) {
      const ctx = buildDevopsContext(description, mentions, entityType, entityId);
      prompt = ctx + text;
      _pendingDevopsTitle = text.trim().substring(0, 100);
    }

    wsSend({
      type: 'chat',
      conversationId: currentConversationId.value,
      prompt,
      brainMode: true,
      devopsEntityType: entityType,
      devopsEntityId: entityId,
    });
  }

  function resetDevopsChat(entityType, entityId) {
    const prevConvId = currentConversationId.value;
    const claudeSessionId = currentClaudeSessionId.value;

    if (prevConvId && conversationCache.value[prevConvId]) {
      delete conversationCache.value[prevConvId];
    }

    if (claudeSessionId) {
      wsSend({ type: 'delete_session', sessionId: claudeSessionId });
    }

    const newConvId = `devops-chat-${entityType}-${entityId}`;
    if (conversationCache.value[newConvId]) {
      delete conversationCache.value[newConvId];
    }
    switchConversation(newConvId);
    activeDevopsSessionId.value = null;
    currentClaudeSessionId.value = null;
    needsResume.value = false;
    messages.value.length = 0;
  }

  /** Check if current conversation is a devops chat. */
  function isDevopsChat() {
    return devopsChatActive.value;
  }

  // ── Feed Sidebar Chat History ──

  const renamingChatSessionId = ref(null);
  const renameChatText = ref('');

  const { showConfirm } = useConfirmDialog();

  const devopsChatSessions = computed(() => {
    const sessions = historySessions ? historySessions.value : [];
    return sessions
      .filter(s => s.devopsEntityType)
      .map(s => ({
        ...s,
        displayTitle: s.customTitle || `${s.devopsEntityType === 'pr' ? 'PR' : 'WI'} #${s.devopsEntityId}`,
      }))
      .sort((a, b) => b.lastModified - a.lastModified);
  });

  const _refreshing = ref(false);
  const devopsChatLoading = computed(() => loading.value || loadingSessions.value || _refreshing.value);

  const groupedDevopsChatSessions = computed(() => {
    const sessions = devopsChatSessions.value;
    if (!sessions.length) return [];
    const groupMap = {};
    for (const s of sessions) {
      const key = `${s.devopsEntityType}-${s.devopsEntityId}`;
      if (!groupMap[key]) {
        groupMap[key] = {
          entityType: s.devopsEntityType,
          entityId: s.devopsEntityId,
          label: `${s.devopsEntityType === 'pr' ? 'PR' : 'WI'} #${s.devopsEntityId}`,
          sessions: [],
        };
      }
      groupMap[key].sessions.push(s);
    }
    const groups = Object.values(groupMap);
    groups.sort((a, b) => b.sessions[0].lastModified - a.sessions[0].lastModified);
    return groups;
  });

  function refreshDevopsChats() {
    _refreshing.value = true;
    loadFeed();
    if (_requestSessionList) _requestSessionList();
    setTimeout(() => { _refreshing.value = false; }, 500);
  }

  function setRequestSessionList(fn) { _requestSessionList = fn; }

  function navigateToDevopsChat(session) {
    if (!session.devopsEntityType || !session.devopsEntityId) return;
    if (devopsChatActive.value) {
      exitDevopsChat();
    }
    selectEntity(session.devopsEntityType, session.devopsEntityId);
    if (currentView) currentView.value = 'devops-detail';
    enterDevopsChatSession(session.devopsEntityType, session.devopsEntityId, session.sessionId);
  }

  function deleteDevopsChatSession(session) {
    const convIdByEntity = `devops-chat-${session.devopsEntityType}-${session.devopsEntityId}`;
    const convIdBySession = `devops-chat-${session.sessionId}`;
    const cached1 = conversationCache.value[convIdByEntity];
    const cached2 = conversationCache.value[convIdBySession];
    if ((cached1 && cached1.isProcessing) || (cached2 && cached2.isProcessing)) return;

    showConfirm({
      title: 'Delete Chat History',
      message: 'Delete chat history for this DevOps item?',
      itemName: session.displayTitle,
      warning: 'Chat history will be permanently deleted.',
      confirmText: 'Delete',
      onConfirm: () => {
        if (devopsChatActive.value && activeDevopsSessionId.value === session.sessionId) {
          goBackToFeed();
        }
        wsSend({ type: 'delete_session', sessionId: session.sessionId });
        if (conversationCache.value[convIdBySession]) {
          delete conversationCache.value[convIdBySession];
        }
      },
    });
  }

  function renameDevopsChatSession(sessionId, newTitle) {
    if (!sessionId || !newTitle.trim()) {
      cancelChatRename();
      return;
    }
    wsSend({ type: 'rename_session', sessionId, newTitle: newTitle.trim() });
    renamingChatSessionId.value = null;
    renameChatText.value = '';
  }

  function startChatRename(session) {
    renamingChatSessionId.value = session.sessionId;
    renameChatText.value = session.displayTitle || '';
  }

  function cancelChatRename() {
    renamingChatSessionId.value = null;
    renameChatText.value = '';
  }

  function handleDevopsSessionStarted(claudeSessionId) {
    if (!devopsChatActive.value) return;
    activeDevopsSessionId.value = claudeSessionId;

    if (_pendingDevopsTitle) {
      const title = _pendingDevopsTitle;
      _pendingDevopsTitle = null;
      wsSend({ type: 'rename_session', sessionId: claudeSessionId, newTitle: title });
    }
  }

  return {
    // Feed
    prEntries, wiEntries, userName, activeTab, loading,
    groupedPrEntries, groupedWiEntries,
    loadFeed, handleDevopsList,
    startAutoRefresh, stopAutoRefresh,
    // Detail
    selectedEntityType, selectedEntityId, selectedEntity,
    selectedDescription, selectedMentions,
    detailLoading, detailExpanded, detailHeight,
    selectEntity, goBackToFeed, handleDevopsDetail,
    onDetailResizeStart,
    // DevOps chat
    devopsChatActive, activeDevopsSessionId, isDevopsChat,
    enterDevopsChat, enterDevopsChatSession, exitDevopsChat,
    sendDevopsChat, resetDevopsChat,
    handleDevopsSessionStarted,
    // Feed sidebar chat history
    devopsChatSessions, devopsChatLoading, groupedDevopsChatSessions,
    navigateToDevopsChat, refreshDevopsChats, setRequestSessionList,
    deleteDevopsChatSession, renameDevopsChatSession,
    startChatRename, cancelChatRename,
    renamingChatSessionId, renameChatText, collapsedGroups,
  };
}
