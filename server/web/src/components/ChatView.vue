<script setup>
import { inject } from 'vue';
import MessageList from './MessageList.vue';

const store = inject('store');

const {
  messages,
  viewMode,
  currentView,
  onMessageListScroll,
  loadingHistory,
  visibleMessages,
  hasMoreMessages,
  loadMoreMessages,
  isProcessing,
  hasStreamingMessage,
} = store;
</script>

<template>
          <template v-if="viewMode === 'chat' && currentView === 'chat'">
            <MessageList
              :messages="messages"
              :visible-messages="visibleMessages"
              :has-more-messages="hasMoreMessages"
              :is-processing="isProcessing"
              :has-streaming-message="hasStreamingMessage"
              :loading-history="loadingHistory"
              @scroll="onMessageListScroll"
              @load-more="loadMoreMessages"
            />
          </template>
</template>
