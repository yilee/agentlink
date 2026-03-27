// ── Briefing module — daily briefing feed, detail, and chat ───────────────────
import { ref, computed, nextTick } from 'vue';
import { getDateGroup } from './recap.js';
import { useConfirmDialog } from '../composables/useConfirmDialog.js';

function groupBriefingsByDate(entries) {
  const order = ['Today', 'Yesterday', 'This Week', 'Last Week', 'Older'];
  const groups = {};
  for (const entry of entries) {
    // Briefing date is "YYYY-MM-DD" — append T12:00 to avoid timezone edge cases
    const group = getDateGroup(entry.date + 'T12:00:00');
    if (!groups[group]) groups[group] = [];
    groups[group].push(entry);
  }
  return order.filter(g => groups[g]).map(g => ({ label: g, entries: groups[g] }));
}

/**
 * Build briefing context string for injecting into first chat message.
 * Pure function — easily testable.
 */
export function buildBriefingContext(content, date) {
  if (!content) return '';
  let ctx = '[Briefing Context — You are answering questions about this daily briefing]\n\n'
    + content + '\n';
  if (date) {
    ctx += '\n## Source Files (relative to working directory ~/BrainData/)\n'
      + `- Daily briefing: reports/daily/${date}.md\n\n`
      + 'You can Read this file for the full daily briefing content if needed.\n';
  }
  ctx += '\n---\n';
  return ctx;
}

/**
 * Creates the briefing state module.
 * @param {object} deps - { wsSend, currentView, switchConversation, conversationCache,
 *   messages, currentConversationId, currentClaudeSessionId, needsResume, loadingHistory,
 *   setBrainMode, scrollToBottom, historySessions, loadingSessions }
 */
export function createBriefing({ wsSend, currentView, switchConversation, conversationCache,
                                 messages, currentConversationId, currentClaudeSessionId,
                                 needsResume, loadingHistory, setBrainMode, scrollToBottom,
                                 historySessions, loadingSessions }) {
  const feedEntries = ref([]);
  const selectedDate = ref(null);
  const selectedContent = ref(null);
  const loading = ref(false);
  const detailLoading = ref(false);
  const detailExpanded = ref(false);
  const detailHeight = ref(parseInt(localStorage.getItem('agentlink-briefing-detail-height')) || 0);

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
    const contentEl = containerEl.querySelector('.briefing-detail-content');
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
      localStorage.setItem('agentlink-briefing-detail-height', String(detailHeight.value));
    }
  }

  // ── Briefing Chat State ──
  const briefingChatActive = ref(false);
  const activeBriefingSessionId = ref(null);
  const collapsedGroups = ref({});

  const groupedEntries = computed(() => groupBriefingsByDate(feedEntries.value));

  let autoRefreshTimer = null;
  const AUTO_REFRESH_MS = 30 * 60 * 1000;
  let _previousConvId = null;
  let _pendingBriefingTitle = null;
  let _requestSessionList = null;

  // ── Feed ──

  function loadFeed() {
    loading.value = true;
    wsSend({ type: 'list_briefings' });
  }

  function handleBriefingsList(msg) {
    feedEntries.value = msg.briefings || [];
    loading.value = false;
  }

  // ── Detail ──

  function selectBriefing(date) {
    selectedDate.value = date;
    selectedContent.value = null;
    detailLoading.value = true;
    detailExpanded.value = true;
    currentView.value = 'briefing-detail';
    wsSend({ type: 'get_briefing_detail', date });
  }

  function handleBriefingDetail(msg) {
    if (msg.date === selectedDate.value) {
      selectedContent.value = msg.content || null;
    }
    detailLoading.value = false;
  }

  function goBackToFeed() {
    if (briefingChatActive.value) {
      exitBriefingChat();
    }
    selectedDate.value = null;
    selectedContent.value = null;
    detailLoading.value = false;
    currentView.value = 'briefing-feed';
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

  // ── Briefing Chat Functions ──

  function enterBriefingChat(date) {
    const convId = `briefing-chat-${date}`;
    _previousConvId = currentConversationId.value;
    if (conversationCache.value[convId]) {
      delete conversationCache.value[convId];
    }
    switchConversation(convId);
    briefingChatActive.value = true;
    activeBriefingSessionId.value = null;
    setBrainMode(true);
    currentClaudeSessionId.value = null;
    nextTick(() => nextTick(() => scrollToBottom(true)));
  }

  function enterBriefingChatSession(date, claudeSessionId) {
    const convId = `briefing-chat-${claudeSessionId}`;
    _previousConvId = currentConversationId.value;
    switchConversation(convId);
    briefingChatActive.value = true;
    activeBriefingSessionId.value = claudeSessionId;
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

  function exitBriefingChat() {
    if (_previousConvId) {
      switchConversation(_previousConvId);
    }
    briefingChatActive.value = false;
    activeBriefingSessionId.value = null;
    _previousConvId = null;
  }

  function sendBriefingChat(text, date, content) {
    let prompt = text;
    if (!currentClaudeSessionId.value) {
      const ctx = buildBriefingContext(content, date);
      prompt = ctx + text;
      _pendingBriefingTitle = text.trim().substring(0, 100);
    }

    wsSend({
      type: 'chat',
      conversationId: currentConversationId.value,
      prompt,
      brainMode: true,
      briefingDate: date,
    });
  }

  function resetBriefingChat(date) {
    const prevConvId = currentConversationId.value;
    const claudeSessionId = currentClaudeSessionId.value;

    if (prevConvId && conversationCache.value[prevConvId]) {
      delete conversationCache.value[prevConvId];
    }

    if (claudeSessionId) {
      wsSend({ type: 'delete_session', sessionId: claudeSessionId });
    }

    const newConvId = `briefing-chat-${date}`;
    if (conversationCache.value[newConvId]) {
      delete conversationCache.value[newConvId];
    }
    switchConversation(newConvId);
    activeBriefingSessionId.value = null;
    currentClaudeSessionId.value = null;
    needsResume.value = false;
    messages.value.length = 0;
  }

  /** Check if current conversation is a briefing chat. */
  function isBriefingChat() {
    return briefingChatActive.value;
  }

  // ── Feed Sidebar Chat History ──

  const renamingChatSessionId = ref(null);
  const renameChatText = ref('');

  const { showConfirm } = useConfirmDialog();

  const briefingChatSessions = computed(() => {
    const sessions = historySessions ? historySessions.value : [];
    const entries = feedEntries.value;
    const feedMap = {};
    for (const entry of entries) {
      feedMap[entry.date] = entry;
    }
    return sessions
      .filter(s => s.briefingDate)
      .map(s => {
        const feedEntry = feedMap[s.briefingDate];
        return {
          ...s,
          displayTitle: s.customTitle || feedEntry?.title || `Briefing ${s.briefingDate}`,
          briefingDate: s.briefingDate,
        };
      })
      .sort((a, b) => b.lastModified - a.lastModified);
  });

  const _refreshing = ref(false);
  const briefingChatLoading = computed(() => loading.value || loadingSessions.value || _refreshing.value);

  const groupedBriefingChatSessions = computed(() => {
    const sessions = briefingChatSessions.value;
    if (!sessions.length) return [];
    const groupMap = {};
    for (const s of sessions) {
      if (!groupMap[s.briefingDate]) {
        const entry = feedEntries.value.find(e => e.date === s.briefingDate);
        groupMap[s.briefingDate] = {
          briefingDate: s.briefingDate,
          briefingTitle: entry?.title || `Briefing ${s.briefingDate}`,
          sessions: [],
        };
      }
      groupMap[s.briefingDate].sessions.push(s);
    }
    const groups = Object.values(groupMap);
    groups.sort((a, b) => b.sessions[0].lastModified - a.sessions[0].lastModified);
    return groups;
  });

  function refreshBriefingChats() {
    _refreshing.value = true;
    loadFeed();
    if (_requestSessionList) _requestSessionList();
    setTimeout(() => { _refreshing.value = false; }, 500);
  }

  function setRequestSessionList(fn) { _requestSessionList = fn; }

  function navigateToBriefingChat(session) {
    if (!session.briefingDate) return;
    if (briefingChatActive.value) {
      exitBriefingChat();
    }
    selectBriefing(session.briefingDate);
    if (currentView) currentView.value = 'briefing-detail';
    enterBriefingChatSession(session.briefingDate, session.sessionId);
  }

  function deleteBriefingChatSession(session) {
    const convIdByDate = `briefing-chat-${session.briefingDate}`;
    const convIdBySession = `briefing-chat-${session.sessionId}`;
    const cached1 = conversationCache.value[convIdByDate];
    const cached2 = conversationCache.value[convIdBySession];
    if ((cached1 && cached1.isProcessing) || (cached2 && cached2.isProcessing)) return;

    showConfirm({
      title: 'Delete Chat History',
      message: 'Delete chat history for this briefing?',
      itemName: session.displayTitle,
      warning: 'Chat history will be permanently deleted.',
      confirmText: 'Delete',
      onConfirm: () => {
        if (briefingChatActive.value && activeBriefingSessionId.value === session.sessionId) {
          goBackToFeed();
        }
        wsSend({ type: 'delete_session', sessionId: session.sessionId });
        if (conversationCache.value[convIdBySession]) {
          delete conversationCache.value[convIdBySession];
        }
      },
    });
  }

  function renameBriefingChatSession(sessionId, newTitle) {
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

  function handleBriefingSessionStarted(claudeSessionId) {
    if (!briefingChatActive.value) return;
    activeBriefingSessionId.value = claudeSessionId;

    if (_pendingBriefingTitle) {
      const title = _pendingBriefingTitle;
      _pendingBriefingTitle = null;
      wsSend({ type: 'rename_session', sessionId: claudeSessionId, newTitle: title });
    }
  }

  return {
    feedEntries, selectedDate, selectedContent, loading, detailLoading,
    groupedEntries, detailExpanded, detailHeight,
    loadFeed, selectBriefing, goBackToFeed,
    startAutoRefresh, stopAutoRefresh,
    handleBriefingsList, handleBriefingDetail, handleBriefingSessionStarted,
    onDetailResizeStart,
    // Briefing chat
    briefingChatActive, activeBriefingSessionId, isBriefingChat,
    enterBriefingChat, enterBriefingChatSession, exitBriefingChat,
    sendBriefingChat, resetBriefingChat,
    // Feed sidebar chat history
    briefingChatSessions, briefingChatLoading, groupedBriefingChatSessions,
    navigateToBriefingChat, refreshBriefingChats, setRequestSessionList,
    deleteBriefingChatSession, renameBriefingChatSession,
    startChatRename, cancelChatRename,
    renamingChatSessionId, renameChatText, collapsedGroups,
  };
}
