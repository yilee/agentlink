// ── Search module — Unified Brain Search ────────────────────────────────────
import { ref } from 'vue';

/**
 * Creates the search module for unified Brain search.
 * @param {object} deps - { wsSend }
 */
export function createSearch({ wsSend }) {
  const searchQuery = ref('');
  const searchResults = ref([]);   // SearchResultGroup[]
  const totalResults = ref(0);
  const searching = ref(false);
  const indexStats = ref([]);      // Array<{ name, count, generated }>
  const searchError = ref('');

  let debounceTimer = null;

  function performSearch(query, sources, limit) {
    const q = (query || '').trim();
    searchQuery.value = q;
    if (!q) {
      searchResults.value = [];
      totalResults.value = 0;
      searching.value = false;
      searchError.value = '';
      return;
    }
    searching.value = true;
    searchError.value = '';
    wsSend({ type: 'brain_search', query: q, sources, limit });
  }

  function performSearchDebounced(query, sources, limit, delay = 300) {
    if (debounceTimer) clearTimeout(debounceTimer);
    const q = (query || '').trim();
    searchQuery.value = q;
    if (!q) {
      searchResults.value = [];
      totalResults.value = 0;
      searching.value = false;
      searchError.value = '';
      return;
    }
    searching.value = true;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      wsSend({ type: 'brain_search', query: q, sources, limit });
    }, delay);
  }

  function handleSearchResults(msg) {
    // Only apply if result matches current query
    if (msg.query !== searchQuery.value) return;
    searching.value = false;
    if (msg.error) {
      searchError.value = msg.error;
      searchResults.value = [];
      totalResults.value = 0;
      return;
    }
    searchResults.value = msg.groups || [];
    totalResults.value = msg.totalResults || 0;
    searchError.value = '';
  }

  function handleSearchIndexStats(msg) {
    if (msg.error) {
      console.error('[Search] index stats error:', msg.error);
      return;
    }
    indexStats.value = msg.sources || [];
  }

  function loadIndexStats() {
    wsSend({ type: 'get_search_index_stats' });
  }

  function clearSearch() {
    searchQuery.value = '';
    searchResults.value = [];
    totalResults.value = 0;
    searching.value = false;
    searchError.value = '';
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  }

  return {
    searchQuery,
    searchResults,
    totalResults,
    searching,
    indexStats,
    searchError,
    performSearch,
    performSearchDebounced,
    handleSearchResults,
    handleSearchIndexStats,
    loadIndexStats,
    clearSearch,
  };
}
