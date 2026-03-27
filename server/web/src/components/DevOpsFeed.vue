<script setup>
import { inject, onMounted, onUnmounted } from 'vue';
import DevOpsCard from './DevOpsCard.vue';

const store = inject('store');
const devops = inject('devops');

const { currentView } = store;
const { activeTab, loading, prEntries, wiEntries, groupedPrEntries, groupedWiEntries } = devops;

function refresh() {
  devops.loadFeed();
}

function openPr(entry) {
  devops.selectEntity('pr', entry.pr_number);
}

function openWi(entry) {
  devops.selectEntity('wi', entry.work_item_id);
}

onMounted(() => {
  if (prEntries.value.length === 0 && wiEntries.value.length === 0) {
    devops.loadFeed();
  }
  devops.startAutoRefresh();
});

onUnmounted(() => {
  devops.stopAutoRefresh();
});
</script>

<template>
  <div class="devops-feed" v-if="currentView === 'devops-feed'">
    <div class="devops-feed-header">
      <div class="devops-feed-title">
        <span class="devops-feed-title-icon">&#x1F6E0;</span>
        DevOps Board
      </div>
      <button class="devops-feed-refresh" @click="refresh" :disabled="loading" title="Refresh">
        <svg :class="{ spinning: loading }" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
      </button>
    </div>

    <!-- Tab switcher -->
    <div class="devops-tabs">
      <button :class="['devops-tab', { active: activeTab === 'pr' }]" @click="activeTab = 'pr'">
        Pull Requests
        <span v-if="prEntries.length" class="devops-tab-count">{{ prEntries.length }}</span>
      </button>
      <button :class="['devops-tab', { active: activeTab === 'wi' }]" @click="activeTab = 'wi'">
        Work Items
        <span v-if="wiEntries.length" class="devops-tab-count">{{ wiEntries.length }}</span>
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading && prEntries.length === 0 && wiEntries.length === 0" class="devops-feed-loading">
      <div class="devops-feed-spinner"></div>
      <span>Loading DevOps data...</span>
    </div>

    <!-- PR Tab -->
    <div v-else-if="activeTab === 'pr'" class="devops-feed-body">
      <div v-if="prEntries.length === 0" class="devops-feed-empty">
        <div class="devops-feed-empty-icon">&#x1F4E6;</div>
        <p>No pull requests yet</p>
        <p class="muted">PRs will appear here after Brain processes your DevOps data.</p>
      </div>
      <div v-else>
        <div v-for="group in groupedPrEntries" :key="group.label" class="devops-feed-group">
          <div class="devops-feed-group-label">{{ group.label }} ({{ group.count }})</div>
          <div class="devops-feed-grid">
            <DevOpsCard
              v-for="entry in group.entries"
              :key="entry.pr_number"
              :entry="entry"
              type="pr"
              @click="openPr(entry)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- WI Tab -->
    <div v-else-if="activeTab === 'wi'" class="devops-feed-body">
      <div v-if="wiEntries.length === 0" class="devops-feed-empty">
        <div class="devops-feed-empty-icon">&#x1F4CB;</div>
        <p>No work items yet</p>
        <p class="muted">Work items will appear here after Brain processes your DevOps data.</p>
      </div>
      <div v-else>
        <div v-for="group in groupedWiEntries" :key="group.label" class="devops-feed-group">
          <div class="devops-feed-group-label">{{ group.label }} ({{ group.count }})</div>
          <div class="devops-feed-grid">
            <DevOpsCard
              v-for="entry in group.entries"
              :key="entry.work_item_id"
              :entry="entry"
              type="wi"
              @click="openWi(entry)"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
