<script setup>
import { provide } from 'vue';
import { createStore } from './store.js';

import BtwOverlay from './components/BtwOverlay.vue';
import FolderPickerDialog from './components/FolderPickerDialog.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import AuthDialog from './components/AuthDialog.vue';
import TopBar from './components/TopBar.vue';
import Sidebar from './components/Sidebar.vue';
import FilePanel from './components/FilePanel.vue';
import TeamView from './components/TeamView.vue';
import LoopView from './components/LoopView.vue';
import ChatView from './components/ChatView.vue';
import ChatInput from './components/ChatInput.vue';
import PreviewPanel from './components/PreviewPanel.vue';

// Create store inside component setup() so onMounted/onUnmounted hooks fire correctly
const store = createStore();
provide('store', store);
const {
  status,
  serverVersion,
  displayStatus,
  agentName,
  workDir,
  sessionId,
  error,
  messages,
  inputText,
  slashMenuVisible,
  sendMessage,
  planMode,
  btwState,
  getRenderedContent,
  isPrevAssistant,
  toggleContextSummary,
  getToolIcon,
  selectQuestionOption,
  submitQuestionAnswer,
  hasQuestionAnswer,
  theme,
  t,
  sidebarOpen,
  toggleSidebar,
  resumeSession,
  newConversation,
  requestSessionList,
  formatRelativeTime,
  groupedSessions,
  isSessionProcessing,
  processingConversations,
  folderPickerOpen,
  folderPickerLoading,
  openFolderPicker,
  folderPickerNavigateUp,
  folderPickerSelectItem,
  folderPickerEnter,
  folderPickerGoToPath,
  confirmFolderPicker,
  deleteConfirmOpen,
  deleteSession,
  confirmDeleteSession,
  cancelDeleteSession,
  renamingSessionId,
  startRename,
  confirmRename,
  cancelRename,
  renamingTeamId,
  deleteTeamConfirmOpen,
  startTeamRename,
  renameTeamText,
  confirmTeamRename,
  team,
  cancelTeamRename,
  requestDeleteTeam,
  pendingDeleteTeamId,
  deleteTeamConfirmTitle,
  confirmDeleteTeam,
  cancelDeleteTeam,
  filteredWorkdirHistory,
  switchToWorkdir,
  removeFromWorkdirHistory,
  workdirSwitching,
  authRequired,
  submitPassword,
  attachments,
  triggerFileInput,
  handleFileSelect,
  removeAttachment,
  formatFileSize,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  handlePaste,
  filePanelOpen,
  fileContextMenu,
  sidebarView,
  flattenedTree,
  previewPanelOpen,
  workdirMenuOpen,
  teamsCollapsed,
  toggleWorkdirMenu,
  workdirMenuBrowse,
  workdirMenuChangeDir,
  sidebar,
  workdirMenuCopyPath,
  fileBrowser,
  memoryPanelOpen,
  memoryEditing,
  workdirMenuMemory,
  memoryLoading,
  wsSend,
  refreshMemory,
  openMemoryFile,
  memoryEditContent,
  filePreview,
  startMemoryEdit,
  cancelMemoryEdit,
  saveMemoryEdit,
  memorySaving,
  deleteMemoryFile,
  teamState,
  viewMode,
  activeAgentView,
  historicalTeam,
  teamsList,
  isTeamActive,
  isTeamRunning,
  displayTeam,
  pendingTasks,
  activeTasks,
  doneTasks,
  failedTasks,
  launchTeam,
  dissolveTeam,
  viewAgent,
  viewDashboard,
  viewHistoricalTeam,
  requestTeamsList,
  deleteTeamById,
  renameTeamById,
  getAgentColor,
  findAgent,
  getAgentMessages,
  backToChat,
  newTeam,
  teamInstruction,
  teamExamples,
  kanbanExpanded,
  instructionExpanded,
  selectedTemplate,
  editedLeadPrompt,
  leadPromptExpanded,
  TEMPLATES,
  TEMPLATE_KEYS,
  onTemplateChange,
  resetLeadPrompt,
  leadPromptPreview,
  launchTeamFromPanel,
  formatTeamTime,
  getTaskAgent,
  viewAgentWithHistory,
  feedAgentName,
  feedContentRest,
  getLatestAgentActivity,
  loop,
  loopsList,
  selectedLoop,
  selectedExecution,
  executionHistory,
  executionMessages,
  runningLoops,
  loadingExecutions,
  loadingExecution,
  editingLoopId,
  hasRunningLoop,
  firstRunningLoop,
  loopError,
  hasMoreExecutions,
  loadingMoreExecutions,
  toggleLoop,
  runNow,
  cancelLoopExecution,
  viewLoopDetail,
  viewExecution,
  backToLoopsList,
  backToLoopDetail,
  LOOP_TEMPLATES,
  buildCronExpression,
  loopName,
  loopScheduleHour,
  loopCronExpr,
  loopDeleteConfirmOpen,
  renamingLoopId,
  startLoopRename,
  renameLoopText,
  confirmLoopRename,
  cancelLoopRename,
  requestLoopsList,
  newLoop,
  loopSelectedTemplate,
  loopPrompt,
  loopScheduleType,
  loopScheduleMinute,
  loopScheduleDayOfWeek,
  viewLoop,
  selectLoopTemplate,
  resetLoopForm,
  createLoopFromPanel,
  startEditingLoop,
  saveLoopEdits,
  cancelEditingLoop,
  requestDeleteLoop,
  loopDeleteConfirmId,
  loopDeleteConfirmName,
  confirmDeleteLoop,
  cancelDeleteLoop,
  loadMoreExecutions,
  clearLoopError,
  loopScheduleDisplay,
  loopLastRunDisplay,
  formatExecTime,
  formatDuration,
  isLoopRunning,
  padTwo
} = store;
</script>

<template>

    <div class="layout">
      <TopBar />

      <div v-if="status === 'No Session' || (status !== 'Connected' && status !== 'Connecting...' && status !== 'Reconnecting...' && messages.length === 0)" class="center-card">
        <div class="status-card">
          <p class="status">
            <span class="label">{{ t('statusCard.status') }}</span>
            <span :class="['badge', status.toLowerCase()]">{{ displayStatus }}</span>
          </p>
          <p v-if="agentName" class="info"><span class="label">{{ t('statusCard.agent') }}</span> {{ agentName }}</p>
          <p v-if="workDir" class="info"><span class="label">{{ t('statusCard.directory') }}</span> {{ workDir }}</p>
          <p v-if="sessionId" class="info muted"><span class="label">{{ t('statusCard.session') }}</span> {{ sessionId }}</p>
          <p v-if="error" class="error-msg">{{ error }}</p>
        </div>
      </div>

      <div v-else class="main-body">
        <Sidebar />

        <FilePanel />

        <!-- Chat area -->
        <div class="chat-area">

          <!-- ══ Team Dashboard ══ -->
          <TeamView />

          <!-- ══ Loop Dashboard ══ -->
          <LoopView />

          <!-- ══ Normal Chat ══ -->
          <ChatView />

          <BtwOverlay />

          <!-- Input area (shown in both chat and team create mode) -->
          <ChatInput />

        </div>

        <PreviewPanel />

      </div>

      <FolderPickerDialog />

      <ConfirmDialog />

      <AuthDialog />

      <!-- Workdir switching overlay -->
      <Transition name="fade">
        <div v-if="workdirSwitching" class="workdir-switching-overlay">
          <div class="workdir-switching-spinner"></div>
          <div class="workdir-switching-text">{{ t('workdir.switching') }}</div>
        </div>
      </Transition>

      <!-- File context menu -->
      <div
        v-if="fileContextMenu"
        class="file-context-menu"
        :style="{ left: fileContextMenu.x + 'px', top: fileContextMenu.y + 'px' }"
      >
        <div class="file-context-item" @click="fileBrowser.askClaudeRead()">
          <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zM5 15h14v2H5zm0-4h14v2H5zm0-4h14v2H5z"/></svg>
          {{ t('contextMenu.askClaudeRead') }}
        </div>
        <div class="file-context-item" @click="fileBrowser.copyPath()">
          <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
          {{ fileContextMenu.copied ? t('contextMenu.copied') : t('contextMenu.copyPath') }}
        </div>
        <div class="file-context-item" @click="fileBrowser.insertPath()">
          <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/></svg>
          {{ t('contextMenu.insertPath') }}
        </div>
      </div>
    </div>
</template>
