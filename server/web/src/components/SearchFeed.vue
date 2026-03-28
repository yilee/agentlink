<script setup>
import { inject, onMounted, ref } from 'vue';

const store = inject('store');
const search = inject('search');

const { currentView, t } = store;
const { searchQuery, searchResults, totalResults, searching, indexStats, searchError } = search;

const inputRef = ref(null);

function onInput(e) {
  search.performSearchDebounced(e.target.value);
}

function clearSearch() {
  search.clearSearch();
  if (inputRef.value) inputRef.value.focus();
}

onMounted(() => {
  if (indexStats.value.length === 0) {
    search.loadIndexStats();
  }
});

// Source icons
const SOURCE_ICONS = {
  teams: '\u{1F4AC}',
  emails: '\u{1F4E7}',
  meetings: '\u{1F4C5}',
  pull_requests: '\u{1F517}',
  work_items: '\u{1F4CB}',
  documents: '\u{1F4C4}',
};

function sourceIcon(source) {
  return SOURCE_ICONS[source] || '\u{1F50D}';
}

function formatTimestamp(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const diff = now - d;
  if (diff < 86400000) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (diff < 7 * 86400000) {
    return d.toLocaleDateString([], { weekday: 'short' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
</script>

<template>
  <div class="search-feed" v-if="currentView === 'search-feed'">
    <div class="search-feed-header">
      <div class="search-feed-title">
        <span class="search-feed-title-icon">&#x1F50D;</span>
        {{ t('search.title') }}
      </div>
    </div>

    <!-- Search input -->
    <div class="search-input-wrapper">
      <svg class="search-input-icon" viewBox="0 0 24 24" width="16" height="16">
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
        {{ t('search.resultsCount', { n: totalResults }) }}
      </div>
      <div v-for="group in searchResults" :key="group.source" class="search-result-group">
        <div class="search-result-group-label">
          <span class="search-result-group-icon">{{ sourceIcon(group.source) }}</span>
          {{ group.label }}
          <span class="search-result-group-count">{{ group.count }}</span>
        </div>
        <div class="search-result-entries">
          <div v-for="entry in group.entries" :key="entry.id" class="search-result-entry">
            <div class="search-result-entry-header">
              <span class="search-result-entry-title">{{ entry.title }}</span>
              <span v-if="entry.timestamp" class="search-result-entry-time">{{ formatTimestamp(entry.timestamp) }}</span>
            </div>
            <div v-if="entry.subtitle" class="search-result-entry-subtitle">{{ entry.subtitle }}</div>
            <div v-if="entry.snippet" class="search-result-entry-snippet">{{ entry.snippet }}</div>
            <div v-if="entry.url" class="search-result-entry-url">
              <a :href="entry.url" target="_blank" rel="noopener">{{ entry.url }}</a>
            </div>
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
      <div class="search-feed-initial-icon">&#x1F50D;</div>
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
