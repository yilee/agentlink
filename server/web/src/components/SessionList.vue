<script setup>
import { inject, ref, nextTick } from 'vue';
import { VList } from 'virtua/vue';

const store = inject('store');
const sidebarStore = inject('sidebar');
const chatSearch = inject('chatSearch');

const { t } = store;

const {
  flatSessionItems,
  resumeSession,
  refreshCurrentSession,
  deleteSession,
  newConversation,
  isSessionProcessing,
  formatRelativeTime,
  requestSessionList,
  renamingSessionId,
  startRename,
  confirmRename,
  cancelRename,
  renameText,
  chatsCollapsed,
  currentClaudeSessionId,
  historySessions,
  loadingSessions,
  isSessionBrainMode,
} = sidebarStore;

const { sessionSearchQuery, filteredFlatSessionItems } = chatSearch;

const sessionSearchOpen = ref(false);
const sessionSearchInputRef = ref(null);

function openSessionSearch() {
  sessionSearchOpen.value = true;
  nextTick(() => {
    if (sessionSearchInputRef.value) sessionSearchInputRef.value.focus();
  });
}

function closeSessionSearch() {
  sessionSearchOpen.value = false;
  sessionSearchQuery.value = '';
}

function onSessionSearchKeydown(e) {
  if (e.key === 'Escape') {
    closeSessionSearch();
  }
}
</script>

<template>
  <div class="sidebar-section sidebar-sessions" :style="{ flex: chatsCollapsed ? '0 0 auto' : '1 1 0', minHeight: chatsCollapsed ? 'auto' : '0' }">
    <div class="sidebar-section-header" v-if="!sessionSearchOpen" @click="chatsCollapsed = !chatsCollapsed" style="cursor: pointer;">
      <span>{{ t('sidebar.chatHistory') }}</span>
      <span class="sidebar-section-header-actions">
        <button class="sidebar-refresh-btn" @click.stop="openSessionSearch" :title="t('sidebar.searchSessions')">
          <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
        </button>
        <button class="sidebar-refresh-btn" @click.stop="requestSessionList" :title="t('sidebar.refresh')" :disabled="loadingSessions">
          <svg :class="{ spinning: loadingSessions }" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
        </button>
        <button class="sidebar-collapse-btn" :title="chatsCollapsed ? t('sidebar.expand') : t('sidebar.collapse')">
          <svg :class="{ collapsed: chatsCollapsed }" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>
        </button>
      </span>
    </div>
    <div class="sidebar-section-header sidebar-search-header" v-else>
      <svg class="sidebar-search-icon" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
      <input
        ref="sessionSearchInputRef"
        class="sidebar-search-input"
        v-model="sessionSearchQuery"
        :placeholder="t('sidebar.searchPlaceholder')"
        @keydown="onSessionSearchKeydown"
      />
      <button class="sidebar-search-close" @click="closeSessionSearch">&times;</button>
    </div>

    <div v-show="!chatsCollapsed" class="sidebar-section-collapsible">
    <button class="new-conversation-btn" @click="newConversation">
      <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
      {{ t('sidebar.newConversation') }}
    </button>

    <div v-if="loadingSessions && historySessions.length === 0" class="sidebar-loading">
      {{ t('sidebar.loadingSessions') }}
    </div>
    <div v-else-if="historySessions.length === 0" class="sidebar-empty">
      {{ t('sidebar.noSessions') }}
    </div>
    <div v-else-if="sessionSearchOpen && filteredFlatSessionItems.length === 0" class="sidebar-empty">
      {{ t('sidebar.searchNoResults') }}
    </div>
    <VList v-else :data="sessionSearchOpen ? filteredFlatSessionItems : flatSessionItems" :bufferSize="5" class="session-list">
      <template #default="{ item }">
        <div v-if="item._type === 'header'" class="session-group-label">{{ item.label }}</div>
        <div
          v-else
          :class="['session-item', { active: currentClaudeSessionId === item.sessionId, processing: isSessionProcessing(item.sessionId) }]"
          @click="renamingSessionId !== item.sessionId && resumeSession(item)"
          :title="item.preview"
          :aria-label="(item.title || item.sessionId.slice(0, 8)) + (isSessionProcessing(item.sessionId) ? ' (processing)' : '')"
        >
          <div v-if="renamingSessionId === item.sessionId" class="session-rename-row">
            <input
              class="session-rename-input"
              v-model="renameText"
              @click.stop
              @keydown.enter.stop="confirmRename"
              @keydown.escape.stop="cancelRename"
              @vue:mounted="$event.el.focus()"
            />
            <button class="session-rename-ok" @click.stop="confirmRename" :title="t('sidebar.confirm')">&#10003;</button>
            <button class="session-rename-cancel" @click.stop="cancelRename" :title="t('sidebar.cancel')">&times;</button>
          </div>
          <div v-else class="session-title">
            <svg v-if="item.title && item.title.startsWith('You are a team lead')" class="session-team-icon" viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
            {{ item.title }}
          </div>
          <div class="session-meta">
            <span>
              <span v-if="isSessionBrainMode(item.sessionId)" class="session-brain-icon" title="Brain Mode">🧠</span>
              {{ formatRelativeTime(item.lastModified) }}
            </span>
            <span v-if="renamingSessionId !== item.sessionId" class="session-actions">
              <button
                class="session-rename-btn"
                @click.stop="startRename(item)"
                :title="t('sidebar.renameSession')"
              >
                <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
              </button>
              <button
                v-if="currentClaudeSessionId === item.sessionId"
                class="session-refresh-btn"
                @click.stop="refreshCurrentSession"
                :title="t('sidebar.refreshSession')"
              >
                <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
              </button>
              <button
                v-if="currentClaudeSessionId !== item.sessionId"
                class="session-delete-btn"
                @click.stop="deleteSession(item)"
                :title="t('sidebar.deleteSession')"
              >
                <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
              </button>
            </span>
          </div>
        </div>
      </template>
    </VList>
    </div>
  </div>
</template>
