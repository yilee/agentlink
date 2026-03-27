<script setup>
import { inject, onMounted, onUnmounted } from 'vue';
import BriefingCard from './BriefingCard.vue';

const store = inject('store');
const briefing = inject('briefing');

const { currentView } = store;
const { groupedEntries, loading, feedEntries } = briefing;

function refresh() {
  briefing.loadFeed();
}

function openCard(entry) {
  briefing.selectBriefing(entry.date);
}

onMounted(() => {
  if (feedEntries.value.length === 0) {
    briefing.loadFeed();
  }
  briefing.startAutoRefresh();
});

onUnmounted(() => {
  briefing.stopAutoRefresh();
});
</script>

<template>
  <div class="briefing-feed" v-if="currentView === 'briefing-feed'">
    <div class="briefing-feed-header">
      <div class="briefing-feed-title">
        <span class="briefing-feed-title-icon">&#x1F4CA;</span>
        Daily Briefings
      </div>
      <button class="briefing-feed-refresh" @click="refresh" :disabled="loading" title="Refresh">
        <svg :class="{ spinning: loading }" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
      </button>
    </div>

    <div v-if="loading && feedEntries.length === 0" class="briefing-feed-loading">
      <div class="briefing-feed-spinner"></div>
      <span>Loading briefings...</span>
    </div>

    <div v-else-if="feedEntries.length === 0" class="briefing-feed-empty">
      <div class="briefing-feed-empty-icon">&#x1F4CA;</div>
      <p>No daily briefings yet</p>
      <p class="muted">Briefings will appear here after Brain generates your daily reports.</p>
    </div>

    <div v-else class="briefing-feed-body">
      <div v-for="group in groupedEntries" :key="group.label" class="briefing-feed-group">
        <div class="briefing-feed-group-label">{{ group.label }}</div>
        <div class="briefing-feed-grid">
          <BriefingCard
            v-for="entry in group.entries"
            :key="entry.date"
            :entry="entry"
            @click="openCard(entry)"
          />
        </div>
      </div>
    </div>
  </div>
</template>
