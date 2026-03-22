import { ref, computed } from 'vue';

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
  const { meta, detail } = sidecarDetail;
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

  return lines.join('\n');
}

export function createRecap({ wsSend, switchConversation, conversationCache, messages,
                              isProcessing, currentConversationId,
                              currentClaudeSessionId, needsResume, loadingHistory }) {
  const feedEntries = ref([]);
  const selectedRecapId = ref(null);
  const selectedDetail = ref(null);
  const loading = ref(false);
  const detailLoading = ref(false);
  const detailExpanded = ref(true);

  // ── Recap Chat State ──
  const recapChatSessionMap = ref({});   // { [recapId]: claudeSessionId } — built from sessions_list
  const recapChatActive = ref(false);    // whether current view is in recap chat mode

  const groupedEntries = computed(() => groupByDate(feedEntries.value));

  let refreshInterval = null;
  let _previousConvId = null;   // saved conversation ID before entering recap chat

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

  /** Switch to recap chat conversation, saving current conversation ID.
   *  If a prior Claude session exists for this recap, resume it. */
  function enterRecapChat(recapId) {
    const convId = `recap-chat-${recapId}`;
    _previousConvId = currentConversationId.value;
    switchConversation(convId);
    recapChatActive.value = true;

    // Resume prior Claude session if one exists and conversation cache is empty
    const claudeSessionId = recapChatSessionMap.value[recapId];
    if (claudeSessionId) {
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
  }

  /** Exit recap chat, restoring previous conversation. */
  function exitRecapChat() {
    if (_previousConvId) {
      switchConversation(_previousConvId);
    }
    recapChatActive.value = false;
    _previousConvId = null;
  }

  /** Send a recap chat message. On first message, prepends meeting context. */
  function sendRecapChat(text, recapId, detail) {
    const convId = `recap-chat-${recapId}`;
    const cached = conversationCache.value[convId];
    const isFirstMessage = !cached || !cached.messages || cached.messages.length === 0;
    // Also check live messages if already switched to this conversation
    const liveEmpty = currentConversationId.value === convId && messages.value.length === 0;

    let prompt = text;
    if (isFirstMessage || liveEmpty) {
      prompt = buildMeetingContext(detail) + '\n---\n' + text;
    }

    wsSend({
      type: 'chat',
      conversationId: convId,
      prompt,
      brainMode: true,
      recapId,
    });
  }

  /** Build recapChatSessionMap from sessions_list data (sessions with recapId). */
  function updateRecapChatSessions(sessions) {
    const map = {};
    for (const s of sessions) {
      if (s.recapId) {
        map[s.recapId] = s.sessionId;
      }
    }
    recapChatSessionMap.value = map;
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

  return {
    feedEntries, selectedRecapId, selectedDetail, loading, detailLoading,
    groupedEntries, detailExpanded,
    loadFeed, selectRecap, goBackToFeed,
    startAutoRefresh, stopAutoRefresh,
    handleRecapsList, handleRecapDetail,
    // Recap chat
    recapChatActive, recapChatSessionMap,
    enterRecapChat, exitRecapChat, sendRecapChat,
    updateRecapChatSessions,
  };
}
