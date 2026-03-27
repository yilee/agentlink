<script setup>
import { inject, computed, onMounted, onUnmounted, ref } from 'vue';
import { renderMarkdown } from '../modules/markdown.js';
import MessageList from './MessageList.vue';

const store = inject('store');
const briefing = inject('briefing');

const {
  currentView, messages, visibleMessages, hasMoreMessages,
  isProcessing, hasStreamingMessage, loadingHistory,
  onMessageListScroll, loadMoreMessages,
} = store;
const {
  selectedDate, selectedContent, detailLoading,
  briefingChatActive, detailExpanded, detailHeight, onDetailResizeStart,
} = briefing;

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

const detailBodyRef = ref(null);

const detailContentStyle = computed(() => {
  if (detailHeight.value > 0) {
    return { height: detailHeight.value + 'px', maxHeight: 'none' };
  }
  return {};
});

function startResize(e) {
  if (detailBodyRef.value) {
    onDetailResizeStart(e, detailBodyRef.value);
  }
}

function goBack() {
  currentView.value = 'briefing-feed';
  briefing.goBackToFeed();
}

function toggleDetail() {
  detailExpanded.value = !detailExpanded.value;
}

function resetChat() {
  if (selectedDate.value) {
    briefing.resetBriefingChat(selectedDate.value);
  }
}

onMounted(() => {
  if (selectedDate.value && !briefingChatActive.value) {
    briefing.enterBriefingChat(selectedDate.value);
  }
});

onUnmounted(() => {
  if (briefingChatActive.value) {
    briefing.exitBriefingChat();
  }
});
</script>

<template>
  <div class="briefing-detail" v-if="currentView === 'briefing-detail'">
    <div class="briefing-detail-back" @click="goBack">
      <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
      Back
    </div>

    <div v-if="detailLoading" class="briefing-detail-loading">
      <div class="briefing-detail-spinner"></div>
      <span>Loading briefing...</span>
    </div>

    <div v-else-if="!selectedContent" class="briefing-detail-empty">
      <p>Briefing content not available.</p>
    </div>

    <div v-else class="briefing-detail-body" ref="detailBodyRef">
      <!-- Collapsible detail section -->
      <div class="briefing-detail-collapse-header" @click="toggleDetail">
        <span class="briefing-detail-collapse-icon">{{ detailExpanded ? '\u25B2' : '\u25BC' }}</span>
        <span class="briefing-detail-name-inline">
          <span class="briefing-detail-icon">&#x1F4CA;</span>
          Daily Briefing &mdash; {{ formattedDate }}
        </span>
        <button class="briefing-reset-chat-btn" title="Reset chat (delete history and start fresh)" @click.stop="resetChat">
          <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        </button>
      </div>

      <div v-if="detailExpanded" class="briefing-detail-content" :style="detailContentStyle">
        <div class="briefing-detail-markdown markdown-body" v-html="renderedContent"></div>
      </div>

      <!-- Resize handle between detail and chat -->
      <div v-if="detailExpanded" class="briefing-resize-handle" @mousedown="startResize($event)" @touchstart="startResize($event)">
        <div class="briefing-resize-handle-bar"></div>
      </div>

      <!-- Chat area -->
      <div class="briefing-chat-area">
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
            <div class="briefing-chat-empty">
              <div class="briefing-chat-empty-icon">&#x1F4AC;</div>
              <p>Ask anything about this daily briefing</p>
              <p class="muted">e.g. "What's my action list?" or "Summarize the key updates"</p>
            </div>
          </template>
        </MessageList>
      </div>
    </div>
  </div>
</template>
