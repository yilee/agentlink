<script setup>
import { inject, computed } from 'vue';
import { renderMarkdown } from '../modules/markdown.js';

const store = inject('store');
const briefing = inject('briefing');

const { currentView } = store;
const { selectedDate, selectedContent, detailLoading } = briefing;

const formattedDate = computed(() => {
  if (!selectedDate.value) return '';
  try {
    const d = new Date(selectedDate.value + 'T12:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  } catch {
    return selectedDate.value;
  }
});

const renderedContent = computed(() => {
  if (!selectedContent.value) return '';
  return renderMarkdown(selectedContent.value);
});

function goBack() {
  briefing.goBackToFeed();
}
</script>

<template>
  <div class="briefing-detail" v-if="currentView === 'briefing-detail'">
    <div class="briefing-detail-header">
      <button class="briefing-detail-back" @click="goBack" title="Back to feed">
        <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
      </button>
      <div class="briefing-detail-title">
        <span class="briefing-detail-icon">&#x1F4CA;</span>
        <span>Daily Briefing &mdash; {{ formattedDate }}</span>
      </div>
    </div>

    <div v-if="detailLoading" class="briefing-detail-loading">
      <div class="briefing-detail-spinner"></div>
      <span>Loading briefing...</span>
    </div>

    <div v-else-if="!selectedContent" class="briefing-detail-empty">
      <p>Briefing content not available.</p>
    </div>

    <div v-else class="briefing-detail-body">
      <div class="briefing-detail-markdown markdown-body" v-html="renderedContent"></div>
    </div>
  </div>
</template>
