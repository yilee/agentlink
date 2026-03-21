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

function isSameWeek(d1, d2) {
  const startOfWeek = new Date(d2);
  startOfWeek.setDate(d2.getDate() - d2.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 7);
  return d1 >= startOfWeek && d1 < endOfWeek;
}

export function getDateGroup(dateLocal) {
  const date = new Date(dateLocal);
  const now = new Date();
  if (isSameDay(date, now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return 'Yesterday';
  if (isSameWeek(date, now)) return 'This Week';
  return 'Older';
}

function groupByDate(entries) {
  const order = ['Today', 'Yesterday', 'This Week', 'Older'];
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

export function createRecap({ wsSend }) {
  const feedEntries = ref([]);
  const selectedRecapId = ref(null);
  const selectedDetail = ref(null);
  const loading = ref(false);
  const detailLoading = ref(false);
  const chatMessages = ref([]);
  const detailExpanded = ref(true);

  const groupedEntries = computed(() => groupByDate(feedEntries.value));

  let refreshInterval = null;

  function loadFeed() {
    loading.value = true;
    wsSend({ type: 'list_recaps' });
  }

  function selectRecap(recapId, sidecarPath) {
    selectedRecapId.value = recapId;
    detailLoading.value = true;
    detailExpanded.value = true;
    chatMessages.value = [];
    wsSend({ type: 'get_recap_detail', recapId, sidecarPath });
  }

  function goBackToFeed() {
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
    groupedEntries, chatMessages, detailExpanded,
    loadFeed, selectRecap, goBackToFeed,
    startAutoRefresh, stopAutoRefresh,
    handleRecapsList, handleRecapDetail,
  };
}
