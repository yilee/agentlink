// ── File and memory message handlers ──────────────────────────────────────────

export function createFileHandlers(deps) {
  const {
    folderPickerLoading, folderPickerEntries, folderPickerPath,
    memoryFiles, memoryDir, memoryLoading,
    memoryEditing, memoryEditContent, memorySaving,
    wsSend,
  } = deps;

  return {
    directory_listing(msg) {
      if (msg.source === 'file_browser' && deps.fileBrowser) {
        deps.fileBrowser.handleDirectoryListing(msg);
      } else {
        folderPickerLoading.value = false;
        folderPickerEntries.value = (msg.entries || [])
          .filter(e => e.type === 'directory')
          .sort((a, b) => a.name.localeCompare(b.name));
        if (msg.dirPath != null) folderPickerPath.value = msg.dirPath;
      }
    },
    file_content(msg) {
      if (deps.filePreview) deps.filePreview.handleFileContent(msg);
    },
    memory_list(msg) {
      memoryLoading.value = false;
      memoryFiles.value = msg.files || [];
      memoryDir.value = msg.memoryDir || null;
    },
    memory_updated(msg) {
      memorySaving.value = false;
      if (msg.success) {
        memoryEditing.value = false;
        memoryEditContent.value = '';
        wsSend({ type: 'list_memory' });
        if (deps.filePreview) deps.filePreview.refreshPreview();
      }
    },
    memory_deleted(msg) {
      if (msg.success) {
        memoryFiles.value = memoryFiles.value.filter(f => f.name !== msg.filename);
        if (deps.filePreview) deps.filePreview.closePreview();
      }
    },
    file_updated(msg) {
      if (deps.filePreview) deps.filePreview.handleFileUpdated(msg);
    },
    file_created(msg) {
      if (deps.newItemInput) deps.newItemInput.value = null;
      if (msg.success) {
        // Refresh the file tree
        if (deps.fileBrowser) deps.fileBrowser.refreshTree();
        // Open the new file in preview and enter edit mode
        if (deps.filePreview && msg.filePath) {
          deps.filePreview.openPreview(msg.filePath);
        }
      } else {
        if (deps.showToast) deps.showToast(msg.error || 'Create failed', { type: 'error' });
      }
    },
    directory_created(msg) {
      if (deps.newItemInput) deps.newItemInput.value = null;
      if (msg.success) {
        // Refresh the file tree
        if (deps.fileBrowser) deps.fileBrowser.refreshTree();
      } else {
        if (deps.showToast) deps.showToast(msg.error || 'Create failed', { type: 'error' });
      }
    },
  };
}
