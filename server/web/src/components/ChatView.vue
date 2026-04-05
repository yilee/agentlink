<script setup>
import { inject, ref, onMounted } from 'vue';
import MessageList from './MessageList.vue';

const store = inject('store');

const {
  messages,
  viewMode,
  currentView,
  onMessageListScroll,
  loadingHistory,
  isProcessing,
  hasStreamingMessage,
  outlineOpen,
  toggleOutline,
  setMessageListRef,
  t,
} = store;

const messageListComp = ref(null);

onMounted(() => {
  setMessageListRef(messageListComp.value);
});
</script>

<template>
          <template v-if="viewMode === 'chat' && currentView === 'chat'">
            <MessageList
              ref="messageListComp"
              :messages="messages"
              :is-processing="isProcessing"
              :has-streaming-message="hasStreamingMessage"
              :loading-history="loadingHistory"
              @scroll="onMessageListScroll"
            />
            <button
              :class="['outline-toggle-btn', { active: outlineOpen }]"
              @click="toggleOutline"
              :title="t('outline.toggle')"
            >
              <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>
            </button>
          </template>
</template>
