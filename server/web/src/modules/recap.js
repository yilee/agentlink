import { ref, computed, nextTick } from 'vue';
import { useConfirmDialog } from '../composables/useConfirmDialog.js';

const MEETING_TYPE_BADGES = {
  general_sync: { label: 'General Sync', color: 'blue' },
  strategy: { label: 'Strategy', color: 'purple' },
  strategy_architecture: { label: 'Strategy', color: 'purple' },
  standup: { label: 'Standup', color: 'green' },
  brainstorm: { label: 'Brainstorm', color: 'orange' },
  kickoff: { label: 'Kickoff', color: 'teal' },
  post_mortem: { label: 'Post-Mortem', color: 'red' },
};

export function getMeetingTypeBadge(meetingType) {
  return MEETING_TYPE_BADGES[meetingType] || { label: meetingType, color: 'gray' };
}

function isSameDay(d1, d2) {
  return d1.getFullYear() === d2.getFullYear()
    && d1.getMonth() === d2.getMonth()
    && d1.getDate() === d2.getDate();
}

function startOfWeekMonday(d) {
  const s = new Date(d);
  const day = s.getDay();
  // Monday = 1, Sunday = 0 → offset: (day + 6) % 7 gives days since Monday
  s.setDate(s.getDate() - ((day + 6) % 7));
  s.setHours(0, 0, 0, 0);
  return s;
}

export function getDateGroup(dateLocal) {
  const date = new Date(dateLocal);
  const now = new Date();
  if (isSameDay(date, now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return 'Yesterday';
  const thisWeekStart = startOfWeekMonday(now);
  if (date >= thisWeekStart) return 'This Week';
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  if (date >= lastWeekStart) return 'Last Week';
  return 'Older';
}

function groupByDate(entries) {
  const order = ['Today', 'Yesterday', 'This Week', 'Last Week', 'Older'];
  const groups = {};
  for (const entry of entries) {
    const group = getDateGroup(entry.date_local);
    if (!groups[group]) groups[group] = [];
    groups[group].push(entry);
  }
  return order.filter(g => groups[g]).map(g => ({ label: g, entries: groups[g] }));
}

const SECTION_ICONS = {
  decisions: '\u{1F4CB}',
  action_items: '\u{1F4CB}',
  blockers: '\u{1F534}',
  key_themes: '\u{1F4A1}',
  context: '\u{1F4A1}',
  vision: '\u{1F3AF}',
  root_cause: '\u{1F50D}',
  preventative_actions: '\u{1F6E1}\uFE0F',
};

export function getSectionIcon(sectionType) {
  return SECTION_ICONS[sectionType] || '\u{1F4CB}';
}

/**
 * Build meeting context string from recap detail for injecting into first chat message.
 * Pure function — easily testable.
 */
export function buildMeetingContext(sidecarDetail) {
  if (!sidecarDetail) return '';
  const { meta, detail, decisions, action_items, open_items } = sidecarDetail;
  const lines = [];

  lines.push('[Meeting Context — You are answering questions about this meeting recap]');
  lines.push('');
  lines.push(`Meeting: ${meta?.meeting_name || 'Unknown'}`);
  if (meta?.occurred_at_local) lines.push(`Date: ${meta.occurred_at_local}`);
  if (meta?.duration) lines.push(`Duration: ${meta.duration}`);
  if (meta?.meeting_type) lines.push(`Type: ${meta.meeting_type}`);
  if (meta?.project) lines.push(`Project: ${meta.project}`);
  if (meta?.participants?.length) {
    lines.push(`Participants: ${meta.participants.join(', ')}`);
  }

  if (detail?.tldr) {
    lines.push('');
    lines.push('## TL;DR');
    lines.push(detail.tldr);
  }

  if (detail?.for_you?.length) {
    lines.push('');
    lines.push('## Key Takeaways for You');
    for (const item of detail.for_you) {
      lines.push(`- ${item.text} (${item.reason})`);
    }
  }

  if (decisions?.length) {
    lines.push('');
    lines.push('## Decisions');
    for (const d of decisions) {
      lines.push(`- [${d.tag}] ${d.text}`);
    }
  }

  if (action_items?.length) {
    lines.push('');
    lines.push('## Action Items');
    for (const a of action_items) {
      const due = a.due ? ` — ${a.due}` : '';
      lines.push(`- [${a.owner}] ${a.action}${due}`);
    }
  }

  if (open_items?.length) {
    lines.push('');
    lines.push('## Open Items');
    for (const o of open_items) {
      const owner = o.owner ? ` (${o.owner})` : '';
      lines.push(`- ${o.text}${owner}`);
    }
  }

  if (detail?.hook_sections?.length) {
    for (const section of detail.hook_sections) {
      lines.push('');
      lines.push(`## ${section.title}`);
      for (const item of section.items) {
        lines.push(`- ${item.text}`);
      }
      if (section.omitted_count > 0) {
        lines.push(`  (${section.omitted_count} more items omitted)`);
      }
    }
  }

  // Source file paths so Claude can Read the full transcript or detailed recap on demand
  if (meta?.transcript_path || meta?.full_recap_path) {
    lines.push('');
    lines.push('## Source Files (relative to working directory ~/BrainData/)');
    if (meta.transcript_path) lines.push(`- Full transcript: ${meta.transcript_path}`);
    if (meta.full_recap_path) lines.push(`- Detailed recap: ${meta.full_recap_path}`);
    lines.push('');
    lines.push('You can Read these files for the full transcript or detailed recap if needed.');
  }

  return lines.join('\n');
}

export function createRecap({ wsSend, switchConversation, conversationCache, messages,
                              isProcessing, currentConversationId,
                              currentClaudeSessionId, needsResume, loadingHistory,
                              setBrainMode, scrollToBottom,
                              historySessions, loadingSessions, currentView }) {
  const feedEntries = ref([]);
  const selectedRecapId = ref(null);
  const selectedDetail = ref(null);
  const loading = ref(false);
  const detailLoading = ref(false);
  const detailExpanded = ref(false);

  // ── Recap Chat State ──
  const recapChatActive = ref(false);    // whether current view is in recap chat mode
  const activeRecapSessionId = ref(null); // claudeSessionId of the active recap chat (null = new chat)

  const groupedEntries = computed(() => groupByDate(feedEntries.value));

  let refreshInterval = null;
  let _previousConvId = null;   // saved conversation ID before entering recap chat
  let _pendingRecapTitle = null; // first question text to use as session title
  let _requestSessionList = null; // late-bound sidebar.requestSessionList

  function loadFeed() {
    loading.value = true;
    wsSend({ type: 'list_recaps' });
  }

  function selectRecap(recapId, sidecarPath) {
    selectedRecapId.value = recapId;
    detailLoading.value = true;
    detailExpanded.value = true;
    wsSend({ type: 'get_recap_detail', recapId, sidecarPath });
  }

  function goBackToFeed() {
    if (recapChatActive.value) {
      exitRecapChat();
    }
    selectedRecapId.value = null;
    selectedDetail.value = null;
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    refreshInterval = setInterval(() => {
      if (!loading.value) loadFeed();
    }, 5 * 60 * 1000);
  }

  function stopAutoRefresh() {
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
  }

  // ── Recap Chat Functions ──

  /**
   * Enter recap chat from card click — always starts a new session.
   * No history is loaded; the user sees an empty chat.
   */
  function enterRecapChat(recapId) {
    const convId = `recap-chat-${recapId}`;
    _previousConvId = currentConversationId.value;
    // Clear any cached messages for this recap's "new chat" slot so it's always fresh
    if (conversationCache.value[convId]) {
      delete conversationCache.value[convId];
    }
    switchConversation(convId);
    recapChatActive.value = true;
    activeRecapSessionId.value = null; // new chat, no session yet
    setBrainMode(true);  // Recap chat always uses brain mode
    currentClaudeSessionId.value = null; // ensure fresh session on first message

    // Always scroll to bottom when entering recap chat (override cached scrollTop)
    // Use double nextTick to run AFTER switchConversation's nextTick scroll restoration
    nextTick(() => nextTick(() => scrollToBottom(true)));
  }

  /**
   * Enter recap chat from sidebar click — resumes a specific Claude session.
   * Loads the session's chat history.
   */
  function enterRecapChatSession(recapId, claudeSessionId) {
    const convId = `recap-chat-${claudeSessionId}`;
    _previousConvId = currentConversationId.value;
    switchConversation(convId);
    recapChatActive.value = true;
    activeRecapSessionId.value = claudeSessionId;
    setBrainMode(true);

    nextTick(() => nextTick(() => scrollToBottom(true)));

    // Resume this specific session if conversation cache is empty
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

  /** Exit recap chat, restoring previous conversation. */
  function exitRecapChat() {
    if (_previousConvId) {
      switchConversation(_previousConvId);
    }
    recapChatActive.value = false;
    activeRecapSessionId.value = null;
    _previousConvId = null;
  }

  /** Send a recap chat message. On first message, prepends meeting context. */
  function sendRecapChat(text, recapId, detail) {
    const convId = currentConversationId.value;
    const cached = conversationCache.value[convId];
    const isFirstMessage = !cached || !cached.messages || cached.messages.length === 0;
    // Also check live messages if already switched to this conversation
    const liveEmpty = currentConversationId.value === convId && messages.value.length === 0;

    let prompt = text;
    if (isFirstMessage || liveEmpty) {
      const ctx = buildMeetingContext(detail);
      prompt = ctx + '\n---\n' + text;
      // Save user's actual question for auto-rename when session_started arrives
      _pendingRecapTitle = text.trim().substring(0, 100);
    }

    wsSend({
      type: 'chat',
      conversationId: convId,
      prompt,
      brainMode: true,
      recapId,
    });
  }

  /**
   * Reset recap chat — clears current conversation and switches to a fresh "new chat" slot.
   * If a Claude session was active, deletes it on the agent side.
   */
  function resetRecapChat(recapId) {
    const prevConvId = currentConversationId.value;
    const claudeSessionId = currentClaudeSessionId.value;

    // 1. Clear current conversation cache
    if (prevConvId && conversationCache.value[prevConvId]) {
      delete conversationCache.value[prevConvId];
    }

    // 2. Delete agent-side session if it exists
    if (claudeSessionId) {
      wsSend({ type: 'delete_session', sessionId: claudeSessionId });
    }

    // 3. Switch to fresh "new chat" slot for this recap
    const newConvId = `recap-chat-${recapId}`;
    if (conversationCache.value[newConvId]) {
      delete conversationCache.value[newConvId];
    }
    switchConversation(newConvId);
    activeRecapSessionId.value = null;
    currentClaudeSessionId.value = null;
    needsResume.value = false;
    messages.value.length = 0;
  }

  // ── Feed Sidebar Chat History ──

  const renamingChatSessionId = ref(null);
  const renameChatText = ref('');

  const { showConfirm } = useConfirmDialog();

  /** Computed list of recap chat sessions, cross-referencing historySessions with feedEntries. */
  const recapChatSessions = computed(() => {
    const sessions = historySessions ? historySessions.value : [];
    const entries = feedEntries.value;
    const feedMap = {};
    for (const entry of entries) {
      feedMap[entry.recap_id] = entry;
    }
    return sessions
      .filter(s => s.recapId)
      .map(s => {
        const feedEntry = feedMap[s.recapId];
        return {
          ...s,
          displayTitle: s.customTitle || feedEntry?.meeting_name || s.title,
          meetingDate: feedEntry?.date_local,
          meetingType: feedEntry?.meeting_type,
          sidecarPath: feedEntry?.sidecar_path,
        };
      })
      .sort((a, b) => b.lastModified - a.lastModified);
  });

  /** Loading state: true while sessions or feed data are being fetched. */
  const recapChatLoading = computed(() => {
    return (loadingSessions ? loadingSessions.value : false) || loading.value;
  });

  /** Sessions grouped by recap (meeting), each group sorted by lastModified desc. */
  const groupedRecapChatSessions = computed(() => {
    const sessions = recapChatSessions.value;
    if (!sessions.length) return [];
    // Build groups keyed by recapId, preserving meeting metadata
    const groupMap = {};
    for (const s of sessions) {
      if (!groupMap[s.recapId]) {
        const entry = feedEntries.value.find(e => e.recap_id === s.recapId);
        groupMap[s.recapId] = {
          recapId: s.recapId,
          meetingName: entry?.meeting_name || s.recapId,
          meetingDate: entry?.date_local,
          sessions: [],
        };
      }
      groupMap[s.recapId].sessions.push(s);
    }
    // Sort groups by most recent session in each group
    const groups = Object.values(groupMap);
    groups.sort((a, b) => b.sessions[0].lastModified - a.sessions[0].lastModified);
    return groups;
  });

  /** Refresh recap chat history by re-fetching both sessions list and feed entries. */
  function refreshRecapChats() {
    loadFeed();
    if (_requestSessionList) _requestSessionList();
  }

  function setRequestSessionList(fn) { _requestSessionList = fn; }
  function navigateToRecapChat(session) {
    if (!session.recapId || !session.sidecarPath) return;
    // If already in a recap chat, exit it first
    if (recapChatActive.value) {
      exitRecapChat();
    }
    // Load the recap detail
    selectRecap(session.recapId, session.sidecarPath);
    // Switch main view to recap-detail
    if (currentView) currentView.value = 'recap-detail';
    // Enter recap chat with specific session — resume its history
    enterRecapChatSession(session.recapId, session.sessionId);
  }

  /** Delete a recap chat session with confirmation dialog. */
  function deleteRecapChatSession(session) {
    // Guard: don't delete if currently processing
    const convIdByRecap = `recap-chat-${session.recapId}`;
    const convIdBySession = `recap-chat-${session.sessionId}`;
    const cached1 = conversationCache.value[convIdByRecap];
    const cached2 = conversationCache.value[convIdBySession];
    if ((cached1 && cached1.isProcessing) || (cached2 && cached2.isProcessing)) return;

    showConfirm({
      title: 'Delete Chat History',
      message: 'Delete chat history for this meeting?',
      itemName: session.displayTitle,
      warning: 'Chat history will be permanently deleted.',
      confirmText: 'Delete',
      onConfirm: () => {
        // If currently viewing this session, go back to feed
        if (recapChatActive.value && activeRecapSessionId.value === session.sessionId) {
          goBackToFeed();
          if (currentView) currentView.value = 'recap-feed';
        }
        // Delete agent-side session
        wsSend({ type: 'delete_session', sessionId: session.sessionId });
        // Clean up local caches
        if (conversationCache.value[convIdBySession]) {
          delete conversationCache.value[convIdBySession];
        }
      },
    });
  }

  /** Rename a recap chat session. */
  function renameRecapChatSession(sessionId, newTitle) {
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

  // --- Message handlers (called by recap-handler.js) ---
  function handleRecapsList(data) {
    feedEntries.value = data.recaps || [];
    loading.value = false;
  }

  function handleRecapDetail(data) {
    selectedDetail.value = data.detail;
    detailLoading.value = false;
  }

  /**
   * Called by session_started handler when a new Claude session is created.
   * Updates activeRecapSessionId and auto-renames the session with user's question.
   */
  function handleRecapSessionStarted(claudeSessionId) {
    if (!recapChatActive.value) return;
    // Track the new session so sidebar highlight works
    activeRecapSessionId.value = claudeSessionId;

    // Auto-rename with user's first question if available
    if (_pendingRecapTitle) {
      const title = _pendingRecapTitle;
      _pendingRecapTitle = null;
      wsSend({ type: 'rename_session', sessionId: claudeSessionId, newTitle: title });
    }
  }

  return {
    feedEntries, selectedRecapId, selectedDetail, loading, detailLoading,
    groupedEntries, detailExpanded,
    loadFeed, selectRecap, goBackToFeed,
    startAutoRefresh, stopAutoRefresh,
    handleRecapsList, handleRecapDetail, handleRecapSessionStarted,
    // Recap chat
    recapChatActive, activeRecapSessionId,
    enterRecapChat, enterRecapChatSession, exitRecapChat, sendRecapChat, resetRecapChat,
    // Feed sidebar chat history
    recapChatSessions, recapChatLoading, groupedRecapChatSessions,
    navigateToRecapChat, refreshRecapChats, setRequestSessionList,
    deleteRecapChatSession, renameRecapChatSession,
    startChatRename, cancelChatRename,
    renamingChatSessionId, renameChatText,
  };
}
