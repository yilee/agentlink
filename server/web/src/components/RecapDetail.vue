<script setup>
import { inject, computed, onMounted, onUnmounted } from 'vue';
import RecapForYou from './RecapForYou.vue';
import RecapHookSection from './RecapHookSection.vue';
import MessageList from './MessageList.vue';
import { getMeetingTypeBadge } from '../modules/recap.js';

const store = inject('store');
const recap = inject('recap');

const {
  currentView, messages, visibleMessages, hasMoreMessages,
  isProcessing, hasStreamingMessage, loadingHistory,
  onMessageListScroll, loadMoreMessages,
} = store;
const { selectedDetail, detailLoading, selectedRecapId, feedEntries, recapChatActive, detailExpanded } = recap;

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

function toggleDetail() {
  detailExpanded.value = !detailExpanded.value;
}

onMounted(() => {
  if (selectedRecapId.value) {
    recap.enterRecapChat(selectedRecapId.value);
  }
});

onUnmounted(() => {
  if (recapChatActive.value) {
    recap.exitRecapChat();
  }
});
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
      <!-- Collapsible detail section -->
      <div class="recap-detail-collapse-header" @click="toggleDetail">
        <span class="recap-detail-collapse-icon">{{ detailExpanded ? '\u25B2' : '\u25BC' }}</span>
        <span class="recap-detail-meeting-name-inline">
          <span v-if="meta?.series_name" class="recap-detail-series">[{{ meta.series_name }}]</span>
          {{ meta?.meeting_name || selectedEntry?.meeting_name }}
        </span>
        <span class="recap-detail-meta-inline">
          {{ formattedDate }}<span v-if="duration"> &middot; {{ duration }}</span><span v-if="typeBadgeLabel"> &middot; {{ typeBadgeLabel }}</span>
        </span>
      </div>

      <div v-if="detailExpanded" class="recap-detail-content">
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

      <!-- Chat divider -->
      <div class="recap-chat-divider">
        <span class="recap-chat-divider-line"></span>
        <span class="recap-chat-divider-label">Chat</span>
        <span class="recap-chat-divider-line"></span>
      </div>

      <!-- Chat area -->
      <div class="recap-chat-area">
        <MessageList
          :messages="messages"
          :visible-messages="visibleMessages"
          :has-more-messages="hasMoreMessages"
          :is-processing="isProcessing"
          :has-streaming-message="hasStreamingMessage"
          :loading-history="loadingHistory"
          :compact="true"
          @scroll="onMessageListScroll"
          @load-more="loadMoreMessages"
        >
          <template #empty>
            <div class="recap-chat-empty">
              <div class="recap-chat-empty-icon">&#x1F4AC;</div>
              <p>Ask anything about this meeting recap</p>
              <p class="muted">e.g. "What were the key decisions?" or "Summarize action items for me"</p>
            </div>
          </template>
        </MessageList>
      </div>
    </div>
  </div>
</template>
