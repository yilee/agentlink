<script setup>
import { inject } from 'vue';

const store = inject('store');
const {
  sidebarOpen,
  sidebarView,
  toggleSidebar,
  status,
  serverVersion,
  t,
  fileBrowser,
  filePreview,
  flattenedTree,
  isMobile,
  memoryEditing,
  memoryEditContent,
  memoryLoading,
  memorySaving,
  cancelMemoryEdit,
  saveMemoryEdit,
  openMemoryFile,
  refreshMemory,
  startMemoryEdit,
  groupedSessions,
  resumeSession,
  deleteSession,
  newConversation,
  isSessionProcessing,
  processingConversations,
  formatRelativeTime,
  requestSessionList,
  requestTeamsList,
  requestLoopsList,
  renamingSessionId,
  startRename,
  confirmRename,
  cancelRename,
  renamingTeamId,
  startTeamRename,
  renameTeamText,
  confirmTeamRename,
  cancelTeamRename,
  requestDeleteTeam,
  teamsList,
  teamsCollapsed,
  viewHistoricalTeam,
  isTeamActive,
  displayTeam,
  newTeam,
  loopsList,
  selectedLoop,
  viewLoop,
  newLoop,
  renamingLoopId,
  startLoopRename,
  renameLoopText,
  confirmLoopRename,
  cancelLoopRename,
  requestDeleteLoop,
  filteredWorkdirHistory,
  switchToWorkdir,
  removeFromWorkdirHistory,
  toggleWorkdirMenu,
  workdirMenuOpen,
  workdirMenuBrowse,
  workdirMenuChangeDir,
  workdirMenuCopyPath,
  workdirMenuMemory,
  formatFileSize,
  previewPanelOpen,
  filePanelOpen,
  memoryPanelOpen,
  formatSchedule,
  loopScheduleDisplay,
  isLoopRunning,
  agentVersion,
  chatsCollapsed,
  currentClaudeSessionId,
  fileTreeRoot,
  historySessions,
  hostname,
  loadingLoops,
  loadingSessions,
  loadingTeams,
  loopsCollapsed,
  previewFile,
  previewMarkdownRendered,
  team,
  workDir
} = store;
</script>

<template>
        <!-- Sidebar backdrop (mobile) -->
        <div v-if="sidebarOpen" class="sidebar-backdrop" @click="toggleSidebar(); sidebarView = 'sessions'"></div>
        <!-- Sidebar -->
        <aside v-if="sidebarOpen" class="sidebar">
          <!-- Mobile: file browser view -->
          <div v-if="isMobile && sidebarView === 'files'" class="file-panel-mobile">
            <div class="file-panel-mobile-header">
              <button class="file-panel-mobile-back" @click="sidebarView = 'sessions'">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
                {{ t('sidebar.sessions') }}
              </button>
              <button class="file-panel-btn" @click="fileBrowser.refreshTree()" :title="t('sidebar.refresh')">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
              </button>
            </div>
            <div class="file-panel-breadcrumb" :title="workDir">{{ workDir }}</div>
            <div v-if="fileTreeLoading" class="file-panel-loading">{{ t('filePanel.loading') }}</div>
            <div v-else-if="!fileTreeRoot || !fileTreeRoot.children || fileTreeRoot.children.length === 0" class="file-panel-empty">
              {{ t('filePanel.noFiles') }}
            </div>
            <div v-else class="file-tree">
              <template v-for="item in flattenedTree" :key="item.node.path">
                <div
                  class="file-tree-item"
                  :class="{ folder: item.node.type === 'directory' }"
                  :style="{ paddingLeft: (item.depth * 16 + 8) + 'px' }"
                  @click="item.node.type === 'directory' ? fileBrowser.toggleFolder(item.node) : filePreview.openPreview(item.node.path)"
                  @contextmenu.prevent="item.node.type !== 'directory' ? fileBrowser.onFileClick($event, item.node) : null"
                >
                  <span v-if="item.node.type === 'directory'" class="file-tree-arrow" :class="{ expanded: item.node.expanded }">&#9654;</span>
                  <span v-else class="file-tree-file-icon">
                    <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></svg>
                  </span>
                  <span class="file-tree-name" :title="item.node.path">{{ item.node.name }}</span>
                  <span v-if="item.node.loading" class="file-tree-spinner"></span>
                </div>
                <div v-if="item.node.type === 'directory' && item.node.expanded && item.node.children && item.node.children.length === 0 && !item.node.loading" class="file-tree-empty" :style="{ paddingLeft: ((item.depth + 1) * 16 + 8) + 'px' }">{{ t('filePanel.empty') }}</div>
                <div v-if="item.node.error" class="file-tree-error" :style="{ paddingLeft: ((item.depth + 1) * 16 + 8) + 'px' }">{{ item.node.error }}</div>
              </template>
            </div>
          </div>

          <!-- Mobile: file preview view -->
          <div v-else-if="isMobile && sidebarView === 'preview'" class="file-preview-mobile">
            <div class="file-preview-mobile-header">
              <button class="file-panel-mobile-back" @click="filePreview.closePreview(); memoryEditing = false">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
                {{ t('sidebar.files') }}
              </button>
              <div class="preview-header-actions">
                <button v-if="isMemoryPreview && previewFile && !memoryEditing"
                        class="preview-edit-btn" @click="startMemoryEdit()" :title="t('memory.edit')">
                  <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"/></svg>
                  {{ t('memory.edit') }}
                </button>
                <span v-if="memoryEditing" class="preview-edit-label">{{ t('memory.editing') }}</span>
                <button v-if="memoryEditing" class="memory-header-cancel" @click="cancelMemoryEdit()">{{ t('loop.cancel') }}</button>
                <button v-if="memoryEditing" class="memory-header-save" @click="saveMemoryEdit()" :disabled="memorySaving">
                  {{ memorySaving ? t('memory.saving') : t('memory.save') }}
                </button>
                <button v-if="previewFile?.content && !memoryEditing && filePreview.isMarkdownFile(previewFile.fileName)"
                        class="preview-md-toggle" :class="{ active: previewMarkdownRendered }"
                        @click="previewMarkdownRendered = !previewMarkdownRendered"
                        :title="previewMarkdownRendered ? t('preview.showSource') : t('preview.renderMarkdown')">
                  <svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M14.85 3H1.15C.52 3 0 3.52 0 4.15v7.69C0 12.48.52 13 1.15 13h13.69c.64 0 1.15-.52 1.15-1.15v-7.7C16 3.52 15.48 3 14.85 3zM9 11H7V8L5.5 9.92 4 8v3H2V5h2l1.5 2L7 5h2v6zm2.99.5L9.5 8H11V5h2v3h1.5l-2.51 3.5z"/></svg>
                </button>
                <span v-if="previewFile && !memoryEditing" class="file-preview-mobile-size">
                  {{ filePreview.formatFileSize(previewFile.totalSize) }}
                </span>
                <button v-if="previewFile && !memoryEditing" class="preview-refresh-btn" @click="filePreview.refreshPreview()" :title="t('sidebar.refresh')">
                  <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
                </button>
              </div>
            </div>
            <div class="file-preview-mobile-filename" :title="previewFile?.filePath">
              {{ previewFile?.fileName || t('preview.preview') }}
            </div>
            <div class="preview-panel-body">
              <div v-if="memoryEditing" class="memory-edit-container">
                <textarea class="memory-edit-textarea" v-model="memoryEditContent"></textarea>
              </div>
              <div v-else-if="previewLoading" class="preview-loading">{{ t('preview.loading') }}</div>
              <div v-else-if="previewFile?.error" class="preview-error">
                {{ previewFile.error }}
              </div>
              <div v-else-if="previewFile?.encoding === 'base64' && previewFile?.content"
                   class="preview-image-container">
                <img :src="'data:' + previewFile.mimeType + ';base64,' + previewFile.content"
                     :alt="previewFile.fileName" class="preview-image" />
              </div>
              <div v-else-if="previewFile?.content && previewMarkdownRendered && filePreview.isMarkdownFile(previewFile.fileName)"
                   class="preview-markdown-rendered markdown-body" v-html="filePreview.renderedMarkdownHtml(previewFile.content)">
              </div>
              <div v-else-if="previewFile?.content" class="preview-text-container">
                <pre class="preview-code"><code v-html="filePreview.highlightCode(previewFile.content, previewFile.fileName)"></code></pre>
                <div v-if="previewFile.truncated" class="preview-truncated-notice">
                  {{ t('preview.fileTruncated', { size: filePreview.formatFileSize(previewFile.totalSize) }) }}
                </div>
              </div>
              <div v-else-if="previewFile && !previewFile.content && !previewFile.error" class="preview-binary-info">
                <p>{{ t('preview.binaryFile') }} — {{ previewFile.mimeType }}</p>
                <p>{{ filePreview.formatFileSize(previewFile.totalSize) }}</p>
              </div>
            </div>
          </div>

          <!-- Mobile: memory view -->
          <div v-else-if="isMobile && sidebarView === 'memory'" class="file-panel-mobile">
            <div class="file-panel-mobile-header">
              <button class="file-panel-mobile-back" @click="sidebarView = 'sessions'">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
                {{ t('sidebar.sessions') }}
              </button>
              <button class="file-panel-btn" @click="refreshMemory()" :title="t('sidebar.refresh')">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
              </button>
            </div>
            <div v-if="memoryLoading" class="file-panel-loading">{{ t('memory.loading') }}</div>
            <div v-else-if="memoryFiles.length === 0" class="memory-empty">
              <p>{{ t('memory.noFiles') }}</p>
              <p class="memory-empty-hint">{{ t('memory.noFilesHint') }}</p>
            </div>
            <div v-else class="file-tree">
              <div v-for="file in memoryFiles" :key="file.name"
                   class="file-tree-item" @click="openMemoryFile(file)">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13zM6 20V4h5v5c0 .55.45 1 1 1h5v10H6z"/></svg>
                <span class="file-tree-name">{{ file.name }}</span>
              </div>
            </div>
          </div>

          <!-- Normal sidebar content (sessions view) -->
          <template v-else>
          <div class="sidebar-section">
            <div class="sidebar-workdir">
              <div v-if="hostname" class="sidebar-hostname">
                <svg class="sidebar-hostname-icon" viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M3.5 2A1.5 1.5 0 0 0 2 3.5v5A1.5 1.5 0 0 0 3.5 10h9A1.5 1.5 0 0 0 14 8.5v-5A1.5 1.5 0 0 0 12.5 2h-9zM.5 3.5A3 3 0 0 1 3.5.5h9A3 3 0 0 1 15.5 3.5v5a3 3 0 0 1-3 3h-9a3 3 0 0 1-3-3v-5zM5 13.25a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75zM3.25 15a.75.75 0 0 0 0 1.5h9.5a.75.75 0 0 0 0-1.5h-9.5z"/></svg>
                <span>{{ hostname }}</span>
              </div>
              <div class="sidebar-workdir-header">
                <div class="sidebar-workdir-label">{{ t('sidebar.workingDirectory') }}</div>
              </div>
              <div class="sidebar-workdir-path-row" @click.stop="toggleWorkdirMenu()">
                <div class="sidebar-workdir-path" :title="workDir">{{ workDir }}</div>
                <svg class="sidebar-workdir-chevron" :class="{ open: workdirMenuOpen }" viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M7 10l5 5 5-5z"/></svg>
              </div>
              <div v-if="workdirMenuOpen" class="workdir-menu">
                <div class="workdir-menu-item" @click.stop="workdirMenuBrowse()">
                  <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10zM8 13h8v2H8v-2z"/></svg>
                  <span>{{ t('sidebar.browseFiles') }}</span>
                </div>
                <div class="workdir-menu-item" @click.stop="workdirMenuChangeDir()">
                  <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
                  <span>{{ t('sidebar.changeDirectory') }}</span>
                </div>
                <div class="workdir-menu-item" @click.stop="workdirMenuCopyPath()">
                  <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                  <span>{{ t('sidebar.copyPath') }}</span>
                </div>
                <div class="workdir-menu-item" @click.stop="workdirMenuMemory()">
                  <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13zM6 20V4h5v5c0 .55.45 1 1 1h5v10H6z"/></svg>
                  <span>{{ t('sidebar.memory') }}</span>
                </div>
              </div>
              <div v-if="filteredWorkdirHistory.length > 0" class="workdir-history">
                <div class="workdir-history-label">{{ t('sidebar.recentDirectories') }}</div>
                <div class="workdir-history-list">
                  <div
                    v-for="path in filteredWorkdirHistory" :key="path"
                    class="workdir-history-item"
                    @click="switchToWorkdir(path)"
                    :title="path"
                  >
                    <span class="workdir-history-path">{{ path }}</span>
                    <button class="workdir-history-delete" @click.stop="removeFromWorkdirHistory(path)" :title="t('sidebar.removeFromHistory')">
                      <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Chat History section -->
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

          <!-- Teams section -->
          <div class="sidebar-section sidebar-teams" :style="{ flex: teamsCollapsed ? '0 0 auto' : '1 1 0', minHeight: teamsCollapsed ? 'auto' : '0' }">
            <div class="sidebar-section-header" @click="teamsCollapsed = !teamsCollapsed" style="cursor: pointer;">
              <span>{{ t('sidebar.teamsHistory') }}</span>
              <span class="sidebar-section-header-actions">
                <button class="sidebar-refresh-btn" @click.stop="requestTeamsList" :title="t('sidebar.refresh')" :disabled="loadingTeams">
                  <svg :class="{ spinning: loadingTeams }" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
                </button>
                <button class="sidebar-collapse-btn" :title="teamsCollapsed ? t('sidebar.expand') : t('sidebar.collapse')">
                  <svg :class="{ collapsed: teamsCollapsed }" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>
                </button>
              </span>
            </div>

            <div v-show="!teamsCollapsed" class="sidebar-section-collapsible">
            <button class="new-conversation-btn" @click="newTeam" :disabled="isTeamActive">
              <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
              {{ t('sidebar.newTeam') }}
            </button>

            <div class="team-history-list">
              <div
                v-for="tm in teamsList" :key="tm.teamId"
                :class="['team-history-item', { active: displayTeam && displayTeam.teamId === tm.teamId }]"
                @click="renamingTeamId !== tm.teamId && viewHistoricalTeam(tm.teamId)"
                :title="tm.title"
              >
                <div class="team-history-info">
                  <div v-if="renamingTeamId === tm.teamId" class="session-rename-row">
                    <input
                      class="session-rename-input"
                      v-model="renameTeamText"
                      @click.stop
                      @keydown.enter.stop="confirmTeamRename"
                      @keydown.escape.stop="cancelTeamRename"
                      @vue:mounted="$event.el.focus()"
                    />
                    <button class="session-rename-ok" @click.stop="confirmTeamRename" :title="t('sidebar.confirm')">&#10003;</button>
                    <button class="session-rename-cancel" @click.stop="cancelTeamRename" :title="t('sidebar.cancel')">&times;</button>
                  </div>
                  <div v-else class="team-history-title">{{ tm.title || t('sidebar.untitledTeam') }}</div>
                  <div v-if="renamingTeamId !== tm.teamId" class="team-history-meta">
                    <span :class="['team-status-badge', 'team-status-badge-sm', 'team-status-' + tm.status]">{{ tm.status }}</span>
                    <span v-if="tm.taskCount" class="team-history-tasks">{{ tm.taskCount }} {{ t('sidebar.tasks') }}</span>
                    <span v-if="tm.totalCost" class="team-history-tasks">{{'$' + tm.totalCost.toFixed(2) }}</span>
                    <span class="session-actions">
                      <button class="session-rename-btn" @click.stop="startTeamRename(tm)" :title="t('sidebar.renameTeam')">
                        <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                      </button>
                      <button class="session-delete-btn" @click.stop="requestDeleteTeam(tm)" :title="t('sidebar.deleteTeam')">
                        <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                      </button>
                    </span>
                  </div>
                </div>
              </div>
            </div>
            </div>
          </div>

          <!-- Loops section -->
          <div class="sidebar-section sidebar-loops" :style="{ flex: loopsCollapsed ? '0 0 auto' : '1 1 0', minHeight: loopsCollapsed ? 'auto' : '0' }">
            <div class="sidebar-section-header" @click="loopsCollapsed = !loopsCollapsed" style="cursor: pointer;">
              <span>{{ t('sidebar.loops') }}</span>
              <span class="sidebar-section-header-actions">
                <button class="sidebar-refresh-btn" @click.stop="requestLoopsList" :title="t('sidebar.refresh')" :disabled="loadingLoops">
                  <svg :class="{ spinning: loadingLoops }" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
                </button>
                <button class="sidebar-collapse-btn" :title="loopsCollapsed ? t('sidebar.expand') : t('sidebar.collapse')">
                  <svg :class="{ collapsed: loopsCollapsed }" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>
                </button>
              </span>
            </div>

            <div v-show="!loopsCollapsed" class="sidebar-section-collapsible">
            <button class="new-conversation-btn" @click="newLoop">
              <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
              {{ t('sidebar.newLoop') }}
            </button>

            <div v-if="loopsList.length === 0 && !loadingLoops" class="sidebar-empty">
              {{ t('sidebar.noLoops') }}
            </div>
            <div v-else class="loop-history-list">
              <div
                v-for="l in loopsList" :key="l.id"
                :class="['team-history-item', { active: selectedLoop?.id === l.id }]"
                @click="renamingLoopId !== l.id && viewLoop(l.id)"
                :title="l.name"
              >
                <div class="team-history-info">
                  <div v-if="renamingLoopId === l.id" class="session-rename-row">
                    <input
                      class="session-rename-input"
                      v-model="renameLoopText"
                      @click.stop
                      @keydown.enter.stop="confirmLoopRename"
                      @keydown.escape.stop="cancelLoopRename"
                      @vue:mounted="$event.el.focus()"
                    />
                    <button class="session-rename-ok" @click.stop="confirmLoopRename" :title="t('sidebar.confirm')">&#10003;</button>
                    <button class="session-rename-cancel" @click.stop="cancelLoopRename" :title="t('sidebar.cancel')">&times;</button>
                  </div>
                  <div v-else class="team-history-title">{{ l.name || t('sidebar.untitledLoop') }}</div>
                  <div v-if="renamingLoopId !== l.id" class="team-history-meta">
                    <span :class="['team-status-badge', 'team-status-badge-sm', l.enabled ? 'team-status-running' : 'team-status-completed']">{{ l.enabled ? t('sidebar.active') : t('sidebar.paused') }}</span>
                    <span v-if="l.scheduleType" class="team-history-tasks">{{ formatSchedule(l.scheduleType, l.scheduleConfig || {}, l.schedule) }}</span>
                    <span class="session-actions">
                      <button class="session-rename-btn" @click.stop="startLoopRename(l)" :title="t('sidebar.renameLoop')">
                        <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                      </button>
                      <button class="session-delete-btn" @click.stop="requestDeleteLoop(l)" :title="t('sidebar.deleteLoop')">
                        <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                      </button>
                    </span>
                  </div>
                </div>
              </div>
            </div>
            </div>
          </div>

          <div v-if="serverVersion || agentVersion" class="sidebar-version-footer">
            <span v-if="serverVersion">{{ t('sidebar.server') }} {{ serverVersion }}</span>
            <span v-if="serverVersion && agentVersion" class="sidebar-version-sep">/</span>
            <span v-if="agentVersion">{{ t('sidebar.agent') }} {{ agentVersion }}</span>
          </div>
          </template>
        </aside>
</template>
