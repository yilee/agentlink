<script setup>
import { inject } from 'vue';

const store = inject('store');
const recap = inject('recap');

const { currentView } = store;

function openRecapFeed() {
  currentView.value = 'recap-feed';
  recap.loadFeed();
  recap.startAutoRefresh();
}

function openChats() {
  currentView.value = 'chat';
  recap.stopAutoRefresh();
}
</script>

<template>
  <div class="feed-nav">
    <button
      :class="['feed-nav-btn', { active: currentView === 'recap-feed' || currentView === 'recap-detail' }]"
      @click="openRecapFeed"
    >
      <span class="feed-nav-icon">&#x1F4CB;</span>
      Recaps
    </button>
    <button class="feed-nav-btn disabled" disabled title="Coming soon">
      <span class="feed-nav-icon">&#x1F4CA;</span>
      Briefings
    </button>
    <div class="feed-nav-divider">
      <span class="feed-nav-divider-icon">&#x1F4AC;</span>
      <span class="feed-nav-divider-label" @click="openChats">Chats</span>
    </div>
  </div>
</template>
