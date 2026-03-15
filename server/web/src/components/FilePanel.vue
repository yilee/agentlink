<script setup>
import { inject } from 'vue';

const store = inject('store');
const filesStore = inject('files');

const { t, isMobile, workDir } = store;

const {
  filePanelOpen,
  fileBrowser,
  filePreview,
  flattenedTree,
  memoryPanelOpen,
  memoryLoading,
  openMemoryFile,
  refreshMemory,
  deleteMemoryFile,
  filePanelWidth,
  fileTreeRoot,
  fileTreeLoading,
  memoryFiles,
} = filesStore;
</script>

<template>
        <!-- File browser panel (desktop) -->
        <Transition name="file-panel">
        <div v-if="filePanelOpen && !isMobile" class="file-panel" :style="{ width: filePanelWidth + 'px' }">
          <div class="file-panel-resize-handle" @mousedown="fileBrowser.onResizeStart($event)" @touchstart="fileBrowser.onResizeStart($event)"></div>
          <div class="file-panel-header">
            <span class="file-panel-title">{{ t('filePanel.files') }}</span>
            <div class="file-panel-actions">
              <button class="file-panel-btn" @click="fileBrowser.refreshTree()" :title="t('sidebar.refresh')">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
              </button>
              <button class="file-panel-btn" @click="filePanelOpen = false" :title="t('sidebar.close')">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
              </button>
            </div>
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
        </Transition>

        <!-- Memory panel (desktop) -->
        <Transition name="file-panel">
        <div v-if="memoryPanelOpen && !isMobile" class="file-panel memory-panel">
          <div class="file-panel-header">
            <span class="file-panel-title">{{ t('memory.title') }}</span>
            <div class="file-panel-actions">
              <button class="file-panel-btn" @click="refreshMemory()" :title="t('sidebar.refresh')">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
              </button>
              <button class="file-panel-btn" @click="memoryPanelOpen = false" :title="t('sidebar.close')">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
              </button>
            </div>
          </div>
          <div v-if="memoryLoading" class="file-panel-loading">{{ t('memory.loading') }}</div>
          <div v-else-if="memoryFiles.length === 0" class="memory-empty">
            <p>{{ t('memory.noFiles') }}</p>
            <p class="memory-empty-hint">{{ t('memory.noFilesHint') }}</p>
          </div>
          <div v-else class="file-tree">
            <div v-for="file in memoryFiles" :key="file.name" class="file-tree-item memory-file-item">
              <div class="memory-file-row" @click="openMemoryFile(file)">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13zM6 20V4h5v5c0 .55.45 1 1 1h5v10H6z"/></svg>
                <span class="file-tree-name">{{ file.name }}</span>
              </div>
              <button class="memory-delete-btn" @click.stop="deleteMemoryFile(file)" :title="t('memory.deleteFile')">
                <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
              </button>
            </div>
          </div>
        </div>
        </Transition>
</template>
