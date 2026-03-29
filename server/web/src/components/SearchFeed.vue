<script setup>
import { inject, onMounted, ref, computed } from 'vue';

const store = inject('store');
const search = inject('search');

const { currentView, t } = store;
const { searchQuery, searchResults, totalResults, searching, indexStats, searchError, selectedSource } = search;

const inputRef = ref(null);
const hasQuery = computed(() => !!searchQuery.value || searching.value);

function onInput(e) {
  search.performSearchDebounced(e.target.value);
}

function clearSearch() {
  search.clearSearch();
  if (inputRef.value) inputRef.value.focus();
}

function selectSource(source) {
  selectedSource.value = selectedSource.value === source ? '' : source;
}

onMounted(() => {
  if (indexStats.value.length === 0) {
    search.loadIndexStats();
  }
});

// Source icons & labels
const SOURCE_META = {
  teams: { icon: '\u{1F4AC}', label: 'Teams' },
  emails: { icon: '\u{1F4E7}', label: 'Email' },
  meetings: { icon: '\u{1F4C5}', label: 'Meetings' },
  meeting_recaps: { icon: '\u{1F4DD}', label: 'Recaps' },
  pull_requests: { icon: '\u{1F517}', label: 'PRs' },
  work_items: { icon: '\u{1F4CB}', label: 'Work Items' },
  documents: { icon: '\u{1F4C4}', label: 'Docs' },
};

function sourceIcon(source) {
  return SOURCE_META[source]?.icon || '\u{1F50D}';
}

function sourceLabel(source) {
  return SOURCE_META[source]?.label || source;
}

// Filtered results based on selected source tab
const filteredResults = computed(() => {
  if (!selectedSource.value) return searchResults.value;
  return searchResults.value.filter(g => g.source === selectedSource.value);
});

const filteredTotal = computed(() => {
  if (!selectedSource.value) return totalResults.value;
  return filteredResults.value.reduce((sum, g) => sum + (g.count || 0), 0);
});

// Source tabs with counts from current results
const sourceTabs = computed(() => {
  const counts = {};
  for (const g of searchResults.value) {
    counts[g.source] = g.count || g.entries?.length || 0;
  }
  return Object.entries(counts).map(([source, count]) => ({
    source,
    label: sourceLabel(source),
    icon: sourceIcon(source),
    count,
  }));
});

function isClickable(entry) {
  return entry.url || entry.source === 'meeting_recaps';
}

function openEntry(entry) {
  if (entry.source === 'meeting_recaps' && entry.extra?.recapId) {
    window.location.hash = `/recap/${entry.extra.recapId}`;
    return;
  }
  if (entry.url) window.open(entry.url, '_blank');
}

function formatTimestamp(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const diff = now - d;
  if (diff < 86400000) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  if (diff < 7 * 86400000) {
    return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
</script>

<template>
  <div class="search-feed" v-if="currentView === 'search-feed'">
    <!-- Top spacer: pushes content to ~center when no query, collapses when active -->
    <div class="search-feed-spacer" :class="{ collapsed: hasQuery }"></div>

    <div class="search-feed-header">
      <div class="search-feed-title">
        <span class="search-feed-title-icon">&#x1F50D;</span>
        {{ t('search.title') }}
      </div>
    </div>

    <!-- Search input -->
    <div class="search-input-wrapper">
      <svg class="search-input-icon" viewBox="0 0 24 24" width="18" height="18">
        <path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
      </svg>
      <input
        ref="inputRef"
        type="text"
        class="search-input"
        :placeholder="t('search.placeholder')"
        :value="searchQuery"
        @input="onInput"
        spellcheck="false"
        autocomplete="off"
      />
      <button v-if="searchQuery" class="search-input-clear" @click="clearSearch" :title="t('search.clear')">
        <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
      </button>
    </div>

    <!-- Source filter tabs (shown when results exist) -->
    <div v-if="searchQuery && sourceTabs.length > 1 && !searching && !searchError" class="search-source-tabs">
      <button
        class="search-source-tab"
        :class="{ active: !selectedSource }"
        @click="selectedSource = ''"
      >
        {{ t('search.allSources') }}
        <span class="search-source-tab-count">{{ totalResults }}</span>
      </button>
      <button
        v-for="tab in sourceTabs"
        :key="tab.source"
        class="search-source-tab"
        :class="{ active: selectedSource === tab.source }"
        @click="selectSource(tab.source)"
      >
        <span class="search-source-tab-icon">{{ tab.icon }}</span>
        {{ tab.label }}
        <span class="search-source-tab-count">{{ tab.count }}</span>
      </button>
    </div>

    <!-- Loading -->
    <div v-if="searching" class="search-feed-loading">
      <div class="search-feed-spinner"></div>
      <span>{{ t('search.searching') }}</span>
    </div>

    <!-- Error -->
    <div v-else-if="searchError" class="search-feed-empty">
      <div class="search-feed-empty-icon">&#x26A0;</div>
      <p>{{ searchError }}</p>
    </div>

    <!-- Results -->
    <div v-else-if="searchQuery && searchResults.length > 0" class="search-feed-body">
      <div class="search-results-summary">
        {{ t('search.resultsCount', { n: filteredTotal }) }}
      </div>
      <div v-for="group in filteredResults" :key="group.source" class="search-result-group">
        <div class="search-result-group-label">
          <span class="search-result-group-icon">{{ sourceIcon(group.source) }}</span>
          {{ group.label }}
          <span class="search-result-group-count">{{ group.count }}</span>
        </div>
        <div class="search-result-entries">
          <div v-for="entry in group.entries" :key="entry.id" class="search-result-entry" :class="{ clickable: isClickable(entry) }" @click="openEntry(entry)">
            <div class="search-result-entry-header">
              <span class="search-result-entry-title">{{ entry.title }}</span>
              <span v-if="entry.timestamp" class="search-result-entry-time">{{ formatTimestamp(entry.timestamp) }}</span>
            </div>
            <div v-if="entry.subtitle" class="search-result-entry-subtitle">{{ entry.subtitle }}</div>
            <div v-if="entry.snippet" class="search-result-entry-snippet">{{ entry.snippet }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- No results -->
    <div v-else-if="searchQuery && searchResults.length === 0 && !searching" class="search-feed-empty">
      <div class="search-feed-empty-icon">&#x1F50D;</div>
      <p>{{ t('search.noResults') }}</p>
      <p class="muted">{{ t('search.noResultsHint') }}</p>
    </div>

    <!-- Initial state (no query) -->
    <div v-else class="search-feed-initial">
      <p>{{ t('search.initialMessage') }}</p>
      <div v-if="indexStats.length > 0" class="search-index-stats">
        <div class="search-index-stats-label">{{ t('search.availableSources') }}</div>
        <div class="search-index-stats-grid">
          <div v-for="stat in indexStats" :key="stat.name" class="search-index-stat">
            <span class="search-index-stat-icon">{{ sourceIcon(stat.name) }}</span>
            <span class="search-index-stat-name">{{ stat.name }}</span>
            <span class="search-index-stat-count">{{ stat.count }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
