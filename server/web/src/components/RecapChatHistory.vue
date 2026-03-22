<script setup>
import { inject, nextTick } from 'vue';

const recap = inject('recap');
const sidebarStore = inject('sidebar');
const { formatRelativeTime } = sidebarStore;

const {
  recapChatSessions,
  navigateToRecapChat,
  deleteRecapChatSession,
  renameRecapChatSession,
  startChatRename,
  cancelChatRename,
  renamingChatSessionId,
  renameChatText,
  selectedRecapId,
  recapChatActive,
} = recap;

function focusInput(e) {
  nextTick(() => e.el.focus());
}
</script>

<template>
  <div class="recap-chat-history">
    <div class="recap-chat-history-header">
      <span>Chat History</span>
    </div>

    <div v-if="recapChatSessions.length === 0" class="recap-chat-history-empty">
      No recap chats yet
    </div>

    <div v-else class="recap-chat-history-list">
      <div
        v-for="s in recapChatSessions" :key="s.sessionId"
        :class="['recap-chat-item', { active: recapChatActive && selectedRecapId === s.recapId }]"
        @click="renamingChatSessionId !== s.sessionId && navigateToRecapChat(s)"
      >
        <!-- Rename mode -->
        <div v-if="renamingChatSessionId === s.sessionId" class="recap-chat-rename-row">
          <input
            class="recap-chat-rename-input"
            v-model="renameChatText"
            @click.stop
            @keydown.enter.stop="renameRecapChatSession(s.sessionId, renameChatText)"
            @keydown.escape.stop="cancelChatRename"
            @vue:mounted="focusInput"
          />
          <button class="recap-chat-rename-ok" @click.stop="renameRecapChatSession(s.sessionId, renameChatText)">&#10003;</button>
          <button class="recap-chat-rename-cancel" @click.stop="cancelChatRename">&times;</button>
        </div>

        <!-- Normal mode -->
        <template v-else>
          <div class="recap-chat-item-title">
            <span class="recap-chat-brain-icon" title="Brain Mode">&#x1F9E0;</span>
            {{ s.displayTitle }}
          </div>
          <div class="recap-chat-item-meta">
            <span>{{ formatRelativeTime(s.lastModified) }}</span>
            <span class="recap-chat-item-actions">
              <button
                class="recap-chat-rename-btn"
                @click.stop="startChatRename(s)"
                title="Rename"
              >
                <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
              </button>
              <button
                v-if="!(recapChatActive && selectedRecapId === s.recapId)"
                class="recap-chat-delete-btn"
                @click.stop="deleteRecapChatSession(s)"
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
</template>
