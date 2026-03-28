<script setup>
import { inject } from 'vue';

import SessionList from './SessionList.vue';
import TeamList from './TeamList.vue';
import LoopList from './LoopList.vue';
import RecapChatHistory from './RecapChatHistory.vue';
import BriefingChatHistory from './BriefingChatHistory.vue';
import DevOpsChatHistory from './DevOpsChatHistory.vue';
import ProjectChatHistory from './ProjectChatHistory.vue';

const vFocus = { mounted: (el) => el.focus() };

const store = inject('store');
const sidebarStore = inject('sidebar');
const filesStore = inject('files');

const {
  status,
  serverVersion,
  agentVersion,
  t,
  isMobile,
  sidebarView,
  workDir,
  hostname,
  currentView,
  viewMode,
  isMsRoute,
} = store;

const {
  sidebarOpen,
  sidebarWidth,
  toggleSidebar,
  onSidebarResizeStart,
  filteredWorkdirHistory,
  switchToWorkdir,
  removeFromWorkdirHistory,
  workdirCollapsed,
  toggleWorkdirMenu,
  workdirMenuOpen,
  workdirMenuBrowse,
  workdirMenuChangeDir,
  workdirMenuCopyPath,
  workdirMenuGit,
  globalRecentSessions,
  loadingGlobalSessions,
  recentTab,
  requestGlobalSessions,
  resumeGlobalSession,
  formatRelativeTime,
} = sidebarStore;


function projectName(projectPath) {
  if (!projectPath) return '';
  return projectPath.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || projectPath;
}

function switchRecentTab(tab) {
  recentTab.value = tab;
  if (tab === 'sessions') {
    requestGlobalSessions();
  }
}

function goToFeed() {
  if (!store.requireVersion('0.1.121', 'Meeting Recap Feed')) return;
  viewMode.value = 'feed';
}

const {
  fileBrowser,
  filePreview,
  flattenedTree,
  previewFile,
  previewMarkdownRendered,
  fileTreeRoot,
  fileTreeLoading,
  isMemoryPreview,
  previewLoading,
  memoryFiles,
  memoryEditing,
  memoryEditContent,
  memoryLoading,
  memorySaving,
  cancelMemoryEdit,
  saveMemoryEdit,
  openMemoryFile,
  refreshMemory,
  startMemoryEdit,
  workdirMenuMemory,
  git,
  fileEditing,
  fileEditContent,
  fileSaving,
  canEditFile,
  startFileEdit,
  cancelFileEdit,
  saveFileEdit,
  newItemInput,
} = filesStore;
</script>

<template>
        <!-- Sidebar backdrop (mobile) -->
        <div v-if="sidebarOpen" class="sidebar-backdrop" @click="toggleSidebar(); sidebarView = 'sessions'"></div>
        <!-- Sidebar -->
        <aside v-if="sidebarOpen" class="sidebar" :style="!isMobile ? { width: sidebarWidth + 'px' } : undefined">
          <div v-if="!isMobile" class="sidebar-resize-handle"
               @mousedown="onSidebarResizeStart($event)"
               @touchstart="onSidebarResizeStart($event)"></div>
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
                  @contextmenu.prevent="fileBrowser.onFileClick($event, item.node)"
                >
                  <span v-if="item.node.type === 'directory'" class="file-tree-arrow" :class="{ expanded: item.node.expanded }">&#9654;</span>
                  <span v-else class="file-tree-file-icon">
                    <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></svg>
                  </span>
                  <span class="file-tree-name" :title="item.node.path">{{ item.node.name }}</span>
                  <span v-if="item.node.loading" class="file-tree-spinner"></span>
                </div>
                <div v-if="item.node.type === 'directory' && item.node.expanded && item.node.children && item.node.children.length === 0 && !item.node.loading && !(newItemInput && newItemInput.dirPath === item.node.path)" class="file-tree-empty" :style="{ paddingLeft: ((item.depth + 1) * 16 + 8) + 'px' }">{{ t('filePanel.empty') }}</div>
                <div v-if="newItemInput && newItemInput.dirPath === item.node.path && item.node.expanded" class="file-tree-new-item" :style="{ paddingLeft: ((item.depth + 1) * 16 + 8) + 'px' }">
                  <span class="file-tree-file-icon">
                    <svg v-if="newItemInput.type === 'folder'" viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M20 6h-8l-2-2H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2z"/></svg>
                    <svg v-else viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></svg>
                  </span>
                  <input
                    class="file-tree-new-input"
                    :placeholder="newItemInput.type === 'file' ? t('file.enterFileName') : t('file.enterFolderName')"
                    @keydown.enter="fileBrowser.confirmNewItem($event.target.value)"
                    @keydown.escape="fileBrowser.cancelNewItem()"
                    @blur="fileBrowser.cancelNewItem()"
                    v-focus
                  />
                </div>
                <div v-if="item.node.error" class="file-tree-error" :style="{ paddingLeft: ((item.depth + 1) * 16 + 8) + 'px' }">{{ item.node.error }}</div>
              </template>
            </div>
          </div>

          <!-- Mobile: file preview view -->
          <div v-else-if="isMobile && sidebarView === 'preview'" class="file-preview-mobile">
            <div class="file-preview-mobile-header">
              <button v-if="previewFile?.isDiff" class="file-panel-mobile-back" @click="previewFile = null; sidebarView = 'git'">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
                Git
              </button>
              <button v-else class="file-panel-mobile-back" @click="filePreview.closePreview(); memoryEditing = false; fileEditing = false">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
                {{ t('sidebar.files') }}
              </button>
              <div class="preview-header-actions">
                <template v-if="previewFile?.isDiff">
                  <span v-if="previewFile.staged" class="diff-status-badge staged">Staged</span>
                  <span v-else class="diff-status-badge modified">Modified</span>
                </template>
                <template v-else>
                <button v-if="isMemoryPreview && previewFile && !memoryEditing && !fileEditing"
                        class="preview-edit-btn" @click="startMemoryEdit()" :title="t('memory.edit')">
                  <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"/></svg>
                  {{ t('memory.edit') }}
                </button>
                <button v-if="!isMemoryPreview && canEditFile() && !fileEditing && !memoryEditing"
                        class="preview-edit-btn" @click="startFileEdit()" :title="t('file.edit')">
                  <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"/></svg>
                  {{ t('file.edit') }}
                </button>
                <span v-if="fileEditing" class="preview-edit-label">{{ t('file.editing') }}</span>
                <button v-if="fileEditing" class="memory-header-cancel" @click="cancelFileEdit()">{{ t('loop.cancel') }}</button>
                <button v-if="fileEditing" class="memory-header-save" @click="saveFileEdit()" :disabled="fileSaving">
                  {{ fileSaving ? t('memory.saving') : t('memory.save') }}
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
                <span v-if="previewFile && !memoryEditing && !fileEditing" class="file-preview-mobile-size">
                  {{ filePreview.formatFileSize(previewFile.totalSize) }}
                </span>
                <button v-if="previewFile && !memoryEditing && !fileEditing" class="preview-refresh-btn" @click="filePreview.refreshPreview()" :title="t('sidebar.refresh')">
                  <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
                </button>
                </template>
              </div>
            </div>
            <div class="file-preview-mobile-filename" :title="previewFile?.filePath">
              {{ previewFile?.fileName || t('preview.preview') }}
            </div>
            <div class="preview-panel-body">
              <!-- Diff view -->
              <template v-if="previewFile?.isDiff">
                <div v-if="previewFile.diffLoading" class="file-panel-loading">Loading diff...</div>
                <div v-else-if="previewFile.error" class="diff-empty-notice">{{ previewFile.error }}</div>
                <div v-else-if="previewFile.binary" class="diff-binary-notice">Binary file differs</div>
                <div v-else-if="!previewFile.hunks?.length" class="diff-empty-notice">No changes</div>
                <div v-else class="diff-container">
                  <template v-for="(hunk, hi) in previewFile.hunks" :key="hi">
                    <div class="diff-hunk-header" @click="hunk.collapsed = !hunk.collapsed">
                      {{ hunk.header }}
                      <template v-if="hunk.collapsed"> ({{ hunk.lines.length }} lines hidden)</template>
                    </div>
                    <template v-if="!hunk.collapsed">
                      <div v-for="(line, li) in hunk.lines" :key="li"
                           class="diff-line" :class="'diff-line-' + line.type">
                        <div class="diff-gutter">
                          <span class="diff-line-number">{{ line.oldLine ?? '' }}</span>
                          <span class="diff-line-number">{{ line.newLine ?? '' }}</span>
                        </div>
                        <span class="diff-line-content">{{ line.content }}</span>
                      </div>
                    </template>
                  </template>
                </div>
              </template>
              <!-- File editing -->
              <div v-else-if="fileEditing" class="memory-edit-container">
                <textarea class="memory-edit-textarea" v-model="fileEditContent"></textarea>
              </div>
              <div v-else-if="memoryEditing" class="memory-edit-container">
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

          <!-- Mobile: git view -->
          <div v-else-if="isMobile && sidebarView === 'git'" class="file-panel-mobile git-panel-mobile">
            <div class="file-panel-mobile-header">
              <button class="file-panel-mobile-back" @click="sidebarView = 'sessions'">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
                {{ t('sidebar.sessions') }}
              </button>
              <button class="file-panel-btn" @click="git.refresh()" title="Refresh">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
              </button>
            </div>

            <!-- Branch bar (mobile) -->
            <div v-if="git.gitInfo.value && (git.gitInfo.value.branch || git.gitInfo.value.detachedHead)" class="git-branch-bar">
              <div class="git-branch-name">
                <svg class="git-branch-icon" viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                  <path fill-rule="evenodd" d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 101.5 0 .75.75 0 00-1.5 0zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z"/>
                </svg>
                <span>{{ git.gitInfo.value.detachedHead || git.gitInfo.value.branch }}</span>
              </div>
              <div v-if="git.gitInfo.value.upstream" class="git-tracking">
                {{ git.gitInfo.value.upstream }}
                <template v-if="git.gitInfo.value.ahead > 0">
                  <span class="git-ahead">↑{{ git.gitInfo.value.ahead }}</span>
                </template>
                <template v-if="git.gitInfo.value.behind > 0">
                  <span class="git-behind">↓{{ git.gitInfo.value.behind }}</span>
                </template>
              </div>
            </div>

            <!-- Loading (mobile) -->
            <div v-if="git.gitLoading.value" class="file-panel-loading">Loading...</div>

            <!-- Not a repo (mobile) -->
            <div v-else-if="git.gitInfo.value && !git.gitInfo.value.isRepo" class="git-not-repo">
              Not a git repository
            </div>

            <!-- File list (mobile) -->
            <div v-else-if="git.gitInfo.value" class="git-file-list">
              <div v-if="!git.gitInfo.value.staged?.length && !git.gitInfo.value.modified?.length && !git.gitInfo.value.untracked?.length" class="git-clean-state">
                <svg viewBox="0 0 24 24" width="32" height="32"><path fill="currentColor" opacity="0.5" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
                <span>Clean working tree</span>
              </div>

              <template v-else>
                <!-- Staged (mobile) -->
                <template v-if="git.gitInfo.value.staged?.length">
                  <div class="git-group-header" @click="git.toggleGroup('staged')">
                    <span class="git-group-arrow" :class="{ expanded: git.expandedGroups.value.staged }">&#9654;</span>
                    <span class="git-group-label">Staged ({{ git.gitInfo.value.staged.length }})</span>
                    <div class="git-group-actions git-group-actions-mobile" @click.stop>
                      <button class="git-action-btn git-action-unstage" @click="git.unstageAll(git.gitInfo.value.staged)" title="Unstage All">
                        <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M19 13H5v-2h14v2z"/></svg>
                      </button>
                    </div>
                  </div>
                  <template v-if="git.expandedGroups.value.staged">
                    <div v-for="entry in git.gitInfo.value.staged" :key="'s-' + entry.path"
                         class="git-file-item" @click="git.openFileDiff(entry, true)">
                      <span class="git-status-icon" :class="'git-status-' + entry.status">{{ entry.status }}</span>
                      <span class="git-file-name">{{ entry.path.split('/').pop() }}</span>
                      <span v-if="entry.path.includes('/')" class="git-file-dir">{{ entry.path.split('/').slice(0, -1).join('/') }}</span>
                      <div class="git-file-actions git-file-actions-mobile" @click.stop>
                        <button class="git-action-btn git-action-unstage" @click="git.unstageFile(entry.path)" title="Unstage">
                          <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M19 13H5v-2h14v2z"/></svg>
                        </button>
                      </div>
                    </div>
                  </template>
                </template>

                <!-- Modified (mobile) -->
                <template v-if="git.gitInfo.value.modified?.length">
                  <div class="git-group-header" @click="git.toggleGroup('modified')">
                    <span class="git-group-arrow" :class="{ expanded: git.expandedGroups.value.modified }">&#9654;</span>
                    <span class="git-group-label">Modified ({{ git.gitInfo.value.modified.length }})</span>
                    <div class="git-group-actions git-group-actions-mobile" @click.stop>
                      <button class="git-action-btn git-action-stage" @click="git.stageAll(git.gitInfo.value.modified)" title="Stage All">
                        <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                      </button>
                    </div>
                  </div>
                  <template v-if="git.expandedGroups.value.modified">
                    <div v-for="entry in git.gitInfo.value.modified" :key="'m-' + entry.path"
                         class="git-file-item" @click="git.openFileDiff(entry, false)">
                      <span class="git-status-icon" :class="'git-status-' + entry.status">{{ entry.status }}</span>
                      <span class="git-file-name">{{ entry.path.split('/').pop() }}</span>
                      <span v-if="entry.path.includes('/')" class="git-file-dir">{{ entry.path.split('/').slice(0, -1).join('/') }}</span>
                      <div class="git-file-actions git-file-actions-mobile" @click.stop>
                        <button class="git-action-btn git-action-stage" @click="git.stageFile(entry.path)" title="Stage">
                          <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                        </button>
                        <button class="git-action-btn git-action-discard" @click="git.requestDiscard(entry.path)" title="Discard Changes">
                          <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg>
                        </button>
                      </div>
                    </div>
                  </template>
                </template>

                <!-- Untracked (mobile) -->
                <template v-if="git.gitInfo.value.untracked?.length">
                  <div class="git-group-header" @click="git.toggleGroup('untracked')">
                    <span class="git-group-arrow" :class="{ expanded: git.expandedGroups.value.untracked }">&#9654;</span>
                    <span class="git-group-label">Untracked ({{ git.gitInfo.value.untracked.length }})</span>
                    <div class="git-group-actions git-group-actions-mobile" @click.stop>
                      <button class="git-action-btn git-action-stage" @click="git.stageAll(git.gitInfo.value.untracked)" title="Stage All">
                        <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                      </button>
                    </div>
                  </div>
                  <template v-if="git.expandedGroups.value.untracked">
                    <div v-for="entry in git.gitInfo.value.untracked" :key="'u-' + entry.path"
                         class="git-file-item" @click="git.openFileDiff(entry, false)">
                      <span class="git-status-icon git-status-U">?</span>
                      <span class="git-file-name">{{ entry.path.split('/').pop() }}</span>
                      <span v-if="entry.path.includes('/')" class="git-file-dir">{{ entry.path.split('/').slice(0, -1).join('/') }}</span>
                      <div class="git-file-actions git-file-actions-mobile" @click.stop>
                        <button class="git-action-btn git-action-stage" @click="git.stageFile(entry.path)" title="Stage">
                          <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                        </button>
                      </div>
                    </div>
                  </template>
                </template>

                <!-- Commit section (mobile) -->
                <div v-if="git.gitInfo.value.staged?.length" class="git-commit-section">
                  <textarea
                    class="git-commit-input"
                    v-model="git.commitMessage.value"
                    placeholder="Commit message..."
                    rows="3"
                    @keydown.ctrl.enter="git.commit()"
                    @keydown.meta.enter="git.commit()"
                  ></textarea>
                  <button
                    class="git-commit-btn"
                    :disabled="!git.commitMessage.value.trim() || git.commitInProgress.value"
                    @click="git.commit()"
                  >
                    {{ git.commitInProgress.value ? 'Committing...' : 'Commit' }}
                  </button>
                </div>
              </template>

              <!-- Discard confirmation overlay (mobile) -->
              <div v-if="git.discardConfirmFile.value" class="git-discard-overlay" @click="git.cancelDiscard()">
                <div class="git-discard-dialog" @click.stop>
                  <div class="git-discard-title">Discard Changes</div>
                  <div class="git-discard-message">
                    Discard changes to <strong>{{ git.discardConfirmFile.value.split('/').pop() }}</strong>?
                    This cannot be undone.
                  </div>
                  <div class="git-discard-actions">
                    <button class="git-discard-cancel" @click="git.cancelDiscard()">Cancel</button>
                    <button class="git-discard-confirm" @click="git.confirmDiscard()">Discard</button>
                  </div>
                </div>
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
              <div v-if="isMsRoute" class="sidebar-segmented-control">
                <button :class="['seg-btn', { active: viewMode !== 'feed' }]" @click="viewMode = 'chat'">Chat</button>
                <button :class="['seg-btn', { active: viewMode === 'feed' }]" @click="goToFeed">🧠 Feed</button>
              </div>
              <template v-if="viewMode !== 'feed'">
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
                <div class="workdir-menu-item" @click.stop="workdirMenuGit()">
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                    <path fill-rule="evenodd" d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 101.5 0 .75.75 0 00-1.5 0zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z"/>
                  </svg>
                  <span>Git</span>
                </div>
              </div>
              <div v-if="filteredWorkdirHistory.length > 0 || globalRecentSessions.length > 0" class="workdir-history">
                <div class="workdir-history-label">
                  <span>{{ t('sidebar.recent') }}</span>
                  <div class="recent-tab-toggle">
                    <button :class="['recent-tab-btn', { active: recentTab === 'dirs' }]" @click.stop="switchRecentTab('dirs')">{{ t('sidebar.dirs') }}</button>
                    <button :class="['recent-tab-btn', { active: recentTab === 'sessions' }]" @click.stop="switchRecentTab('sessions')">{{ t('sidebar.globalSessions') }}</button>
                  </div>
                </div>

                <!-- Dirs tab -->
                <div v-if="recentTab === 'dirs'" class="workdir-history-list">
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
                  <div v-if="filteredWorkdirHistory.length === 0" class="global-sessions-empty">{{ t('sidebar.recentDirectories') }}</div>
                </div>

                <!-- Sessions tab -->
                <div v-if="recentTab === 'sessions'" class="global-sessions-list">
                  <div v-if="loadingGlobalSessions" class="global-sessions-loading">{{ t('sidebar.loadingGlobalSessions') }}</div>
                  <div v-else-if="globalRecentSessions.length === 0" class="global-sessions-empty">{{ t('sidebar.noGlobalSessions') }}</div>
                  <div
                    v-else
                    v-for="session in globalRecentSessions" :key="session.sessionId"
                    class="global-session-item"
                    @click="resumeGlobalSession(session)"
                    :title="session.firstPrompt"
                  >
                    <div class="global-session-title">{{ session.title || session.firstPrompt || session.sessionId.slice(0, 8) }}</div>
                    <div class="global-session-meta">{{ projectName(session.projectPath) }} &middot; {{ formatRelativeTime(session.lastModified) }}</div>
                  </div>
                </div>
              </div>
              </template>
              <div v-if="viewMode === 'feed'" class="feed-sidebar">
                <div class="feed-sidebar-nav">
                  <button class="feed-sidebar-btn" :class="{ active: currentView === 'recap-feed' || currentView === 'recap-detail' }" @click="currentView = 'recap-feed'">
                    <span class="feed-sidebar-icon">&#x1F4CB;</span>
                    Recaps
                  </button>
                  <button class="feed-sidebar-btn" :class="{ active: currentView === 'briefing-feed' || currentView === 'briefing-detail' }" @click="store.requireVersion('0.1.128', 'Daily Briefing Feed') && (currentView = 'briefing-feed')">
                    <span class="feed-sidebar-icon">&#x1F4CA;</span>
                    Briefings
                  </button>
                  <button class="feed-sidebar-btn" :class="{ active: currentView === 'devops-feed' || currentView === 'devops-detail' }" @click="store.requireVersion('0.1.129', 'DevOps Board') && (currentView = 'devops-feed')">
                    <span class="feed-sidebar-icon">&#x1F6E0;</span>
                    DevOps
                  </button>
                  <button class="feed-sidebar-btn" :class="{ active: currentView === 'project-feed' || currentView === 'project-detail' }" @click="store.requireVersion('0.1.130', 'Project Knowledge Base') && (currentView = 'project-feed')">
                    <span class="feed-sidebar-icon">&#x1F4DA;</span>
                    Projects
                  </button>
                </div>
                <RecapChatHistory v-if="currentView === 'recap-feed' || currentView === 'recap-detail'" />
                <BriefingChatHistory v-if="currentView === 'briefing-feed' || currentView === 'briefing-detail'" />
                <DevOpsChatHistory v-if="currentView === 'devops-feed' || currentView === 'devops-detail'" />
                <ProjectChatHistory v-if="currentView === 'project-feed' || currentView === 'project-detail'" />
              </div>
            </div>
          </div>

          <SessionList v-if="viewMode !== 'feed'" />
          <TeamList v-if="viewMode !== 'feed'" />
          <LoopList v-if="viewMode !== 'feed'" />

          <div v-if="serverVersion || agentVersion" class="sidebar-version-footer">
            <span v-if="serverVersion">{{ t('sidebar.server') }} {{ serverVersion }}</span>
            <span v-if="serverVersion && agentVersion" class="sidebar-version-sep">/</span>
            <span v-if="agentVersion">{{ t('sidebar.agent') }} {{ agentVersion }}</span>
          </div>
          </template>
        </aside>
</template>
