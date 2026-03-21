<script setup>
import { inject, computed } from 'vue';
import RecapForYou from './RecapForYou.vue';
import RecapHookSection from './RecapHookSection.vue';
import { getMeetingTypeBadge } from '../modules/recap.js';

const store = inject('store');
const recap = inject('recap');

const { currentView } = store;
const { selectedDetail, detailLoading, selectedRecapId, feedEntries } = recap;

const selectedEntry = computed(() =>
  feedEntries.value.find(e => e.recap_id === selectedRecapId.value)
);

const detail = computed(() => selectedDetail.value?.detail);
const meta = computed(() => selectedDetail.value?.meta);
const feed = computed(() => selectedDetail.value?.feed);

const typeBadgeLabel = computed(() => {
  if (feed.value?.type_badge) return feed.value.type_badge;
  if (selectedEntry.value) return getMeetingTypeBadge(selectedEntry.value.meeting_type).label;
  return '';
});

const formattedDate = computed(() => {
  const dateStr = meta.value?.occurred_at_local || selectedEntry.value?.date_local;
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
});

const duration = computed(() => meta.value?.duration || '');

const participants = computed(() => {
  const p = meta.value?.participants;
  if (!p || !Array.isArray(p)) return '';
  const names = p.map(n => typeof n === 'string' ? n.split(' ')[0] : n);
  if (names.length <= 6) return names.join(', ');
  return names.slice(0, 5).join(', ') + ` +${names.length - 5} more`;
});

const sharingLink = computed(() =>
  meta.value?.sharing_link || selectedEntry.value?.sharing_link
);

const hookSections = computed(() => detail.value?.hook_sections || []);

function goBack() {
  currentView.value = 'recap-feed';
  recap.goBackToFeed();
}
</script>

<template>
  <div class="recap-detail" v-if="currentView === 'recap-detail'">
    <div class="recap-detail-back" @click="goBack">
      <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
      Back
    </div>

    <div v-if="detailLoading" class="recap-detail-loading">
      <div class="recap-feed-spinner"></div>
      <span>Loading recap...</span>
    </div>

    <div v-else-if="!selectedDetail" class="recap-detail-error">
      Failed to load recap details.
    </div>

    <div v-else class="recap-detail-body">
      <!-- Header -->
      <div class="recap-detail-header">
        <div class="recap-detail-meeting-name">
          <span v-if="meta?.series_name" class="recap-detail-series">[{{ meta.series_name }}]</span>
          {{ meta?.meeting_name || selectedEntry?.meeting_name }}
        </div>
        <div class="recap-detail-meta-row">
          <span>{{ formattedDate }}</span>
          <span v-if="duration"> &middot; {{ duration }}</span>
          <span v-if="typeBadgeLabel"> &middot; {{ typeBadgeLabel }}</span>
        </div>
        <div v-if="meta?.project" class="recap-detail-project">{{ meta.project }}</div>
        <div v-if="participants" class="recap-detail-participants">{{ participants }}</div>
      </div>

      <!-- For You -->
      <RecapForYou v-if="detail?.for_you?.length" :items="detail.for_you" />

      <!-- TL;DR -->
      <div v-if="detail?.tldr" class="recap-detail-tldr">{{ detail.tldr }}</div>

      <!-- Hook Sections -->
      <RecapHookSection
        v-for="(section, i) in hookSections"
        :key="i"
        :title="section.title"
        :section-type="section.section_type"
        :items="section.items"
        :omitted-count="section.omitted_count || 0"
        :total-count="(section.items?.length || 0) + (section.omitted_count || 0)"
      />

      <!-- Sharing link -->
      <a v-if="sharingLink" class="recap-detail-link" :href="sharingLink" target="_blank" rel="noopener">
        <span>&#x1F4CE;</span> Read full recap &rarr;
      </a>
    </div>
  </div>
</template>
