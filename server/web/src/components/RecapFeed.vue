<script setup>
import { inject, onMounted, onUnmounted } from 'vue';
import RecapCard from './RecapCard.vue';

const store = inject('store');
const recap = inject('recap');

const { currentView } = store;
const { groupedEntries, loading, feedEntries } = recap;

function refresh() {
  recap.loadFeed();
}

function openCard(entry) {
  currentView.value = 'recap-detail';
  recap.selectRecap(entry.recap_id, entry.sidecar_path);
}

onMounted(() => {
  if (feedEntries.value.length === 0) {
    recap.loadFeed();
  }
  recap.startAutoRefresh();
});

onUnmounted(() => {
  recap.stopAutoRefresh();
});
</script>

<template>
  <div class="recap-feed" v-if="currentView === 'recap-feed'">
    <div class="recap-feed-header">
      <div class="recap-feed-title">
        <span class="recap-feed-title-icon">&#x1F4CB;</span>
        Meeting Recaps
      </div>
      <button class="recap-feed-refresh" @click="refresh" :disabled="loading" title="Refresh">
        <svg :class="{ spinning: loading }" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
      </button>
    </div>

    <div v-if="loading && feedEntries.length === 0" class="recap-feed-loading">
      <div class="recap-feed-spinner"></div>
      <span>Loading recaps...</span>
    </div>

    <div v-else-if="feedEntries.length === 0" class="recap-feed-empty">
      <div class="recap-feed-empty-icon">&#x1F4CB;</div>
      <p>No meeting recaps yet</p>
      <p class="muted">Recaps will appear here after Brain processes your meetings.</p>
    </div>

    <div v-else class="recap-feed-body">
      <div v-for="group in groupedEntries" :key="group.label" class="recap-feed-group">
        <div class="recap-feed-group-label">{{ group.label }}</div>
        <div class="recap-feed-grid">
          <RecapCard
            v-for="entry in group.entries"
            :key="entry.recap_id"
            :entry="entry"
            @click="openCard(entry)"
          />
        </div>
      </div>
    </div>
  </div>
</template>
