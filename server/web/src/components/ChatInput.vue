<script setup>
import { inject } from 'vue';

const store = inject('store');
const {
  status,
  viewMode,
  currentView,
  inputText,
  planMode,
  brainMode,
  brainModeLocked,
  toggleBrainMode,
  showBrainButton,
  slashMenuVisible,
  t,
  sendMessage,
  attachments,
  formatFileSize,
  removeAttachment,
  triggerFileInput,
  handleFileSelect,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  handlePaste,
  isMobile,
  dragOver,
  filteredSlashCommands,
  formatUsage,
  isCompacting,
  slashMenuIndex,
  usageStats,
  queuedMessages,
  removeQueuedMessage,
  selectSlashCommand,
  handleKeydown,
  autoResize,
  openSlashMenu,
  togglePlanMode,
  isProcessing,
  cancelExecution,
  hasInput,
  canSend,
  fileInputRef,
  inputRef,
  currentClaudeSessionId
} = store;

/** Track which items are selectable (not category headers) for index mapping */
function selectableIndex(cmd, i) {
  let si = 0;
  for (let j = 0; j < i; j++) {
    if (!filteredSlashCommands.value[j].category) si++;
  }
  return si;
}
</script>

<template>
          <div class="input-area" v-if="(viewMode === 'chat' && currentView === 'chat') || currentView === 'recap-detail' || currentView === 'briefing-detail' || currentView === 'devops-detail' || currentView === 'project-detail'">
            <input
              type="file"
              ref="fileInputRef"
              multiple
              style="display: none"
              @change="handleFileSelect"
              accept="image/*,text/*,.pdf,.json,.md,.py,.js,.ts,.tsx,.jsx,.css,.html,.xml,.yaml,.yml,.toml,.sh,.sql,.csv"
            />
            <div v-if="queuedMessages.length > 0" class="queue-bar">
              <div v-for="(qm, qi) in queuedMessages" :key="qm.id" class="queue-item">
                <span class="queue-item-num">{{ qi + 1 }}.</span>
                <span class="queue-item-text">{{ qm.content }}</span>
                <span v-if="qm.attachments && qm.attachments.length" class="queue-item-attach" :title="qm.attachments.map(a => a.name).join(', ')">
                  <svg viewBox="0 0 24 24" width="11" height="11"><path fill="currentColor" d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 0 0 5 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg>
                  {{ qm.attachments.length }}
                </span>
                <button class="queue-item-remove" @click="removeQueuedMessage(qm.id)" :title="t('input.removeFromQueue')">&times;</button>
              </div>
            </div>
            <div v-if="usageStats && currentView !== 'recap-detail' && currentView !== 'briefing-detail' && currentView !== 'devops-detail'" class="usage-bar">{{ formatUsage(usageStats) }}</div>
            <div v-if="slashMenuVisible && filteredSlashCommands.length > 0" class="slash-menu">
              <template v-for="(cmd, i) in filteredSlashCommands" :key="cmd.command || cmd.category">
                <div v-if="cmd.category" class="slash-menu-category">{{ cmd.category }}</div>
                <div v-else
                     :class="['slash-menu-item', { active: selectableIndex(cmd, i) === slashMenuIndex }]"
                     @mouseenter="slashMenuIndex = selectableIndex(cmd, i)"
                     @click="selectSlashCommand(cmd)">
                  <span class="slash-menu-cmd">{{ cmd.command }}</span>
                  <span class="slash-menu-desc">{{ cmd.descKey ? t(cmd.descKey) : cmd.desc }}</span>
                </div>
              </template>
            </div>
            <div
              :class="['input-card', { 'drag-over': dragOver, 'plan-mode': planMode, 'brain-mode': brainMode && currentView !== 'recap-detail' && currentView !== 'briefing-detail' && currentView !== 'devops-detail' }]"
              @dragover="handleDragOver"
              @dragleave="handleDragLeave"
              @drop="handleDrop"
            >
              <textarea
                ref="inputRef"
                v-model="inputText"
                @keydown="handleKeydown"
                @input="autoResize"
                @paste="handlePaste"
                :disabled="status !== 'Connected'"
                :placeholder="isCompacting ? t('input.compacting') : t('input.placeholder')"
                rows="1"
              ></textarea>
              <div v-if="attachments.length > 0" class="attachment-bar">
                <div v-for="(att, i) in attachments" :key="i" class="attachment-chip">
                  <img v-if="att.isImage && att.thumbUrl" :src="att.thumbUrl" class="attachment-thumb" />
                  <div v-else class="attachment-file-icon">
                    <svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M1 2.5A2.5 2.5 0 0 1 3.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75H3.5a1 1 0 0 0-1 1h9.25a.75.75 0 0 1 0 1.5H3.5A2.5 2.5 0 0 1 1 14V2.5z"/></svg>
                  </div>
                  <div class="attachment-info">
                    <div class="attachment-name">{{ att.name }}</div>
                    <div class="attachment-size">{{ formatFileSize(att.size) }}</div>
                  </div>
                  <button class="attachment-remove" @click="removeAttachment(i)" :title="t('input.remove')">&times;</button>
                </div>
              </div>
              <div class="input-bottom-row">
                <div class="input-bottom-left">
                  <button class="attach-btn" @click="triggerFileInput" :disabled="status !== 'Connected' || isCompacting || attachments.length >= 5" :title="t('input.attachFiles')">
                    <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 0 0 5 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg>
                  </button>
                  <button class="slash-btn" @click="openSlashMenu" :disabled="status !== 'Connected'" :title="t('input.slashCommands')">
                    <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M7 21 11 3h2L9 21H7Z"/></svg>
                  </button>
                  <button :class="['plan-mode-btn', { active: planMode }]" @click="togglePlanMode" :disabled="isProcessing" :title="planMode ? 'Switch to Normal Mode' : 'Switch to Plan Mode'" v-if="currentView !== 'recap-detail' && currentView !== 'briefing-detail' && currentView !== 'devops-detail'">
                    <svg viewBox="0 0 24 24" width="12" height="12"><rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/></svg>
                    Plan
                  </button>
                  <button v-if="showBrainButton && currentView !== 'recap-detail' && currentView !== 'briefing-detail' && currentView !== 'devops-detail'" :class="['brain-mode-btn', { active: brainMode, locked: brainModeLocked }]" @click="toggleBrainMode" :disabled="brainModeLocked || isProcessing || !!currentClaudeSessionId" :title="brainMode ? 'Brain Mode (active)' : 'Enable Brain Mode'">
                    <span class="brain-emoji">🧠</span>
                    Brain
                  </button>
                </div>
                <button v-if="isProcessing && !hasInput" @click="cancelExecution" class="send-btn stop-btn" :title="t('input.stopGeneration')">
                  <svg viewBox="0 0 24 24" width="14" height="14"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>
                </button>
                <button v-else @click="sendMessage" :disabled="!canSend" class="send-btn" :title="t('input.send')">
                  <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                </button>
              </div>
            </div>
          </div>
</template>
