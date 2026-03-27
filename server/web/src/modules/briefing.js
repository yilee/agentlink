// ── Briefing module — daily briefing feed and detail ──────────────────────────
import { ref, computed } from 'vue';
import { getDateGroup } from './recap.js';

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
 * Creates the briefing state module.
 * @param {object} deps - { wsSend, currentView }
 */
export function createBriefing({ wsSend, currentView }) {
  const feedEntries = ref([]);
  const selectedDate = ref(null);
  const selectedContent = ref(null);
  const loading = ref(false);
  const detailLoading = ref(false);

  let autoRefreshTimer = null;
  const AUTO_REFRESH_MS = 30 * 60 * 1000; // 30 minutes

  const groupedEntries = computed(() => groupBriefingsByDate(feedEntries.value));

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
    selectedDate.value = null;
    selectedContent.value = null;
    detailLoading.value = false;
    currentView.value = 'briefing-feed';
  }

  // ── Auto-refresh ──

  function startAutoRefresh() {
    stopAutoRefresh();
    autoRefreshTimer = setInterval(() => {
      loadFeed();
    }, AUTO_REFRESH_MS);
  }

  function stopAutoRefresh() {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  }

  return {
    feedEntries,
    selectedDate,
    selectedContent,
    loading,
    detailLoading,
    groupedEntries,

    loadFeed,
    selectBriefing,
    goBackToFeed,
    startAutoRefresh,
    stopAutoRefresh,

    handleBriefingsList,
    handleBriefingDetail,
  };
}
