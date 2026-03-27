<script setup>
import { inject, nextTick } from 'vue';

const devops = inject('devops');
const sidebarStore = inject('sidebar');
const { formatRelativeTime } = sidebarStore;

const {
  groupedDevopsChatSessions,
  devopsChatLoading,
  refreshDevopsChats,
  navigateToDevopsChat,
  deleteDevopsChatSession,
  renameDevopsChatSession,
  startChatRename,
  cancelChatRename,
  renamingChatSessionId,
  renameChatText,
  activeDevopsSessionId,
  devopsChatActive,
  collapsedGroups,
} = devops;

function focusInput(e) {
  nextTick(() => e.el.focus());
}

function toggleGroup(entityKey) {
  collapsedGroups.value[entityKey] = !collapsedGroups.value[entityKey];
}
</script>

<template>
  <div class="briefing-chat-history">
    <div class="briefing-chat-history-header">
      <span>Chat History</span>
      <button class="briefing-chat-refresh-btn" @click="refreshDevopsChats" :disabled="devopsChatLoading" title="Refresh">
        <svg :class="{ spinning: devopsChatLoading }" viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
      </button>
    </div>

    <div v-if="devopsChatLoading && groupedDevopsChatSessions.length === 0" class="briefing-chat-history-loading">
      <div class="briefing-chat-history-spinner"></div>
    </div>

    <div v-else-if="groupedDevopsChatSessions.length === 0" class="briefing-chat-history-empty">
      No DevOps chats yet
    </div>

    <div v-else class="briefing-chat-history-list">
      <div v-for="group in groupedDevopsChatSessions" :key="group.entityKey" class="briefing-chat-group">
        <div class="briefing-chat-group-header" @click="toggleGroup(group.entityKey)">
          <svg :class="['briefing-chat-group-chevron', { collapsed: collapsedGroups[group.entityKey] }]" viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>
          <span class="briefing-chat-group-name">{{ group.entityTitle }}</span>
          <span class="briefing-chat-group-count">{{ group.sessions.length }}</span>
        </div>
        <div v-show="!collapsedGroups[group.entityKey]" class="briefing-chat-group-items">
          <div
            v-for="s in group.sessions" :key="s.sessionId"
            :class="['briefing-chat-item', { active: devopsChatActive && activeDevopsSessionId === s.sessionId }]"
            @click="renamingChatSessionId !== s.sessionId && navigateToDevopsChat(s)"
          >
            <!-- Rename mode -->
            <div v-if="renamingChatSessionId === s.sessionId" class="briefing-chat-rename-row">
              <input
                class="briefing-chat-rename-input"
                v-model="renameChatText"
                @click.stop
                @keydown.enter.stop="renameDevopsChatSession(s.sessionId, renameChatText)"
                @keydown.escape.stop="cancelChatRename"
                @vue:mounted="focusInput"
              />
              <button class="briefing-chat-rename-ok" @click.stop="renameDevopsChatSession(s.sessionId, renameChatText)">&#10003;</button>
              <button class="briefing-chat-rename-cancel" @click.stop="cancelChatRename">&times;</button>
            </div>

            <!-- Normal mode -->
            <template v-else>
              <div class="briefing-chat-item-title">
                {{ s.displayTitle }}
              </div>
              <div class="briefing-chat-item-meta">
                <span>{{ formatRelativeTime(s.lastModified) }}</span>
                <span class="briefing-chat-item-actions">
                  <button
                    class="briefing-chat-rename-btn"
                    @click.stop="startChatRename(s)"
                    title="Rename"
                  >
                    <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                  </button>
                  <button
                    v-if="!(devopsChatActive && activeDevopsSessionId === s.sessionId)"
                    class="briefing-chat-delete-btn"
                    @click.stop="deleteDevopsChatSession(s)"
                    title="Delete"
                  >
                    <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                  </button>
                </span>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
