# File Editing v2 — Design Document

## 1. Overview

v1 (implemented in `file-edit-design.md`) added basic text file editing via a plain `<textarea>` in the preview panel. v2 enhances the editing experience with two features:

1. **Monaco Editor** — Replace `<textarea>` with Monaco for syntax highlighting, line numbers, search/replace, and keybindings. Desktop only; mobile stays with `<textarea>`.
2. **Create New File / Folder** — Right-click in file tree → "New File" or "New Folder" to create from the UI

### Deferred

- ~~Auto-save / Undo~~ — Dropped. Monaco's built-in undo/redo is sufficient for now; no localStorage draft persistence.

---

## 2. Feature 1: Monaco Editor (Desktop Only)

### 2.1 Goals

- Replace the plain `<textarea>` used for file editing with Monaco Editor (the VS Code editor component)
- Provide syntax highlighting based on file extension
- Show line numbers
- Built-in search & replace (Ctrl+H / Cmd+H)
- Keyboard shortcuts (Ctrl+S to save, Esc to cancel)
- Respect light/dark theme
- **Desktop only** — mobile (`isMobile`) keeps `<textarea>` as-is (Monaco has poor mobile support)

### 2.2 Non-goals

- Multi-tab / multi-file editing (one file at a time in preview panel)
- LSP integration (no IntelliSense, no diagnostics)
- Diff editor mode (v1 already has a separate diff view)
- Mobile Monaco support

### 2.3 Dependencies

- `monaco-editor` npm package (~3 MB, loaded on demand)
- Vite plugin: `vite-plugin-monaco-editor` for worker bundling

### 2.4 Implementation Plan

#### 2.4.1 Install dependencies

```bash
cd server/web
npm install monaco-editor
npm install -D vite-plugin-monaco-editor
```

#### 2.4.2 Vite config

Update `server/web/vite.config.js` to register the Monaco plugin so web workers are bundled correctly.

#### 2.4.3 Vue composable: `useMonacoEditor`

Create `server/web/src/composables/useMonacoEditor.js`:

```javascript
// Factory: (containerRef, options) => { setContent, getContent, setLanguage, dispose }
// - Creates a Monaco editor instance inside the given DOM element ref
// - Listens to theme changes (light/dark) and updates Monaco theme
// - Maps file extension → Monaco language ID
// - Registers Ctrl+S → onSave callback
// - Registers Esc → onCancel callback
// - Exposes getContent() for reading current editor value
// - dispose() on component unmount
```

#### 2.4.4 File extension → language mapping

```javascript
const EXT_TO_LANGUAGE = {
  js: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  vue: 'html', html: 'html', htm: 'html',
  css: 'css', scss: 'scss', less: 'less',
  json: 'json', jsonc: 'json',
  md: 'markdown',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  yml: 'yaml', yaml: 'yaml',
  xml: 'xml', svg: 'xml',
  sql: 'sql',
  c: 'c', h: 'c',
  cpp: 'cpp', hpp: 'cpp', cc: 'cpp',
  cs: 'csharp',
  toml: 'ini',
  cfg: 'ini', ini: 'ini',
  dockerfile: 'dockerfile',
  // fallback: 'plaintext'
};
```

#### 2.4.5 Component changes

**`PreviewPanel.vue` (desktop):**

Replace:
```html
<div v-else-if="fileEditing" class="memory-edit-container">
  <textarea class="memory-edit-textarea" v-model="fileEditContent"></textarea>
</div>
```

With:
```html
<div v-else-if="fileEditing" class="monaco-edit-container" ref="monacoContainer"></div>
```

Use the `useMonacoEditor` composable to initialize the editor when `fileEditing` becomes true. On save, read content from editor via `getContent()`.

**`Sidebar.vue` (mobile):** Keep `<textarea>` as-is. No Monaco on mobile.

**Memory editing** stays as `<textarea>` everywhere (memory files are small `.md` files; Monaco is overkill).

#### 2.4.6 Theme integration

- Watch the existing `isDarkMode` reactive ref
- Map to Monaco themes: `'vs'` (light) / `'vs-dark'` (dark)
- Call `monaco.editor.setTheme()` on change

#### 2.4.7 Performance

- **Lazy load**: Dynamic `import('monaco-editor')` only when user clicks Edit — do not include in initial bundle
- **Single instance**: Reuse the same editor instance across file edits; call `editor.setModel()` to switch files
- **Dispose on close**: Clean up when preview panel closes

### 2.5 Files Changed

| File | Change |
|------|--------|
| `server/web/package.json` | Add `monaco-editor`, `vite-plugin-monaco-editor` |
| `server/web/vite.config.js` | Register Monaco plugin |
| `server/web/src/composables/useMonacoEditor.js` | New composable |
| `server/web/src/components/PreviewPanel.vue` | Replace textarea with Monaco container (desktop only) |
| `server/web/src/css/file-browser.css` | `.monaco-edit-container` styles |

---

## 3. Feature 2: Create New File / Folder

### 3.1 Goals

- Right-click a folder in the file tree → context menu → "New File" / "New Folder"
- Enter name in an inline input or modal
- Create the file or directory on the agent's filesystem via WebSocket
- For new files: open in preview panel in edit mode
- For new folders: refresh file tree to show the new folder

### 3.2 Non-goals

- File templates / boilerplate content
- Drag-and-drop file creation

### 3.3 WebSocket Protocol

#### 3.3.1 New Message: `create_file` (Web → Agent)

```json
{
  "type": "create_file",
  "dirPath": "/path/to/directory",
  "fileName": "newfile.ts"
}
```

#### 3.3.2 New Message: `file_created` (Agent → Web)

```json
{
  "type": "file_created",
  "success": true,
  "filePath": "/path/to/directory/newfile.ts"
}
```

Error case:
```json
{
  "type": "file_created",
  "success": false,
  "error": "File already exists"
}
```

#### 3.3.3 New Message: `create_directory` (Web → Agent)

```json
{
  "type": "create_directory",
  "dirPath": "/path/to/parent",
  "dirName": "new-folder"
}
```

#### 3.3.4 New Message: `directory_created` (Agent → Web)

```json
{
  "type": "directory_created",
  "success": true,
  "dirPath": "/path/to/parent/new-folder"
}
```

Error case:
```json
{
  "type": "directory_created",
  "success": false,
  "error": "Directory already exists"
}
```

### 3.4 Agent Implementation

In `agent/src/directory-handlers.ts`, add two handlers:

**`handleCreateFile`:**
- Validate: `dirPath` resolves under `workDir`
- Validate: `fileName` is a safe filename (no path separators, no `..`)
- Validate: parent directory exists
- Validate: target file does NOT already exist (no overwrite)
- Create file with empty content via `fs.writeFile`
- Send `file_created` response

**`handleCreateDirectory`:**
- Validate: `dirPath` resolves under `workDir`
- Validate: `dirName` is a safe name (no path separators, no `..`)
- Validate: parent directory exists
- Validate: target directory does NOT already exist
- Create directory via `fs.mkdir`
- Send `directory_created` response

### 3.5 Web UI Implementation

#### 3.5.1 Context menu

Add "New File" and "New Folder" options to the folder context menu in the file browser. The context menu appears on right-click (desktop) or long-press (mobile) on a folder entry.

```html
<div class="context-menu-item" @click="createNewFile(folder)">
  {{ t('file.newFile') }}
</div>
<div class="context-menu-item" @click="createNewFolder(folder)">
  {{ t('file.newFolder') }}
</div>
```

#### 3.5.2 Inline name input

When "New File" or "New Folder" is clicked:
1. Show an inline `<input>` at the top of the selected folder's file list
2. Placeholder text: "Enter file name..." / "Enter folder name..."
3. User types name, presses Enter to confirm or Esc to cancel
4. Send `create_file` / `create_directory` message
5. On success: refresh file list. For files, open in preview panel and enter edit mode.
6. On error: show error message inline

#### 3.5.3 Message handlers

Add handlers in `file-handler.js`:

```javascript
file_created(msg) {
  if (msg.success) {
    // Refresh file tree
    // Open the new file in preview and enter edit mode
  } else {
    // Show error
  }
},
directory_created(msg) {
  if (msg.success) {
    // Refresh file tree
  } else {
    // Show error
  }
}
```

### 3.6 Security

- Path validation: `dirPath` must resolve under `workDir` (same as `update_file`)
- Name validation: reject path separators (`/`, `\`), `..`, null bytes
- No overwrite: fail if file/directory already exists
- Directory creation: only one level (no recursive `mkdir -p`)

### 3.7 Files Changed

| File | Change |
|------|--------|
| `agent/src/directory-handlers.ts` | Add `handleCreateFile`, `handleCreateDirectory` |
| `agent/src/connection.ts` | Add `create_file`, `create_directory` dispatch cases |
| `server/web/src/modules/fileBrowser.js` | Context menu + inline input logic |
| `server/web/src/modules/handlers/file-handler.js` | Add `file_created`, `directory_created` handlers |
| `server/web/src/components/Sidebar.vue` | Context menu UI for folders |
| `server/web/src/css/file-browser.css` | Context menu + inline input styles |
| `server/web/public/locales/en.json` | i18n keys (see below) |
| `server/web/public/locales/zh.json` | i18n keys (see below) |

### 3.8 i18n Keys

```json
"file.newFile": "New File" / "新建文件",
"file.newFolder": "New Folder" / "新建文件夹",
"file.fileExists": "File already exists" / "文件已存在",
"file.folderExists": "Folder already exists" / "文件夹已存在",
"file.createFailed": "Create failed: {error}" / "创建失败：{error}",
"file.enterFileName": "Enter file name..." / "输入文件名...",
"file.enterFolderName": "Enter folder name..." / "输入文件夹名..."
```

---

## 4. Implementation Order

### Phase 1: Monaco Editor (Desktop)
- [ ] Install `monaco-editor` + Vite plugin
- [ ] Create `useMonacoEditor` composable
- [ ] Replace `<textarea>` with Monaco in `PreviewPanel.vue` (desktop only)
- [ ] Mobile `Sidebar.vue` keeps `<textarea>` — no changes
- [ ] Theme integration (light/dark)
- [ ] Keyboard shortcuts (Ctrl+S save, Esc cancel)
- [ ] Test: syntax highlighting, line numbers, search/replace

### Phase 2: Create New File / Folder
- [ ] Agent: `handleCreateFile` in `directory-handlers.ts`
- [ ] Agent: `handleCreateDirectory` in `directory-handlers.ts`
- [ ] Agent: dispatch in `connection.ts`
- [ ] Web: context menu on folders in file browser (right-click / long-press)
- [ ] Web: inline name input (Enter to confirm, Esc to cancel)
- [ ] Web: `file_created` + `directory_created` handlers
- [ ] i18n keys (en + zh)
- [ ] Test: create file, create folder, verify on disk, open in editor
