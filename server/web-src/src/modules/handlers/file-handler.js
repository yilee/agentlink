// ── File and memory message handlers ──────────────────────────────────────────

export function createFileHandlers(deps) {
  const {
    folderPickerLoading, folderPickerEntries, folderPickerPath,
    memoryFiles, memoryDir, memoryLoading,
    memoryEditing, memoryEditContent, memorySaving,
    wsSend, fileBrowser, filePreview,
  } = deps;

  return {
    directory_listing(msg) {
      if (msg.source === 'file_browser' && fileBrowser) {
        fileBrowser.handleDirectoryListing(msg);
      } else {
        folderPickerLoading.value = false;
        folderPickerEntries.value = (msg.entries || [])
          .filter(e => e.type === 'directory')
          .sort((a, b) => a.name.localeCompare(b.name));
        if (msg.dirPath != null) folderPickerPath.value = msg.dirPath;
      }
    },
    file_content(msg) {
      if (filePreview) filePreview.handleFileContent(msg);
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
        if (filePreview) filePreview.refreshPreview();
      }
    },
    memory_deleted(msg) {
      if (msg.success) {
        memoryFiles.value = memoryFiles.value.filter(f => f.name !== msg.filename);
        if (filePreview) filePreview.closePreview();
      }
    },
  };
}
