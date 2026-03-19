<script setup>
import { inject, ref, watch, nextTick } from 'vue';
import { useMonacoEditor } from '../composables/useMonacoEditor.js';

const store = inject('store');
const filesStore = inject('files');

const { t, isMobile, theme } = store;

const {
  previewPanelOpen,
  filePreview,
  previewPanelWidth,
  previewFile,
  previewMarkdownRendered,
  isMemoryPreview,
  previewLoading,
  memoryEditing,
  memoryEditContent,
  memorySaving,
  cancelMemoryEdit,
  saveMemoryEdit,
  startMemoryEdit,
  fileEditing,
  fileEditContent,
  fileSaving,
  canEditFile,
  startFileEdit,
  cancelFileEdit,
  saveFileEdit,
} = filesStore;

// Monaco editor (desktop only)
const monacoContainer = ref(null);

function doSaveFile() {
  if (monacoEditor.editorReady.value) {
    fileEditContent.value = monacoEditor.getContent();
  }
  saveFileEdit();
}

function doCancelFile() {
  monacoEditor.dispose();
  cancelFileEdit();
}

const monacoEditor = useMonacoEditor(theme, {
  onSave: doSaveFile,
  onCancel: doCancelFile,
});

// Initialize Monaco when file editing starts
watch(fileEditing, async (editing) => {
  if (editing && !isMobile.value) {
    await nextTick();
    if (monacoContainer.value) {
      monacoEditor.init(monacoContainer.value, fileEditContent.value, previewFile.value?.fileName);
    }
  } else {
    monacoEditor.dispose();
  }
});
</script>

<template>
        <!-- Preview Panel (desktop) -->
        <Transition name="file-panel">
        <div v-if="previewPanelOpen && !isMobile" class="preview-panel" :style="{ width: previewPanelWidth + 'px' }">
          <div class="preview-panel-resize-handle"
               @mousedown="filePreview.onResizeStart($event)"
               @touchstart="filePreview.onResizeStart($event)"></div>
          <div class="preview-panel-header">
            <span class="preview-panel-filename" :title="previewFile?.filePath">
              {{ previewFile?.fileName || t('preview.preview') }}
            </span>
            <span v-if="previewFile?.isDiff" class="diff-status-badge" :class="previewFile.staged ? 'staged' : (previewFile.status === '?' ? 'untracked' : 'modified')">
              {{ previewFile.staged ? 'Staged' : (previewFile.status === '?' ? 'Untracked' : 'Modified') }}
            </span>
            <button v-if="previewFile?.content && filePreview.isMarkdownFile(previewFile.fileName)"
                    class="preview-md-toggle" :class="{ active: previewMarkdownRendered }"
                    @click="previewMarkdownRendered = !previewMarkdownRendered"
                    :title="previewMarkdownRendered ? t('preview.showSource') : t('preview.renderMarkdown')">
              <svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M14.85 3H1.15C.52 3 0 3.52 0 4.15v7.69C0 12.48.52 13 1.15 13h13.69c.64 0 1.15-.52 1.15-1.15v-7.7C16 3.52 15.48 3 14.85 3zM9 11H7V8L5.5 9.92 4 8v3H2V5h2l1.5 2L7 5h2v6zm2.99.5L9.5 8H11V5h2v3h1.5l-2.51 3.5z"/></svg>
            </button>
            <span v-if="previewFile" class="preview-panel-size">
              {{ filePreview.formatFileSize(previewFile.totalSize) }}
            </span>
            <button v-if="previewFile && !memoryEditing && !fileEditing" class="preview-refresh-btn" @click="filePreview.refreshPreview()" :title="t('sidebar.refresh')">
              <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
            </button>
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
            <button v-if="fileEditing" class="memory-header-cancel" @click="doCancelFile()">{{ t('loop.cancel') }}</button>
            <button v-if="fileEditing" class="memory-header-save" @click="doSaveFile()" :disabled="fileSaving">
              {{ fileSaving ? t('memory.saving') : t('memory.save') }}
            </button>
            <span v-if="memoryEditing" class="preview-edit-label">{{ t('memory.editing') }}</span>
            <button v-if="memoryEditing" class="memory-header-cancel" @click="cancelMemoryEdit()">{{ t('loop.cancel') }}</button>
            <button v-if="memoryEditing" class="memory-header-save" @click="saveMemoryEdit()" :disabled="memorySaving">
              {{ memorySaving ? t('memory.saving') : t('memory.save') }}
            </button>
            <button class="preview-panel-close" @click="monacoEditor.dispose(); filePreview.closePreview(); memoryEditing = false; fileEditing = false" :title="t('preview.closePreview')">&times;</button>
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
            <!-- General file editing (Monaco on desktop, textarea on mobile fallback) -->
            <div v-else-if="fileEditing" class="monaco-edit-container" ref="monacoContainer"></div>
            <!-- Memory editing -->
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
              <div class="preview-binary-icon">
                <svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" opacity="0.4" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></svg>
              </div>
              <p>{{ t('preview.binaryFile') }}</p>
              <p class="preview-binary-meta">{{ previewFile.mimeType }}</p>
              <p class="preview-binary-meta">{{ filePreview.formatFileSize(previewFile.totalSize) }}</p>
            </div>
          </div>
        </div>
        </Transition>
</template>
