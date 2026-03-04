# File Browser Panel — Design Document

## 1. Overview

Add a file browser panel to the AgentLink web UI, allowing users to browse the agent's working directory, view file structure, and interact with files (read via Claude, copy path, insert path into chat input).

The file browser is a **third column** inserted between the existing sidebar and chat area, toggled from the sidebar.

### Goals

- Browse the host filesystem rooted at the current working directory
- Interact with files: ask Claude to read them, copy paths, insert paths into the chat input
- Work well on both desktop and mobile (iPhone)
- Reuse the existing `list_directory` / `directory_listing` WebSocket protocol

### Non-goals

- File editing, uploading, downloading, or deletion
- Terminal / shell access
- Showing file contents inline in the panel

---

## 2. Layout Architecture

### 2.1 Current Layout

```
.layout (flex column, full height)
├── .top-bar (flex-shrink: 0)
└── .main-body (flex row, flex: 1)
    ├── .sidebar (260px, flex-shrink: 0)
    └── .chat-area (flex: 1)
```

### 2.2 Proposed Layout

```
.layout (flex column, full height)
├── .top-bar (flex-shrink: 0)
└── .main-body (flex row, flex: 1)
    ├── .sidebar (260px, flex-shrink: 0)
    ├── .file-panel (280px, flex-shrink: 0, collapsible)
    └── .chat-area (flex: 1)
```

The `.file-panel` is inserted as a sibling between `.sidebar` and `.chat-area` inside `.main-body`. When collapsed, the element is removed from the DOM (`v-if`), and `.chat-area` fills the remaining space automatically via `flex: 1`.

### 2.3 Responsive Breakpoints

| Viewport Width | File Panel Behavior |
|----------------|---------------------|
| **> 1200px** | Full three-column: sidebar (260px) + file panel (280px) + chat |
| **768–1200px** | Three-column with narrower file panel (`clamp(200px, 20vw, 280px)`) |
| **< 768px** | File panel replaces sidebar content (same overlay, view-switching) |

---

## 3. Desktop Behavior (≥ 768px)

### 3.1 Toggle Button

A toggle button is added to the sidebar's `.sidebar-workdir-header` row, alongside the existing "Change directory" button:

```
Working Directory         [🗂] [📁]
                           ^     ^
                     browse-files  change-dir (existing)
```

The new button uses a file-tree / list SVG icon. Tooltip: "Browse files". It toggles the `filePanelOpen` ref.

Both buttons use the existing `.sidebar-change-dir-btn` styling pattern (small icon button, hover highlight).

### 3.2 File Panel Structure

```
.file-panel
├── .file-panel-header (sticky)
│   ├── .file-panel-title ("Files")
│   └── .file-panel-actions
│       └── .file-panel-refresh-btn (reload expanded directories)
├── .file-panel-breadcrumb (current workdir path, truncated with ellipsis)
└── .file-tree (scrollable, flex: 1, overflow-y: auto)
    ├── .file-tree-item (folder, depth 0)
    │   ├── .file-tree-item (file, depth 1)
    │   ├── .file-tree-item (folder, depth 1)
    │   │   └── ... (lazy-loaded children)
    │   └── ...
    └── ...
```

### 3.3 File Panel Styling

- Background: `var(--bg-primary)` — slightly different from sidebar's `var(--bg-secondary)` for visual separation
- Right border: `1px solid var(--border)`
- Monospace font for file names: `'SF Mono', 'Fira Code', Consolas, monospace` at `0.8rem`
- Header is `position: sticky; top: 0; z-index: 1` to remain visible while scrolling

### 3.4 Collapse/Expand Animation

Use Vue's `<Transition>` component wrapping the file panel, with CSS classes that animate `width` from `0` to `280px` and `opacity` from `0` to `1` over `0.2s ease`. The panel uses `v-if` for clean DOM removal.

```css
.file-panel-enter-active,
.file-panel-leave-active {
  transition: width 0.2s ease, opacity 0.2s ease;
  overflow: hidden;
}
.file-panel-enter-from,
.file-panel-leave-to {
  width: 0;
  opacity: 0;
}
```

---

## 4. Mobile Behavior (< 768px)

On mobile, the sidebar already uses a **fixed overlay** pattern (position fixed, z-index 100, with backdrop). Adding a separate overlay for the file panel would create confusing UX with two overlapping panels.

### 4.1 View-Switching Inside Sidebar

The sidebar switches between two views:

1. **Sessions view** (default) — current sidebar content (workdir, history, footer)
2. **Files view** — file tree browser

The toggle button in the workdir section switches the sidebar to "Files view". A back button at the top of the Files view returns to Sessions view.

```
State: sidebarView = ref('sessions')  // 'sessions' | 'files'
```

When `sidebarView === 'files'`:
- The sidebar shows the file tree (same template structure as the desktop file panel)
- A "← Sessions" button at the top replaces the file panel header
- The sidebar overlay width remains **280px** (same as current)

When a file action is performed (e.g., "Ask Claude to read"), the sidebar closes automatically and `sidebarView` resets to `'sessions'`.

### 4.2 Mobile Template Structure

Since the app uses inline templates (no SFC), this is implemented with `v-if` / `v-else` blocks in the sidebar section of `app.js`:

```html
<!-- Inside .sidebar -->
<template v-if="isMobile && sidebarView === 'files'">
  <div class="sidebar-section file-panel-mobile">
    <div class="file-panel-mobile-header">
      <button @click="sidebarView = 'sessions'">← Sessions</button>
      <button @click="fileBrowser.refreshTree()" title="Refresh">↻</button>
    </div>
    <!-- same file tree template as desktop -->
  </div>
</template>
<template v-else>
  <!-- existing sidebar content (workdir, history, footer) -->
</template>
```

### 4.3 Closing behavior

Closing the sidebar (backdrop tap or toggle button) always resets `sidebarView` to `'sessions'`.

---

## 5. File Tree Data Model

### 5.1 Data Structure

```javascript
// Reactive state
const filePanelOpen = ref(false);
const fileTreeRoot = ref(null);         // root TreeNode
const fileTreeLoading = ref(false);     // loading indicator for root
const fileContextMenu = ref(null);      // { x, y, path, name } for context menu

// TreeNode shape (plain object, reactive via Vue)
{
  path: '/project/src',       // absolute path
  name: 'src',                // display name
  type: 'directory',          // 'directory' | 'file'
  expanded: false,            // folder expanded state
  children: null,             // null = not loaded, [] = loaded & empty
  loading: false,             // waiting for directory_listing response
}
```

### 5.2 Lazy Loading

1. **Panel opens**: Send `list_directory` with `dirPath = workDir` to load root directory children. Populate `fileTreeRoot.children` from response.
2. **Folder expand**: If `node.children === null`, send `list_directory` for that folder's path, set `node.loading = true`. On response, populate `node.children`, set `node.loading = false`, set `node.expanded = true`.
3. **Folder collapse**: Set `node.expanded = false`. Children remain cached in memory (no re-fetch on re-expand unless user explicitly refreshes).

### 5.3 Protocol Reuse and Routing

The existing `list_directory` / `directory_listing` WebSocket messages are reused. However, the current `directory_listing` handler in `connection.js` (line 707–712) is owned by the folder picker — it filters entries to directories only:

```javascript
// Current behavior (connection.js)
folderPickerEntries.value = (msg.entries || [])
  .filter(e => e.type === 'directory')
  .sort((a, b) => a.name.localeCompare(b.name));
```

The file browser needs both files and directories, and responses must be routed to the correct consumer.

**Solution — `source` field routing**: Add a `source` field to `list_directory` requests:

```json
{ "type": "list_directory", "dirPath": "/project/src", "source": "file_browser" }
```

The agent echoes `source` in the `directory_listing` response. The web client routes:

- `source === 'file_browser'` → file browser module handles it
- No `source` field (or any other value) → existing folder picker logic (backward compatible)

The agent's `listDirectoryEntries()` already returns both files and directories sorted (directories first, alphabetical). The folder picker's directory-only filtering happens client-side, so no agent-side filtering changes are needed.

### 5.4 Pending Request Routing

Since `list_directory` / `directory_listing` is request-response without a request ID, concurrent requests for different directories could arrive out of order.

**Solution**: Use a `Map<dirPath, TreeNode>` to track which tree node is awaiting a response. When a `directory_listing` arrives with `source: 'file_browser'`, look up `dirPath` in the map, populate that node's `children`, and remove from the map. The `dirPath` in the response is an absolute resolved path, serving as a unique key.

### 5.5 Hidden Files and Filtering

The current `listDirectoryEntries()` skips dotfiles (`.name.startsWith('.')`) and `node_modules`. This is appropriate for the file browser. A future enhancement could add a toggle to show hidden files (out of scope).

### 5.6 Sort Order

Agent already sorts entries: directories first, then files, both alphabetically (case-insensitive via `localeCompare`). No additional client-side sorting needed.

---

## 6. File Actions Context Menu

### 6.1 Trigger

Clicking a **file** (non-directory) item in the tree shows a small floating context menu adjacent to the clicked item.

### 6.2 Menu Items

| Action | Label | Behavior |
|--------|-------|----------|
| Read file | "Ask Claude to read" | Set `inputText = "Read the file <absolute-path>"`, call `sendMessage()` |
| Copy path | "Copy path" | `navigator.clipboard.writeText(absolutePath)`, show brief "Copied!" feedback |
| Insert path | "Insert path to input" | Insert `absolutePath` at cursor position in chat textarea |

### 6.3 Menu Behavior

- **Positioning**: Fixed-position `div` at click coordinates. If near the bottom of the viewport, the menu opens upward.
- **Single menu**: Only one menu at a time. Clicking a different file replaces the current menu.
- **Dismiss**: clicking anywhere outside, pressing `Escape`, or scrolling the file tree all close the menu.
- **Styling**: Same visual language as existing UI elements (dark surface, subtle border, shadow).

### 6.4 Action Details

**"Ask Claude to read":**
1. Set `inputText.value` to `Read the file <path>`
2. Call `sendMessage()` to submit immediately
3. Close the menu
4. On mobile: close the sidebar, reset `sidebarView` to `'sessions'`

**"Copy path":**
1. `navigator.clipboard.writeText(absolutePath)`
2. Brief visual feedback: the menu item text changes to "Copied!" for 1.5s
3. Close the menu after feedback

**"Insert path to input":**
1. Insert the path string into `inputText.value` at the current cursor position (or append if no cursor)
2. Focus the input textarea
3. Close the menu
4. On mobile: close the sidebar, reset `sidebarView` to `'sessions'`

```javascript
// Insert path implementation
const textarea = inputRef.value;
if (textarea) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = inputText.value;
  inputText.value = text.slice(0, start) + node.path + text.slice(end);
  nextTick(() => {
    const newPos = start + node.path.length;
    textarea.setSelectionRange(newPos, newPos);
    textarea.focus();
  });
}
```

---

## 7. File Tree Rendering

Since Vue 3 CDN (setup API without SFC) doesn't support recursive components easily, use a **flattened list** approach:

1. Compute a `flattenedTree` computed property that walks the tree and produces a flat array of `{ node, depth }` objects, only including children of expanded folders.
2. Render with a single `v-for`:

```html
<div
  v-for="item in flattenedTree" :key="item.node.path"
  class="file-tree-item"
  :class="{ folder: item.node.type === 'directory' }"
  :style="{ paddingLeft: (item.depth * 16 + 8) + 'px' }"
  @click="item.node.type === 'directory'
    ? fileBrowser.toggleFolder(item.node)
    : fileBrowser.onFileClick($event, item.node)"
>
  <span v-if="item.node.type === 'directory'" class="file-tree-arrow"
        :class="{ expanded: item.node.expanded }">▶</span>
  <span v-else class="file-tree-file-icon">
    <svg><!-- generic file icon --></svg>
  </span>
  <span class="file-tree-name" :title="item.node.path">{{ item.node.name }}</span>
  <span v-if="item.node.loading" class="file-tree-spinner"></span>
</div>
```

- **Indentation**: `padding-left: (depth * 16 + 8)px`
- **Directory arrow**: `▶` rotated 90° via CSS `transform: rotate(90deg)` when `.expanded`, using `transition: transform 0.15s ease`
- **File icon**: generic file SVG. Extension-based icons are out of scope for v1
- **Loading**: Small spinner replacing the arrow while `node.loading` is `true`
- **Empty directories**: Show "(empty)" placeholder text in italic below the expanded folder
- **Long file names**: `text-overflow: ellipsis`, full path in `title` attribute

---

## 8. New Module: `fileBrowser.js`

Following the existing factory pattern (`createSidebar`, `createStreaming`, etc.), create a new module.

**File**: `server/web/modules/fileBrowser.js`

```javascript
export function createFileBrowser(deps) {
  // deps: wsSend, workDir, inputText, inputRef, sendMessage,
  //        filePanelOpen, fileTreeRoot, fileTreeLoading, fileContextMenu,
  //        sidebarOpen, sidebarView

  // Internal state
  // - pendingRequests: Map<dirPath, TreeNode> for routing responses

  return {
    openPanel,              // Open file panel + load root if needed
    closePanel,             // Close file panel
    togglePanel,            // Toggle open/close
    toggleFolder,           // Expand/collapse a folder node
    onFileClick,            // Show context menu for a file
    closeContextMenu,       // Dismiss context menu
    askClaudeRead,          // Action: send read prompt
    copyPath,               // Action: copy to clipboard
    insertPath,             // Action: insert into input
    refreshTree,            // Re-fetch all expanded directories
    handleDirectoryListing, // Process incoming directory_listing responses
    onWorkdirChanged,       // Reset tree when workdir changes
    flattenedTree,          // Computed: flat array for v-for rendering
  };
}
```

### 8.1 Integration Points

| Where | What |
|-------|------|
| `app.js` — `setup()` | Create `fileBrowser` instance, add reactive state refs, expose to template |
| `app.js` — template | Add `.file-panel` column between `</aside>` and `.chat-area` |
| `app.js` — template | Add toggle button in `.sidebar-workdir-header` |
| `app.js` — template | Add mobile view-switching in sidebar |
| `app.js` — template | Add context menu div at end of template |
| `connection.js` — `ws.onmessage` | Route `directory_listing` with `source: 'file_browser'` to `fileBrowser.handleDirectoryListing()` |
| `connection.js` — `workdir_changed` | Call `fileBrowser.onWorkdirChanged()` |
| `connection.js` — `createConnection(deps)` | Accept `fileBrowser` in deps |
| `style.css` | Add file panel, file tree, context menu, responsive styles |
| `agent/src/connection.ts` | Echo `source` field in `handleListDirectory()` |

### 8.2 Connection.js Routing Change

Update the `directory_listing` handler to route based on `source`:

```javascript
} else if (msg.type === 'directory_listing') {
  if (msg.source === 'file_browser') {
    fileBrowser.handleDirectoryListing(msg);
  } else {
    // Existing folder picker logic (unchanged)
    folderPickerLoading.value = false;
    folderPickerEntries.value = (msg.entries || [])
      .filter(e => e.type === 'directory')
      .sort((a, b) => a.name.localeCompare(b.name));
    if (msg.dirPath != null) folderPickerPath.value = msg.dirPath;
  }
}
```

---

## 9. Agent-Side Changes

Minimal changes required in `agent/src/connection.ts`.

### 9.1 Pass-through `source` field

In `handleListDirectory`, forward the `source` field from the request into the response:

```typescript
// Before
send({ type: 'directory_listing', dirPath: resolved, entries });

// After
send({ type: 'directory_listing', dirPath: resolved, entries, source: msg.source });
```

Apply this to all three `send()` calls in `handleListDirectory()` (Windows drives, Unix root, and normal directory).

This is the **only** agent-side change. The `listDirectoryEntries` function already returns both files and directories, and the filtering (directories only for folder picker) happens client-side.

### 9.2 Type update

Add `source?: string` to the `handleListDirectory` parameter type:

```typescript
async function handleListDirectory(msg: { dirPath: string; source?: string }): Promise<void> {
```

---

## 10. CSS Additions

### 10.1 File Panel

```css
/* ── File Browser Panel ── */
.file-panel {
  width: 280px;
  flex-shrink: 0;
  background: var(--bg-primary);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.file-panel-header {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem;
  border-bottom: 1px solid var(--border);
  background: var(--bg-primary);
}

.file-panel-title {
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
}

.file-panel-breadcrumb {
  padding: 0.5rem 0.75rem;
  font-size: 0.75rem;
  font-family: 'SF Mono', 'Fira Code', Consolas, monospace;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-tree {
  flex: 1;
  overflow-y: auto;
  padding: 0.25rem 0;
}
```

### 10.2 Tree Items

```css
.file-tree-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  font-size: 0.8rem;
  font-family: 'SF Mono', 'Fira Code', Consolas, monospace;
  color: var(--text-primary);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

.file-tree-item:hover {
  background: var(--bg-tertiary);
}

.file-tree-arrow {
  flex-shrink: 0;
  width: 14px;
  text-align: center;
  font-size: 0.7rem;
  color: var(--text-secondary);
  transition: transform 0.15s ease;
  display: inline-block;
}

.file-tree-arrow.expanded {
  transform: rotate(90deg);
}

.file-tree-name {
  overflow: hidden;
  text-overflow: ellipsis;
}
```

### 10.3 Context Menu

```css
.file-context-menu {
  position: fixed;
  z-index: 200;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  padding: 4px 0;
  min-width: 200px;
}

.file-context-item {
  padding: 8px 12px;
  font-size: 0.8rem;
  cursor: pointer;
  color: var(--text-primary);
}

.file-context-item:hover {
  background: var(--bg-tertiary);
}
```

### 10.4 Responsive Rules

```css
@media (max-width: 1200px) and (min-width: 769px) {
  .file-panel {
    width: clamp(200px, 20vw, 280px);
  }
}

@media (max-width: 768px) {
  .file-panel {
    display: none; /* File browsing handled inside sidebar overlay */
  }
}
```

### 10.5 Transition Animation

```css
.file-panel-enter-active,
.file-panel-leave-active {
  transition: width 0.2s ease, opacity 0.15s ease;
  overflow: hidden;
}
.file-panel-enter-from,
.file-panel-leave-to {
  width: 0;
  opacity: 0;
}
```

---

## 11. State Management

### 11.1 New Reactive Refs (in `app.js` setup())

| Ref | Type | Default | Purpose |
|-----|------|---------|---------|
| `filePanelOpen` | `boolean` | `false` | File panel visibility (desktop) |
| `fileTreeRoot` | `object\|null` | `null` | Root tree node with children |
| `fileTreeLoading` | `boolean` | `false` | Root loading indicator |
| `fileContextMenu` | `object\|null` | `null` | `{ x, y, path, name }` for context menu |
| `sidebarView` | `string` | `'sessions'` | Mobile sidebar view mode: `'sessions' \| 'files'` |

### 11.2 Computed Properties

| Computed | Source | Purpose |
|----------|--------|---------|
| `flattenedTree` | `fileBrowser.js` | Walks `fileTreeRoot` recursively, produces `[{ node, depth }]` for `v-for` |
| `isMobile` | `app.js` | `window.innerWidth <= 768`, updated on resize event |

### 11.3 Watchers

| Watch | Effect |
|-------|--------|
| `workDir` changes | Call `fileBrowser.onWorkdirChanged()` — clears tree, reloads if panel open |
| `filePanelOpen` → `true` | Send `list_directory` for current `workDir` (if tree not already loaded) |
| `filePanelOpen` changes | Persist to `localStorage` key `agentlink-file-panel-open` |

### 11.4 Conversation Switching

The file panel state is **global** — it does not change per conversation. The file tree reflects the current working directory, which is shared across all conversations. This is intentional: the file browser aids navigation of the host filesystem, not conversation-specific state.

### 11.5 Panel State Persistence

`filePanelOpen` is persisted to `localStorage` so it survives page refreshes:

```javascript
const stored = localStorage.getItem('agentlink-file-panel-open');
const filePanelOpen = ref(stored === 'true');
watch(filePanelOpen, (v) => localStorage.setItem('agentlink-file-panel-open', String(v)));
```

The tree expansion state is **not** persisted — the tree reloads from scratch on page refresh.

---

## 12. Edge Cases

| Scenario | Handling |
|----------|----------|
| **Large directories** (100+ entries) | Render all entries. No virtualization for v1 — acceptable for up to ~500 items in a flat list. |
| **Permission errors** | `directory_listing` with `error` field → show error text inline under the folder node |
| **Rapid expand/collapse** | `loading` flag prevents duplicate requests. Collapsing while loading keeps visual clean; cached children populate on response. |
| **Workdir change while panel open** | Tree resets (`fileTreeRoot = null`) and root of new workdir is re-fetched |
| **Agent disconnect** | Panel stays visible but non-interactive. Reconnection restores functionality. |
| **Empty directories** | Show "(empty)" placeholder text in italic |
| **Long file names** | `text-overflow: ellipsis; white-space: nowrap` with full path in `title` tooltip |
| **Context menu overflow** | If menu would extend below viewport, position it upward from the click point |

---

## 13. Files Changed

| File | Changes |
|------|---------|
| `server/web/modules/fileBrowser.js` | **New file** — `createFileBrowser()` factory module |
| `server/web/app.js` | Import module, add refs, instantiate, add template sections (file panel, toggle button, mobile view-switching, context menu), expose in return |
| `server/web/style.css` | Add `.file-panel`, `.file-tree-*`, `.file-context-menu`, responsive rules, transition classes |
| `server/web/modules/connection.js` | Route `directory_listing` by `source` field; accept `fileBrowser` in deps |
| `agent/src/connection.ts` | Echo `source` field in `handleListDirectory()` responses (all three `send()` calls) |

---

## 14. Implementation Order

1. **Agent: pass-through `source` field** — Modify `handleListDirectory` in `agent/src/connection.ts` to include `msg.source` in all `directory_listing` responses. Add `source?: string` to the parameter type.

2. **Module: `fileBrowser.js`** — Create `server/web/modules/fileBrowser.js` with the factory function, tree state management, lazy loading, pending request map, context menu logic, three file actions, `flattenedTree` computed, and `onWorkdirChanged` handler.

3. **CSS: file panel styles** — Add all new CSS to `server/web/style.css`: `.file-panel`, `.file-tree-*`, `.file-context-menu`, responsive breakpoint rules, and Vue transition classes.

4. **App integration** — In `server/web/app.js`:
   - Import and instantiate `createFileBrowser`
   - Add reactive refs (`filePanelOpen`, `sidebarView`, `fileTreeRoot`, `fileTreeLoading`, `fileContextMenu`)
   - Add `isMobile` computed (with resize listener)
   - Add the `.file-panel` column in template (wrapped in `<Transition>`)
   - Add the toggle button to `.sidebar-workdir-header`
   - Add mobile sidebar view-switching (`v-if` / `v-else`)
   - Add context menu div at end of template
   - Expose all methods and refs in return

5. **Connection routing** — In `server/web/modules/connection.js`:
   - Accept `fileBrowser` in `createConnection` deps
   - Route `directory_listing` with `source: 'file_browser'` to `fileBrowser.handleDirectoryListing()`
   - Call `fileBrowser.onWorkdirChanged()` on `workdir_changed`

6. **Testing** — Manual testing:
   - Open/close panel on desktop (animation, chat area resize)
   - Expand/collapse directories (lazy loading, caching)
   - All three file actions
   - Mobile: sidebar view-switching, auto-close on action
   - Workdir change resets tree
   - Page refresh preserves panel open state
   - Large directory rendering
   - Permission error display

---

## 15. Future Enhancements (Out of Scope)

Not part of the initial implementation:

- Show/hide hidden files toggle
- File size and modification date display
- File search/filter within the tree
- Drag-and-drop files into chat input
- File preview (syntax-highlighted) in a modal
- Breadcrumb navigation (clickable path segments)
- Resize handle for the file panel width
- Extension-based file icons
