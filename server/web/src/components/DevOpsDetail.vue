<script setup>
import { inject, computed, onMounted, onUnmounted, ref } from 'vue';
import { renderMarkdown } from '../modules/markdown.js';
import MessageList from './MessageList.vue';

const store = inject('store');
const devops = inject('devops');

const {
  currentView, messages, visibleMessages, hasMoreMessages,
  isProcessing, hasStreamingMessage, loadingHistory,
  onMessageListScroll, loadMoreMessages,
} = store;
const {
  selectedEntityType, selectedEntityId, selectedEntity,
  selectedDescription, selectedMentions,
  detailLoading, devopsChatActive, detailExpanded, detailHeight, onDetailResizeStart,
} = devops;

const headerTitle = computed(() => {
  const entity = selectedEntity.value;
  if (!entity) return '';
  if (selectedEntityType.value === 'pr') {
    return `PR #${entity.pr_number}` + (entity.title ? ` \u2014 ${entity.title}` : '');
  }
  return `${entity.work_item_type || 'WI'} #${entity.work_item_id}` + (entity.title ? ` \u2014 ${entity.title}` : '');
});

const statusLabel = computed(() => {
  const entity = selectedEntity.value;
  if (!entity) return '';
  return selectedEntityType.value === 'pr' ? (entity.status || 'Active') : (entity.state || 'New');
});

const statusClass = computed(() => {
  const s = statusLabel.value.toLowerCase();
  if (s === 'completed' || s === 'resolved' || s === 'closed') return 'devops-status-green';
  if (s === 'active') return selectedEntityType.value === 'pr' ? 'devops-status-blue' : 'devops-status-yellow';
  if (s === 'draft' || s === 'abandoned') return 'devops-status-gray';
  return 'devops-status-blue';
});

const renderedDescription = computed(() => {
  if (!selectedDescription.value) return '';
  return renderMarkdown(selectedDescription.value);
});

const renderedMentions = computed(() => {
  if (!selectedMentions.value) return '';
  return renderMarkdown(selectedMentions.value);
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
  currentView.value = 'devops-feed';
  devops.goBackToFeed();
}

function toggleDetail() {
  detailExpanded.value = !detailExpanded.value;
}

function resetChat() {
  if (selectedEntityType.value && selectedEntityId.value) {
    devops.resetDevopsChat(selectedEntityType.value, selectedEntityId.value);
  }
}

onMounted(() => {
  if (selectedEntityType.value && selectedEntityId.value && !devopsChatActive.value) {
    devops.enterDevopsChat(selectedEntityType.value, selectedEntityId.value);
  }
});

onUnmounted(() => {
  if (devopsChatActive.value) {
    devops.exitDevopsChat();
  }
});
</script>

<template>
  <div class="devops-detail" v-if="currentView === 'devops-detail'">
    <div class="devops-detail-back" @click="goBack">
      <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
      Back
    </div>

    <div v-if="detailLoading" class="devops-detail-loading">
      <div class="devops-detail-spinner"></div>
      <span>Loading details...</span>
    </div>

    <div v-else-if="!selectedDescription && !selectedMentions" class="devops-detail-empty">
      <p>Detail not available.</p>
    </div>

    <div v-else class="devops-detail-body" ref="detailBodyRef">
      <!-- Collapsible detail section -->
      <div class="devops-detail-collapse-header" @click="toggleDetail">
        <span class="devops-detail-collapse-icon">{{ detailExpanded ? '\u25B2' : '\u25BC' }}</span>
        <span class="devops-detail-name-inline">
          <span class="devops-detail-icon">&#x1F6E0;</span>
          {{ headerTitle }}
        </span>
        <span v-if="statusLabel" :class="['devops-status-badge', 'devops-status-badge-sm', statusClass]">{{ statusLabel }}</span>
        <button class="devops-reset-chat-btn" title="Reset chat (delete history and start fresh)" @click.stop="resetChat">
          <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        </button>
      </div>

      <div v-if="detailExpanded" class="devops-detail-content" :style="detailContentStyle">
        <div class="devops-detail-markdown markdown-body" v-html="renderedDescription"></div>
        <div v-if="renderedMentions" class="devops-detail-mentions">
          <div class="devops-detail-markdown markdown-body" v-html="renderedMentions"></div>
        </div>
      </div>

      <!-- Resize handle between detail and chat -->
      <div v-if="detailExpanded" class="devops-resize-handle" @mousedown="startResize($event)" @touchstart="startResize($event)">
        <div class="devops-resize-handle-bar"></div>
      </div>

      <!-- Chat area -->
      <div class="devops-chat-area">
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
            <div class="devops-chat-empty">
              <div class="devops-chat-empty-icon">&#x1F4AC;</div>
              <p>Ask anything about this {{ selectedEntityType === 'pr' ? 'pull request' : 'work item' }}</p>
              <p class="muted">e.g. "Summarize the review feedback" or "What files were changed?"</p>
            </div>
          </template>
        </MessageList>
      </div>
    </div>
  </div>
</template>
