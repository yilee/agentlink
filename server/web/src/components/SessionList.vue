<script setup>
import { inject } from 'vue';

const store = inject('store');
const sidebarStore = inject('sidebar');

const { t } = store;

const {
  groupedSessions,
  resumeSession,
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
</script>

<template>
  <div class="sidebar-section sidebar-sessions" :style="{ flex: chatsCollapsed ? '0 0 auto' : '1 1 0', minHeight: chatsCollapsed ? 'auto' : '0' }">
    <div class="sidebar-section-header" @click="chatsCollapsed = !chatsCollapsed" style="cursor: pointer;">
      <span>{{ t('sidebar.chatHistory') }}</span>
      <span class="sidebar-section-header-actions">
        <button class="sidebar-refresh-btn" @click.stop="requestSessionList" :title="t('sidebar.refresh')" :disabled="loadingSessions">
          <svg :class="{ spinning: loadingSessions }" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
        </button>
        <button class="sidebar-collapse-btn" :title="chatsCollapsed ? t('sidebar.expand') : t('sidebar.collapse')">
          <svg :class="{ collapsed: chatsCollapsed }" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>
        </button>
      </span>
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
    <div v-else class="session-list">
      <div v-for="group in groupedSessions" :key="group.label" class="session-group">
        <div class="session-group-label">{{ group.label }}</div>
        <div
          v-for="s in group.sessions" :key="s.sessionId"
          :class="['session-item', { active: currentClaudeSessionId === s.sessionId, processing: isSessionProcessing(s.sessionId) }]"
          @click="renamingSessionId !== s.sessionId && resumeSession(s)"
          :title="s.preview"
          :aria-label="(s.title || s.sessionId.slice(0, 8)) + (isSessionProcessing(s.sessionId) ? ' (processing)' : '')"
        >
          <div v-if="renamingSessionId === s.sessionId" class="session-rename-row">
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
            <svg v-if="s.title && s.title.startsWith('You are a team lead')" class="session-team-icon" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
            <svg v-if="isSessionBrainMode(s.sessionId)" class="session-brain-icon" viewBox="0 0 24 24" width="14" height="14" title="Brain Mode"><path fill="currentColor" d="M12 2C9.24 2 7 4.24 7 7c0 1.38.56 2.63 1.46 3.54.08.08.14.18.14.29v1.67c0 .28.22.5.5.5h5.8c.28 0 .5-.22.5-.5v-1.67c0-.11.06-.21.14-.29A4.98 4.98 0 0 0 17 7c0-2.76-2.24-5-5-5zM9.5 14h5v1h-5v-1zm0 2h5v1h-5v-1zm1.25 3h2.5l-.25 1h-2l-.25-1z"/></svg>
            {{ s.title }}
          </div>
          <div class="session-meta">
            <span>{{ formatRelativeTime(s.lastModified) }}</span>
            <span v-if="renamingSessionId !== s.sessionId" class="session-actions">
              <button
                class="session-rename-btn"
                @click.stop="startRename(s)"
                :title="t('sidebar.renameSession')"
              >
                <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
              </button>
              <button
                v-if="currentClaudeSessionId !== s.sessionId"
                class="session-delete-btn"
                @click.stop="deleteSession(s)"
                :title="t('sidebar.deleteSession')"
              >
                <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
              </button>
            </span>
          </div>
        </div>
      </div>
    </div>
    </div>
  </div>
</template>
