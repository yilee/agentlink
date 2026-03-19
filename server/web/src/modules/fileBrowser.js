// ── File Browser: tree state, lazy loading, context menu, file actions ────────
import { computed, nextTick } from 'vue';

/**
 * Creates the file browser controller.
 * @param {object} deps - Reactive state and callbacks
 */
export function createFileBrowser(deps) {
  const {
    wsSend, workDir, inputText, inputRef,
    filePanelOpen, fileTreeRoot, fileTreeLoading, fileContextMenu,
    sidebarOpen, sidebarView, filePanelWidth,
    newItemInput, requireVersion, t, previewFile, closePreview,
  } = deps;

  // Map of dirPath → TreeNode awaiting directory_listing response
  const pendingRequests = new Map();

  // ── Tree helpers ──

  function buildPath(parentPath, name) {
    if (!parentPath) return name;
    const sep = parentPath.includes('\\') ? '\\' : '/';
    return parentPath.replace(/[/\\]$/, '') + sep + name;
  }

  function makeNode(entry, parentPath) {
    return {
      path: buildPath(parentPath, entry.name),
      name: entry.name,
      type: entry.type,
      expanded: false,
      children: entry.type === 'directory' ? null : undefined,
      loading: false,
      error: null,
    };
  }

  // ── Flattened tree for rendering ──

  const flattenedTree = computed(() => {
    const root = fileTreeRoot.value;
    if (!root || !root.children) return [];
    const result = [];
    function walk(children, depth) {
      for (const node of children) {
        result.push({ node, depth });
        if (node.type === 'directory' && node.expanded && node.children) {
          walk(node.children, depth + 1);
        }
      }
    }
    walk(root.children, 0);
    return result;
  });

  // ── Panel open/close ──

  function openPanel() {
    filePanelOpen.value = true;
    if (!fileTreeRoot.value || fileTreeRoot.value.path !== workDir.value) {
      loadRoot();
    }
  }

  function closePanel() {
    filePanelOpen.value = false;
    closeContextMenu();
  }

  function togglePanel() {
    if (filePanelOpen.value) {
      closePanel();
    } else {
      openPanel();
    }
  }

  // ── Loading ──

  function loadRoot() {
    const dir = workDir.value;
    if (!dir) return;
    fileTreeLoading.value = true;
    fileTreeRoot.value = {
      path: dir,
      name: dir,
      type: 'directory',
      expanded: true,
      children: null,
      loading: true,
      error: null,
    };
    pendingRequests.set(dir, fileTreeRoot.value);
    wsSend({ type: 'list_directory', dirPath: dir, source: 'file_browser' });
  }

  function loadDirectory(node) {
    if (node.loading) return;
    node.loading = true;
    node.error = null;
    pendingRequests.set(node.path, node);
    wsSend({ type: 'list_directory', dirPath: node.path, source: 'file_browser' });
  }

  // ── Folder expand/collapse ──

  function toggleFolder(node) {
    if (node.type !== 'directory') return;
    if (node.expanded) {
      node.expanded = false;
      closeContextMenu();
    } else {
      node.expanded = true;
      if (node.children === null) {
        loadDirectory(node);
      }
    }
  }

  // ── Handle directory_listing response ──

  function handleDirectoryListing(msg) {
    const dirPath = msg.dirPath;
    const node = pendingRequests.get(dirPath);
    pendingRequests.delete(dirPath);

    // Check if this is the root loading
    if (fileTreeRoot.value && fileTreeRoot.value.path === dirPath) {
      fileTreeLoading.value = false;
    }

    if (!node) {
      // No pending request for this path — could be a stale response after
      // workdir change. Try to find the node in the tree by path.
      const found = findNodeByPath(dirPath);
      if (found) {
        applyListing(found, msg);
      }
      return;
    }

    applyListing(node, msg);
  }

  function applyListing(node, msg) {
    node.loading = false;
    if (msg.error) {
      node.error = msg.error;
      node.children = [];
      return;
    }
    const entries = msg.entries || [];
    node.children = entries.map(e => makeNode(e, node.path));
    node.expanded = true;
  }

  function findNodeByPath(targetPath) {
    const root = fileTreeRoot.value;
    if (!root) return null;
    if (root.path === targetPath) return root;
    if (!root.children) return null;
    function search(children) {
      for (const node of children) {
        if (node.path === targetPath) return node;
        if (node.type === 'directory' && node.children) {
          const found = search(node.children);
          if (found) return found;
        }
      }
      return null;
    }
    return search(root.children);
  }

  // ── Refresh ──

  function refreshTree() {
    if (!fileTreeRoot.value) {
      loadRoot();
      return;
    }
    // Re-fetch all expanded directories
    refreshNode(fileTreeRoot.value);
  }

  function refreshNode(node) {
    if (node.type !== 'directory') return;
    if (node.expanded && node.children !== null) {
      // Re-fetch this directory
      node.children = null;
      loadDirectory(node);
    }
    // Note: children of this node will be re-fetched when loadDirectory
    // completes and rebuilds the children array. No need to recurse.
  }

  // ── Workdir changed ──

  function onWorkdirChanged() {
    pendingRequests.clear();
    fileTreeRoot.value = null;
    fileTreeLoading.value = false;
    closeContextMenu();
    if (filePanelOpen.value) {
      loadRoot();
    }
  }

  // ── Context menu ──

  function onFileClick(event, node) {
    event.stopPropagation();

    // Position the menu near the click, adjusting for viewport edges
    let x = event.clientX;
    let y = event.clientY;
    const menuWidth = 220;
    const menuHeight = node.type === 'directory' ? 80 : 120; // fewer items for folders
    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth - 8;
    }
    if (y + menuHeight > window.innerHeight) {
      y = y - menuHeight;
    }
    if (x < 0) x = 8;
    if (y < 0) y = 8;

    fileContextMenu.value = {
      x,
      y,
      path: node.path,
      name: node.name,
      isDirectory: node.type === 'directory',
    };
  }

  function closeContextMenu() {
    fileContextMenu.value = null;
  }

  // ── File actions ──

  function askClaudeRead() {
    const menu = fileContextMenu.value;
    if (!menu) return;
    const path = menu.path;
    closeContextMenu();
    inputText.value = `Read the file ${path}`;
    // Close sidebar on mobile
    if (window.innerWidth <= 768) {
      sidebarOpen.value = false;
      sidebarView.value = 'sessions';
    }
    nextTick(() => {
      if (inputRef.value) inputRef.value.focus();
    });
  }

  function copyToClipboard(text) {
    // Use ClipboardItem with explicit text/plain to prevent Chrome (especially
    // mobile) from URL-encoding paths that look like URL schemes (e.g. Q:\...)
    if (navigator.clipboard && window.ClipboardItem) {
      const blob = new Blob([text], { type: 'text/plain' });
      const item = new ClipboardItem({ 'text/plain': blob });
      return navigator.clipboard.write([item]);
    }
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    return Promise.resolve();
  }

  function copyPath() {
    const menu = fileContextMenu.value;
    if (!menu) return;
    const path = menu.path;
    copyToClipboard(path).catch(() => {});
    // Brief "Copied!" feedback — store temporarily in menu state
    fileContextMenu.value = { ...menu, copied: true };
    setTimeout(() => {
      closeContextMenu();
    }, 1000);
  }

  function insertPath() {
    const menu = fileContextMenu.value;
    if (!menu) return;
    const path = menu.path;
    closeContextMenu();
    const textarea = inputRef.value;
    if (textarea) {
      const start = textarea.selectionStart || inputText.value.length;
      const end = textarea.selectionEnd || inputText.value.length;
      const text = inputText.value;
      inputText.value = text.slice(0, start) + path + text.slice(end);
      nextTick(() => {
        const newPos = start + path.length;
        textarea.setSelectionRange(newPos, newPos);
        textarea.focus();
      });
    } else {
      inputText.value += path;
    }
    // Close sidebar on mobile
    if (window.innerWidth <= 768) {
      sidebarOpen.value = false;
      sidebarView.value = 'sessions';
    }
  }

  // ── Global click handler for dismissing context menu ──

  function setupGlobalListeners() {
    document.addEventListener('click', (e) => {
      if (!fileContextMenu.value) return;
      const menuEl = document.querySelector('.file-context-menu');
      if (menuEl && menuEl.contains(e.target)) return;
      closeContextMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && fileContextMenu.value) {
        closeContextMenu();
      }
    });
  }

  // ── Resize handle (mouse + touch) ──

  let _resizing = false;
  let _startX = 0;
  let _startWidth = 0;
  const MIN_WIDTH = 160;
  const MAX_WIDTH = 600;

  function onResizeStart(e) {
    e.preventDefault();
    _resizing = true;
    _startX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
    _startWidth = filePanelWidth.value;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    if (e.type === 'touchstart') {
      document.addEventListener('touchmove', onResizeMove, { passive: false });
      document.addEventListener('touchend', onResizeEnd);
    } else {
      document.addEventListener('mousemove', onResizeMove);
      document.addEventListener('mouseup', onResizeEnd);
    }
  }

  function onResizeMove(e) {
    if (!_resizing) return;
    if (e.type === 'touchmove') e.preventDefault();
    const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
    const delta = clientX - _startX;
    const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, _startWidth + delta));
    filePanelWidth.value = newWidth;
  }

  function onResizeEnd() {
    if (!_resizing) return;
    _resizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeEnd);
    document.removeEventListener('touchmove', onResizeMove);
    document.removeEventListener('touchend', onResizeEnd);
    localStorage.setItem('agentlink-file-panel-width', String(filePanelWidth.value));
  }

  // ── Create new file / folder ──

  function startNewFile(dirPath) {
    if (requireVersion && !requireVersion('0.1.114', 'Create File')) return;
    closeContextMenu();
    newItemInput.value = { type: 'file', dirPath, name: '' };
  }

  function startNewFolder(dirPath) {
    if (requireVersion && !requireVersion('0.1.114', 'Create Folder')) return;
    closeContextMenu();
    newItemInput.value = { type: 'folder', dirPath, name: '' };
  }

  function confirmNewItem(name) {
    if (!newItemInput.value || !name.trim()) return;
    const { type, dirPath } = newItemInput.value;
    if (type === 'file') {
      wsSend({ type: 'create_file', dirPath, fileName: name.trim() });
    } else {
      wsSend({ type: 'create_directory', dirPath, dirName: name.trim() });
    }
  }

  function cancelNewItem() {
    newItemInput.value = null;
  }

  // ── Delete file / folder ──

  function deleteItem(path, name, isDirectory) {
    if (requireVersion && !requireVersion('0.1.114', 'Delete File')) return;
    closeContextMenu();
    const msg = isDirectory
      ? (t ? t('file.confirmDeleteFolder', { name }) : `Delete folder "${name}" and all its contents?`)
      : (t ? t('file.confirmDelete', { name }) : `Delete "${name}"?`);
    if (!window.confirm(msg)) return;
    wsSend({ type: 'delete_file', filePath: path });
  }

  function handleFileDeleted(msg) {
    if (msg.success) {
      refreshTree();
      // Close preview if the deleted file/folder was being previewed
      if (previewFile && previewFile.value && closePreview) {
        const previewPath = previewFile.value.filePath;
        const deletedPath = msg.filePath;
        if (previewPath === deletedPath || previewPath.startsWith(deletedPath + '/') || previewPath.startsWith(deletedPath + '\\')) {
          closePreview();
        }
      }
    }
  }

  // Set up listeners immediately
  setupGlobalListeners();

  return {
    openPanel,
    closePanel,
    togglePanel,
    toggleFolder,
    onFileClick,
    closeContextMenu,
    askClaudeRead,
    copyPath,
    copyToClipboard,
    insertPath,
    refreshTree,
    handleDirectoryListing,
    onWorkdirChanged,
    flattenedTree,
    onResizeStart,
    startNewFile,
    startNewFolder,
    confirmNewItem,
    cancelNewItem,
    deleteItem,
    handleFileDeleted,
  };
}
