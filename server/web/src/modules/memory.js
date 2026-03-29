import { computed } from 'vue';

/**
 * Memory management module - handles .claude/memory files
 * Factory pattern: createMemory(deps) → { methods }
 * Refs are owned by store.js and passed in as deps.
 */
export function createMemory(deps) {
  const {
    wsSend, workDir,
    memoryPanelOpen, memoryFiles, memoryDir, memoryLoading,
    memoryEditing, memoryEditContent, memorySaving,
    previewFile, filePreview, isMobile, sidebarView,
    workdirMenuOpen, filePanelOpen, gitPanelOpen, proxyPanelOpen, t,
  } = deps;

  function workdirMenuMemory() {
    workdirMenuOpen.value = false;
    if (isMobile.value) {
      sidebarView.value = 'memory';
    } else {
      memoryPanelOpen.value = !memoryPanelOpen.value;
      if (memoryPanelOpen.value) {
        filePanelOpen.value = false;
        gitPanelOpen.value = false;
        if (proxyPanelOpen) proxyPanelOpen.value = false;
      }
    }
    if (!memoryFiles.value.length) {
      memoryLoading.value = true;
      wsSend({ type: 'list_memory' });
    }
  }

  function refreshMemory() {
    memoryLoading.value = true;
    wsSend({ type: 'list_memory' });
  }

  function openMemoryFile(file) {
    memoryEditing.value = false;
    memoryEditContent.value = '';
    if (memoryDir.value) {
      const sep = memoryDir.value.includes('\\') ? '\\' : '/';
      filePreview.openPreview(memoryDir.value + sep + file.name);
    }
    if (isMobile.value) sidebarView.value = 'preview';
  }

  function startMemoryEdit() {
    memoryEditing.value = true;
    memoryEditContent.value = previewFile.value?.content || '';
  }

  function cancelMemoryEdit() {
    if (memoryEditContent.value !== (previewFile.value?.content || '')) {
      if (!confirm(t('memory.discardChanges'))) return;
    }
    memoryEditing.value = false;
    memoryEditContent.value = '';
  }

  function saveMemoryEdit() {
    if (!previewFile.value) return;
    memorySaving.value = true;
    wsSend({
      type: 'update_memory',
      filename: previewFile.value.fileName,
      content: memoryEditContent.value,
    });
  }

  function deleteMemoryFile(file) {
    if (!confirm(t('memory.deleteConfirm', { name: file.name }))) return;
    wsSend({ type: 'delete_memory', filename: file.name });
  }

  return {
    workdirMenuMemory, refreshMemory, openMemoryFile,
    startMemoryEdit, cancelMemoryEdit, saveMemoryEdit, deleteMemoryFile,
  };
}
