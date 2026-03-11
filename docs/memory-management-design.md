# Memory Management — Design Document

## 1. Overview

Add a Memory management feature to the AgentLink web UI, allowing users to view, edit, and delete Claude's auto memory files directly from the browser.

Claude Code's auto memory stores learned facts (project conventions, user preferences, debugging insights) in Markdown files under `~/.claude/projects/<project>/memory/`. These files are automatically loaded into Claude's context on every session. Currently, users can only manage them through the Claude CLI (`/memory` command) or by editing files on disk.

### Goals

- View a list of memory files for the current working directory's project
- Preview memory file contents with rendered Markdown
- Edit memory files inline (textarea with Save/Cancel)
- Delete individual memory files
- Access the feature from the working directory dropdown menu in the sidebar

### Non-goals

- Creating new memory files from scratch (Claude manages this automatically)
- Editing the global `~/.claude/CLAUDE.md` (different scope)
- Parsing individual `##` sections as separate entries (treat each file as a unit)
- Real-time sync with Claude's writes (read-on-open is sufficient)

### Prerequisites

- **i18n system** — The web UI now uses a lightweight `t()` translation function (see `docs/i18n-design.md`). All user-facing strings in the memory feature must use `t()` with keys defined in both `server/web/locales/en.json` and `server/web/locales/zh.json`.

---

## 2. Claude Auto Memory Background

### Storage Location

```
~/.claude/projects/<project-folder>/memory/
├── MEMORY.md          # Main index, loaded into every session (first 200 lines)
├── debugging.md       # Optional topic file
├── patterns.md        # Optional topic file
└── ...
```

### Project Folder Derivation

Working directory path is converted using the same logic as session history:
- Non-alphanumeric characters → `-`
- Example: `Q:\src\agentlink` → `Q--src-agentlink`
- Long paths (>200 chars): truncated with hash suffix

This logic already exists in `agent/src/history.ts` → `pathToProjectFolder()`.

### File Format

Plain Markdown files. Claude structures them with `##` headings to separate topics. Files are typically small (< 10 KB).

### Availability

Introduced in Claude Code 2.1.59. Auto memory is enabled by default and can be disabled via `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` or the `/memory` CLI command.

---

## 3. UI Design

### 3.1 Entry Point: Working Directory Menu

Add a fourth item to the existing working directory dropdown menu (after "Copy path"):

```
┌────────────────────┐
│ 📁 Browse files    │  ← t('sidebar.browseFiles')
│ 📂 Change directory│  ← t('sidebar.changeDirectory')
│ 📋 Copy path       │  ← t('sidebar.copyPath')
│ 🧠 Memory          │  ← t('sidebar.memory')  — new
└────────────────────┘
```

Clicking "Memory" opens the file browser sidebar panel (same as "Browse files") but scoped to memory files only.

### 3.2 Memory File List in Sidebar

Reuse the existing file browser panel (`.file-panel`) pattern but with a dedicated memory view:

```
┌──────────────────────┐
│  Memory         ✕  ↻ │  ← header: t('memory.title'), close & refresh
│──────────────────────│
│  📄 MEMORY.md        │  ← click to preview
│  📄 debugging.md     │
│  📄 patterns.md      │
│──────────────────────│
│  (empty state:       │
│   t('memory.noFiles'))│
└──────────────────────┘
```

On mobile, this replaces the sidebar content (same as file browser mobile behavior via `sidebarView`).

### 3.3 Preview Panel with Edit

Clicking a memory file opens the existing preview panel (`.preview-panel`) on the right. Since all memory files are Markdown, the preview renders Markdown by default.

The preview panel header gets an **Edit** button (pencil icon) when displaying a memory file:

```
┌─────────────────────────────────────────┐
│  MEMORY.md    ✎  M  1.3 KB         ✕   │  ← ✎ = Edit button (new)
│─────────────────────────────────────────│  ← M = Markdown toggle (existing)
│                                         │
│  # AgentLink Project Memory             │  ← rendered Markdown
│                                         │
│  ## Local Service Deployment            │
│  When asked to deploy a local service   │
│  for testing, use these commands: ...   │
│                                         │
└─────────────────────────────────────────┘
```

Clicking **Edit** switches to edit mode:

```
┌─────────────────────────────────────────┐
│  Editing: MEMORY.md                 ✕   │
│─────────────────────────────────────────│
│ ┌─────────────────────────────────────┐ │
│ │ # AgentLink Project Memory          │ │  ← textarea
│ │                                     │ │
│ │ ## Local Service Deployment         │ │
│ │ When asked to deploy...             │ │
│ └─────────────────────────────────────┘ │
│                         Cancel   Save   │
│─────────────────────────────────────────│
│  🗑 Delete this file                    │  ← delete action
└─────────────────────────────────────────┘
```

### 3.4 Edit Mode Behavior

| Action | Behavior |
|--------|----------|
| **Save** | Send `update_memory` to agent, show brief success feedback, return to preview |
| **Cancel** | Discard changes, return to preview |
| **Delete** | Confirmation dialog (t('memory.deleteConfirm', { name })), then send `delete_memory` |
| **Escape key** | Same as Cancel |
| **Close (✕)** | If unsaved changes, prompt "Discard changes?"; otherwise close |

### 3.5 Detecting Memory Files

The preview panel needs to know whether the displayed file is a memory file (to show the Edit button). Detection is based on the file path:

```javascript
function isMemoryFile(filePath) {
  return filePath && filePath.replace(/\\/g, '/').includes('/.claude/projects/')
    && filePath.replace(/\\/g, '/').includes('/memory/');
}
```

---

## 4. WebSocket Protocol

### 4.1 `list_memory` (Web → Agent)

```json
{ "type": "list_memory" }
```

### 4.2 `memory_list` (Agent → Web)

```json
{
  "type": "memory_list",
  "memoryDir": "C:/Users/user/.claude/projects/Q--src-agentlink/memory",
  "files": [
    { "name": "MEMORY.md", "size": 1324, "lastModified": 1710000000000 },
    { "name": "debugging.md", "size": 512, "lastModified": 1709999000000 }
  ]
}
```

If the memory directory does not exist, return `{ "type": "memory_list", "memoryDir": null, "files": [] }`.

### 4.3 `update_memory` (Web → Agent)

```json
{
  "type": "update_memory",
  "filename": "MEMORY.md",
  "content": "# Updated content\n\n## Section 1\n..."
}
```

### 4.4 `memory_updated` (Agent → Web)

```json
{
  "type": "memory_updated",
  "filename": "MEMORY.md",
  "success": true
}
```

On error:
```json
{
  "type": "memory_updated",
  "filename": "MEMORY.md",
  "success": false,
  "error": "Permission denied"
}
```

### 4.5 `delete_memory` (Web → Agent)

```json
{
  "type": "delete_memory",
  "filename": "MEMORY.md"
}
```

### 4.6 `memory_deleted` (Agent → Web)

```json
{
  "type": "memory_deleted",
  "filename": "MEMORY.md",
  "success": true
}
```

### 4.7 Reading Memory File Content

**No new message type needed.** Reuse the existing `read_file` / `file_content` protocol. When the user clicks a memory file in the list, the web UI sends:

```json
{
  "type": "read_file",
  "filePath": "C:/Users/user/.claude/projects/Q--src-agentlink/memory/MEMORY.md"
}
```

The agent responds with the standard `file_content` message. The preview panel renders it as usual, but with the additional Edit button because `isMemoryFile(filePath)` returns true.

---

## 5. Agent-Side Implementation

### 5.1 New Module: `agent/src/memory.ts`

```typescript
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';

// Reuse from history.ts
import { pathToProjectFolder } from './history.js';

interface MemoryFileInfo {
  name: string;
  size: number;
  lastModified: number;
}

function getMemoryDir(workDir: string): string {
  const projectsDir = join(homedir(), '.claude', 'projects');
  const projectFolder = pathToProjectFolder(workDir);
  return join(projectsDir, projectFolder, 'memory');
}

export function listMemoryFiles(workDir: string): { memoryDir: string | null; files: MemoryFileInfo[] } {
  const memoryDir = getMemoryDir(workDir);
  if (!existsSync(memoryDir)) {
    return { memoryDir: null, files: [] };
  }
  const files: MemoryFileInfo[] = [];
  for (const name of readdirSync(memoryDir)) {
    if (!name.endsWith('.md')) continue;
    const filePath = join(memoryDir, name);
    try {
      const stats = statSync(filePath);
      if (stats.isFile()) {
        files.push({ name, size: stats.size, lastModified: stats.mtime.getTime() });
      }
    } catch { /* skip */ }
  }
  // Sort: MEMORY.md first, then alphabetical
  files.sort((a, b) => {
    if (a.name === 'MEMORY.md') return -1;
    if (b.name === 'MEMORY.md') return 1;
    return a.name.localeCompare(b.name);
  });
  return { memoryDir, files };
}

export function updateMemoryFile(workDir: string, filename: string, content: string): { success: boolean; error?: string } {
  // Security: reject path traversal
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return { success: false, error: 'Invalid filename' };
  }
  const memoryDir = getMemoryDir(workDir);
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
  }
  try {
    writeFileSync(join(memoryDir, filename), content, 'utf-8');
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export function deleteMemoryFile(workDir: string, filename: string): { success: boolean; error?: string } {
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return { success: false, error: 'Invalid filename' };
  }
  const memoryDir = getMemoryDir(workDir);
  const filePath = join(memoryDir, filename);
  if (!existsSync(filePath)) {
    return { success: false, error: 'File not found' };
  }
  try {
    unlinkSync(filePath);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
```

### 5.2 Export `pathToProjectFolder`

`pathToProjectFolder` in `history.ts` is currently a private function. It needs to be exported so `memory.ts` can reuse it.

### 5.3 Connection Handler (`connection.ts`)

Add three cases to the message dispatch switch:

```typescript
import { listMemoryFiles, updateMemoryFile, deleteMemoryFile } from './memory.js';

case 'list_memory':
  send({ type: 'memory_list', ...listMemoryFiles(state.workDir) });
  break;

case 'update_memory': {
  const result = updateMemoryFile(state.workDir, msg.filename, msg.content);
  send({ type: 'memory_updated', filename: msg.filename, ...result });
  break;
}

case 'delete_memory': {
  const result = deleteMemoryFile(state.workDir, msg.filename);
  send({ type: 'memory_deleted', filename: msg.filename, ...result });
  break;
}
```

---

## 6. Web UI Implementation

### 6.1 State (app.js)

```javascript
// Memory management
const memoryPanelOpen = ref(false);      // sidebar shows memory file list
const memoryFiles = ref([]);             // [{ name, size, lastModified }]
const memoryDir = ref(null);             // absolute path to memory dir (or null)
const memoryLoading = ref(false);        // loading spinner for list
const memoryEditing = ref(false);        // preview panel in edit mode
const memoryEditContent = ref('');       // textarea content during edit
const memorySaving = ref(false);         // save in progress
```

### 6.2 Menu Item (app.js template)

Add to the `workdir-menu` div, after "Copy path":

```html
<div class="workdir-menu-item" @click.stop="workdirMenuMemory()">
  <svg viewBox="0 0 24 24" width="14" height="14">
    <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
  </svg>
  <span>{{ t('sidebar.memory') }}</span>
</div>
```

### 6.3 Menu Handler

```javascript
workdirMenuMemory() {
  workdirMenuOpen.value = false;
  memoryPanelOpen.value = true;
  memoryLoading.value = true;
  // On mobile, switch sidebar view
  if (isMobile.value) { sidebarView.value = 'memory'; }
  wsSend({ type: 'list_memory' });
},
```

### 6.4 Memory File List (sidebar template)

Replace/overlay the file browser panel when `memoryPanelOpen` is true:

```html
<!-- Memory Panel (desktop) -->
<Transition name="file-panel">
<div v-if="memoryPanelOpen && !isMobile" class="file-panel">
  <div class="file-panel-header">
    <span class="file-panel-title">{{ t('memory.title') }}</span>
    <button class="file-panel-btn" @click="refreshMemory()" :title="t('sidebar.refresh')">
      <svg :class="{ spinning: memoryLoading }" ...>...</svg>
    </button>
    <button class="file-panel-btn" @click="memoryPanelOpen = false" :title="t('sidebar.close')">&times;</button>
  </div>
  <div class="file-tree">
    <div v-if="memoryLoading" class="file-tree-loading">{{ t('memory.loading') }}</div>
    <div v-else-if="memoryFiles.length === 0" class="memory-empty">
      {{ t('memory.noFiles') }}<br>
      {{ t('memory.noFilesHint') }}
    </div>
    <div v-else v-for="file in memoryFiles" :key="file.name"
         class="file-tree-item" style="padding-left: 12px"
         @click="openMemoryFile(file)">
      <svg class="file-tree-icon" ...><!-- file icon --></svg>
      <span class="file-tree-name">{{ file.name }}</span>
      <span class="file-tree-size">{{ formatFileSize(file.size) }}</span>
    </div>
  </div>
</div>
</Transition>
```

### 6.5 Preview Panel Edit Mode

The preview panel template gains additional controls when `isMemoryFile`:

**Header modification** (add Edit button):
```html
<button v-if="isMemoryFile(previewFile?.filePath) && !memoryEditing"
        class="preview-edit-btn" @click="startMemoryEdit()" :title="t('memory.edit')">
  <svg viewBox="0 0 24 24" width="14" height="14">
    <path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
  </svg>
</button>
```

**Body: Edit mode overlay** (replaces preview content when editing):
```html
<div v-if="memoryEditing" class="memory-edit-container">
  <textarea class="memory-edit-textarea" v-model="memoryEditContent"
            @keydown.escape="cancelMemoryEdit()"></textarea>
  <div class="memory-edit-actions">
    <button class="memory-delete-btn" @click="confirmDeleteMemory()" :title="t('memory.deleteFile')">
      <svg ...><!-- trash icon --></svg> {{ t('memory.deleteFile') }}
    </button>
    <span style="flex:1"></span>
    <button class="modal-cancel-btn" @click="cancelMemoryEdit()">{{ t('sidebar.cancel') }}</button>
    <button class="modal-confirm-btn" :disabled="memorySaving" @click="saveMemoryEdit()">
      {{ memorySaving ? t('memory.saving') : t('memory.save') }}
    </button>
  </div>
</div>
```

### 6.6 Methods

```javascript
function openMemoryFile(file) {
  const filePath = memoryDir.value + '/' + file.name;
  memoryEditing.value = false;
  filePreview.openPreview(filePath);
}

function startMemoryEdit() {
  memoryEditing.value = true;
  memoryEditContent.value = previewFile.value.content;
}

function cancelMemoryEdit() {
  memoryEditing.value = false;
}

function saveMemoryEdit() {
  memorySaving.value = true;
  const filename = previewFile.value.fileName;
  wsSend({ type: 'update_memory', filename, content: memoryEditContent.value });
}

function confirmDeleteMemory() {
  // Reuse existing delete confirmation dialog pattern
  // On confirm: wsSend({ type: 'delete_memory', filename: previewFile.value.fileName });
}

function refreshMemory() {
  memoryLoading.value = true;
  wsSend({ type: 'list_memory' });
}
```

### 6.7 Message Routing (app.js, in message handler)

```javascript
case 'memory_list':
  memoryLoading.value = false;
  memoryDir.value = msg.memoryDir;
  memoryFiles.value = msg.files;
  break;

case 'memory_updated':
  memorySaving.value = false;
  if (msg.success) {
    memoryEditing.value = false;
    // Refresh preview with updated content
    filePreview.openPreview(memoryDir.value + '/' + msg.filename);
    // Refresh file list (size may have changed)
    wsSend({ type: 'list_memory' });
  }
  break;

case 'memory_deleted':
  if (msg.success) {
    memoryEditing.value = false;
    filePreview.closePreview();
    // Refresh file list
    wsSend({ type: 'list_memory' });
  }
  break;
```

---

## 7. CSS

### 7.1 Memory Empty State

```css
.memory-empty {
  padding: 1.5rem 1rem;
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.8rem;
  line-height: 1.5;
}
```

### 7.2 Edit Mode

```css
.memory-edit-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.memory-edit-textarea {
  flex: 1;
  width: 100%;
  border: none;
  outline: none;
  resize: none;
  padding: 0.75rem;
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
  font-size: 0.8rem;
  line-height: 1.5;
  background: var(--bg);
  color: var(--text);
  tab-size: 2;
}

.memory-edit-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-top: 1px solid var(--border);
  background: var(--bg-secondary);
}

.memory-delete-btn {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  background: none;
  border: none;
  color: var(--error, #e53e3e);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.memory-delete-btn:hover {
  background: rgba(229, 62, 62, 0.1);
}

.preview-edit-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 0.15rem 0.35rem;
  border-radius: 4px;
  display: flex;
  align-items: center;
}

.preview-edit-btn:hover {
  color: var(--text);
  background: var(--bg-hover);
}
```

---

## 8. Internationalization (i18n)

All user-facing strings use the `t()` function from `modules/i18n.js`. The memory feature follows the same pattern as existing UI — `t()` is available directly in the Vue template scope (returned from `createI18n()` at app initialization).

Note: `createFileBrowser` and `createFilePreview` do **not** receive `t` as a dependency; translations in those panel templates use `t()` directly from the app scope. The memory feature follows the same pattern.

### 8.1 New Translation Keys

Add the following keys to `server/web/locales/en.json` and `server/web/locales/zh.json`:

**`en.json` additions:**

```json
{
  "sidebar.memory": "Memory",

  "memory.title": "Memory",
  "memory.loading": "Loading...",
  "memory.noFiles": "No memory files yet.",
  "memory.noFilesHint": "Claude will create them automatically as it learns about your project.",
  "memory.edit": "Edit",
  "memory.editing": "Editing: {name}",
  "memory.save": "Save",
  "memory.saving": "Saving...",
  "memory.deleteFile": "Delete this file",
  "memory.deleteConfirm": "Delete {name}? This cannot be undone.",
  "memory.discardChanges": "Discard unsaved changes?"
}
```

**`zh.json` additions:**

```json
{
  "sidebar.memory": "记忆",

  "memory.title": "记忆",
  "memory.loading": "加载中...",
  "memory.noFiles": "暂无记忆文件。",
  "memory.noFilesHint": "Claude 会在了解项目的过程中自动创建记忆文件。",
  "memory.edit": "编辑",
  "memory.editing": "编辑中：{name}",
  "memory.save": "保存",
  "memory.saving": "保存中...",
  "memory.deleteFile": "删除此文件",
  "memory.deleteConfirm": "删除 {name}？此操作无法撤销。",
  "memory.discardChanges": "放弃未保存的更改？"
}
```

### 8.2 Reused Existing Keys

The following existing keys are reused (no new entries needed):

| Key | Usage |
|-----|-------|
| `sidebar.refresh` | Memory panel refresh button title |
| `sidebar.close` | Memory panel close button title |
| `sidebar.cancel` | Edit mode Cancel button |
| `dialog.cancel` | Delete confirmation Cancel button |
| `dialog.delete` | Delete confirmation Delete button |
| `dialog.cannotUndo` | Delete confirmation secondary text |

---

## 9. Edge Cases

> Note: Error messages from the agent (`memory_updated.error`, `memory_deleted.error`) are technical strings (e.g. "Permission denied", "File not found") and are not translated — they originate from the OS/filesystem.

| Scenario | Behavior |
|----------|----------|
| No memory directory exists | Show empty state: "No memory files yet" |
| Memory directory is empty | Same empty state |
| Claude writes to MEMORY.md while user is editing | User's save overwrites Claude's change (last-write-wins). Acceptable since this is a rare race condition and the user explicitly chose to save. |
| File deleted externally while editing | Save creates the file (effectively a restore). Delete returns error "File not found". |
| Working directory changes while memory panel open | Close memory panel and preview, reset state (same as file browser behavior) |
| Very large memory file | Handled by existing `read_file` protocol (100 KB text limit, truncated notice shown). Editing truncated files is disabled. |
| Filename with special characters | Path traversal is blocked by agent-side validation (`/`, `\`, `..` rejected) |
| Non-`.md` files in memory directory | Filtered out (only `.md` files shown) |

---

## 10. Security Considerations

- **Path traversal:** Agent validates filename contains no `/`, `\`, or `..` before any write/delete operation
- **Write scope:** Writes are constrained to the memory directory (`~/.claude/projects/<folder>/memory/`). No arbitrary filesystem writes.
- **Content sanitization:** Memory file content is rendered through the existing Markdown renderer (which sanitizes HTML) or displayed as raw text in a `<textarea>`. No `v-html` with user-controlled content outside the sanitized Markdown path.

---

## 11. Files Changed

| File | Change |
|------|--------|
| `agent/src/memory.ts` | **New file** — `listMemoryFiles()`, `updateMemoryFile()`, `deleteMemoryFile()` |
| `agent/src/history.ts` | Export `pathToProjectFolder()` (currently private) |
| `agent/src/connection.ts` | Add `list_memory`, `update_memory`, `delete_memory` to message dispatch |
| `server/web/app.js` | Add memory state refs, menu item, memory file list template, edit mode in preview panel, message routing, methods |
| `server/web/style.css` | Memory empty state, edit mode textarea, edit actions bar, edit/delete buttons |
| `server/web/locales/en.json` | Add `sidebar.memory` and `memory.*` translation keys |
| `server/web/locales/zh.json` | Add `sidebar.memory` and `memory.*` translation keys (Chinese) |

---

## 12. Implementation Order

1. **Agent: `memory.ts`** — list, update, delete functions with path security
2. **Agent: `history.ts`** — export `pathToProjectFolder`
3. **Agent: `connection.ts`** — add 3 message handlers
4. **Web: locale files** — add `sidebar.memory` and `memory.*` keys to `en.json` and `zh.json`
5. **Web: `app.js` state** — add refs for memory panel, editing, files
6. **Web: `app.js` template** — menu item, memory file list in sidebar, edit mode in preview panel (all strings via `t()`)
7. **Web: `app.js` methods** — open/edit/save/cancel/delete/refresh handlers
8. **Web: `app.js` message routing** — handle `memory_list`, `memory_updated`, `memory_deleted`
9. **Web: `style.css`** — all memory-related styles
10. **Build & test** — manual E2E: view list, preview, edit, save, delete, empty state, workdir change, language switching
