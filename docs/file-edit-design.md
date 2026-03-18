# General File Editing — Design Document

## 1. Overview

Extend the file preview panel to support **editing and saving** any text file in the working directory, not just memory files.

Currently, only memory files (`~/.claude/projects/.../memory/*.md`) can be edited via the dedicated `update_memory` protocol. This design adds a **general-purpose file edit** capability for all text files under `workDir`.

### Goals

- Edit and save any text file that the preview panel can already display
- Reuse the existing preview panel UI pattern (textarea, save/cancel buttons)
- Limit edits to text files within `workDir` for safety
- 500 KB size limit for editable files
- Memory file editing remains unchanged (uses existing `update_memory` protocol)

### Non-goals

- Rich text / WYSIWYG editor (textarea only for v1)
- Creating new files from the UI
- Image or binary file editing
- Monaco editor integration (future enhancement)
- File backup / undo history
- Editing files outside the working directory (except memory files via existing protocol)

---

## 2. WebSocket Protocol

### 2.1 New Message: `update_file` (Web → Agent)

```json
{
  "type": "update_file",
  "filePath": "/absolute/path/to/file.ts",
  "content": "...new file content..."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `filePath` | `string` | Absolute path to the file to update |
| `content` | `string` | New content to write (UTF-8) |

### 2.2 New Message: `file_updated` (Agent → Web)

```json
{
  "type": "file_updated",
  "filePath": "/absolute/path/to/file.ts",
  "success": true,
  "error": null
}
```

| Field | Type | Description |
|-------|------|-------------|
| `filePath` | `string` | Echoed back for correlation |
| `success` | `boolean` | Whether the write succeeded |
| `error` | `string?` | Error message if write failed |

---

## 3. Agent-Side Implementation

### 3.1 Handler: `handleUpdateFile`

Add to `directory-handlers.ts` alongside existing `handleReadFile`:

```typescript
export async function handleUpdateFile(
  msg: { filePath: string; content: string },
  workDir: string,
  send: SendFn,
): Promise<void> {
  const { filePath, content } = msg;

  try {
    // 1. Resolve to absolute path
    const resolved = isAbsolute(filePath) ? resolve(filePath) : resolve(workDir, filePath);

    // 2. Security: must be under workDir
    const normalizedWorkDir = resolve(workDir);
    if (!resolved.startsWith(normalizedWorkDir + sep) && resolved !== normalizedWorkDir) {
      send({ type: 'file_updated', filePath, success: false,
             error: 'Cannot edit files outside the working directory' });
      return;
    }

    // 3. File must already exist (no creating new files)
    await stat(resolved);

    // 4. Must be a known text file type
    const ext = extname(resolved).toLowerCase();
    const fileName = basename(resolved);
    if (!TEXT_EXTENSIONS.has(ext) && !TEXT_FILENAMES.has(fileName) && ext !== '') {
      send({ type: 'file_updated', filePath, success: false,
             error: 'Only text files can be edited' });
      return;
    }

    // 5. Content size limit (500 KB)
    const contentBytes = Buffer.byteLength(content, 'utf8');
    if (contentBytes > 500 * 1024) {
      send({ type: 'file_updated', filePath, success: false,
             error: 'Content exceeds 500 KB limit' });
      return;
    }

    // 6. Write
    await writeFile(resolved, content, 'utf8');

    send({ type: 'file_updated', filePath: resolved, success: true });
  } catch (err) {
    send({ type: 'file_updated', filePath, success: false,
           error: (err as Error).message });
  }
}
```

### 3.2 Exports from `file-readers.ts`

`TEXT_EXTENSIONS` and `TEXT_FILENAMES` need to be exported from `file-readers.ts` so `handleUpdateFile` can reference them for type validation.

### 3.3 Message Dispatch (`connection.ts`)

Add to existing switch:

```typescript
case 'update_file':
  await handleUpdateFile(msg, state.workDir, send);
  break;
```

### 3.4 Text Reader Size Limit Update

The text reader in `file-readers.ts` currently has a 100 KB `maxSize`. Increase to **500 KB** to match the edit limit, so users can preview the full content of files they're about to edit:

```typescript
const textReader: FileReader = {
  maxSize: 500 * 1024, // 500 KB (was 100 KB)
  ...
};
```

### 3.5 Validation Summary

| Check | Behavior on failure |
|-------|-------------------|
| Path resolves outside workDir | Error: "Cannot edit files outside the working directory" |
| File does not exist | Error: ENOENT from `stat()` |
| Unknown file extension | Error: "Only text files can be edited" |
| Content > 500 KB | Error: "Content exceeds 500 KB limit" |
| Write fails (permissions, etc.) | Error: OS error message |

---

## 4. Web UI Changes

### 4.1 New State (in `store.js`)

```javascript
const fileEditing = ref(false);      // general file edit mode active
const fileEditContent = ref('');     // textarea content
const fileSaving = ref(false);       // save in progress
```

### 4.2 Module: `filePreview.js` — New Methods

Add edit methods to `createFilePreview`:

```javascript
// Determine if the current preview file can be edited
// (text encoding, not truncated, not a memory file)
function canEditFile() {
  const f = previewFile.value;
  if (!f || !f.content) return false;
  if (f.encoding !== 'utf8') return false;    // no image/binary editing
  if (f.truncated) return false;               // don't edit incomplete files
  if (f.error) return false;
  return true;
}

function startFileEdit() {
  fileEditing.value = true;
  fileEditContent.value = previewFile.value?.content || '';
}

function cancelFileEdit() {
  if (fileEditContent.value !== (previewFile.value?.content || '')) {
    if (!confirm('Discard unsaved changes?')) return;  // i18n key: file.discardChanges
  }
  fileEditing.value = false;
  fileEditContent.value = '';
}

function saveFileEdit() {
  if (!previewFile.value) return;
  fileSaving.value = true;
  wsSend({
    type: 'update_file',
    filePath: previewFile.value.filePath,
    content: fileEditContent.value,
  });
}

function handleFileUpdated(msg) {
  fileSaving.value = false;
  if (msg.success) {
    fileEditing.value = false;
    fileEditContent.value = '';
    refreshPreview();  // re-fetch to show saved content
  } else {
    alert('Save failed: ' + (msg.error || 'Unknown error'));  // or toast notification
  }
}
```

### 4.3 Handler: `file-handler.js`

Add new case:

```javascript
file_updated(msg) {
  deps.filePreview.handleFileUpdated(msg);
}
```

### 4.4 UI: `PreviewPanel.vue`

The Edit button currently shows only for memory files (`isMemoryPreview`). Add a second condition for general text files:

```html
<!-- Memory edit button (existing, unchanged) -->
<button v-if="isMemoryPreview && previewFile && !memoryEditing && !fileEditing"
        class="preview-edit-btn" @click="startMemoryEdit()" :title="t('memory.edit')">
  Edit
</button>

<!-- General file edit button (NEW) -->
<button v-if="!isMemoryPreview && canEditFile && !fileEditing && !memoryEditing"
        class="preview-edit-btn" @click="startFileEdit()" :title="t('file.edit')">
  Edit
</button>

<!-- General file edit header controls (NEW, shown when fileEditing) -->
<span v-if="fileEditing" class="preview-edit-label">{{ t('file.editing') }}</span>
<button v-if="fileEditing" class="memory-header-cancel" @click="cancelFileEdit()">
  {{ t('loop.cancel') }}
</button>
<button v-if="fileEditing" class="memory-header-save" @click="saveFileEdit()" :disabled="fileSaving">
  {{ fileSaving ? t('memory.saving') : t('memory.save') }}
</button>
```

In the body section, add a condition for general file editing (same textarea pattern as memory edit):

```html
<!-- General file editing (NEW, before memory editing check) -->
<div v-else-if="fileEditing" class="memory-edit-container">
  <textarea class="memory-edit-textarea" v-model="fileEditContent"></textarea>
</div>
<!-- Memory editing (existing, unchanged) -->
<div v-else-if="memoryEditing" class="memory-edit-container">
  <textarea class="memory-edit-textarea" v-model="memoryEditContent"></textarea>
</div>
```

### 4.5 State Reset on File Change

When the user clicks a different file or closes the preview, reset edit state:

```javascript
// In openPreview(), before fetching:
fileEditing.value = false;
fileEditContent.value = '';

// In closePreview():
fileEditing.value = false;
fileEditContent.value = '';
```

### 4.6 Mobile Sidebar

The same edit flow applies to the mobile sidebar preview view in `Sidebar.vue`. The edit button and textarea are rendered using the same state refs, so no separate implementation is needed.

---

## 5. Interaction Flow

```
┌─────────────────────────────────────────────────────────────┐
│ User clicks file in tree                                    │
│   → openPreview(filePath)                                   │
│   → sends { type: 'read_file', filePath }                   │
│   → receives file_content → displays preview                │
│   → Edit button visible if canEditFile() === true           │
└─────────────────────────────────────────────────────────────┘
                          │
                     User clicks Edit
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ startFileEdit()                                             │
│   → fileEditing = true                                      │
│   → fileEditContent = previewFile.content                   │
│   → UI switches from <pre><code> to <textarea>              │
│   → Header shows: [Editing] [Cancel] [Save]                 │
└─────────────────────────────────────────────────────────────┘
                          │
                     User edits text
                          │
               ┌─────────┴──────────┐
          User clicks Save     User clicks Cancel
               │                      │
               ▼                      ▼
┌──────────────────────┐  ┌──────────────────────┐
│ saveFileEdit()       │  │ cancelFileEdit()     │
│ → fileSaving = true  │  │ → confirm if changed │
│ → wsSend(update_file)│  │ → fileEditing = false│
│                      │  │ → restore preview    │
└──────────┬───────────┘  └──────────────────────┘
           │
     Agent validates:
     - path under workDir ✓
     - file exists ✓
     - text extension ✓
     - content ≤ 500 KB ✓
           │
     Agent writes file
           │
           ▼
┌──────────────────────┐
│ file_updated         │
│ → fileSaving = false │
│ → fileEditing = false│
│ → refreshPreview()   │
│ → preview shows new  │
│   content            │
└──────────────────────┘
```

---

## 6. Memory vs General File Editing

| Aspect | Memory Files | General Files |
|--------|-------------|--------------|
| Protocol | `update_memory` / `memory_updated` | `update_file` / `file_updated` |
| Path scope | `~/.claude/projects/.../memory/` | Anywhere under `workDir` |
| Detection | `isMemoryPreview` computed | `!isMemoryPreview && canEditFile` |
| Size limit | No specific limit (memory files are small) | 500 KB |
| File type check | `.md` only (by convention) | All `TEXT_EXTENSIONS` + `TEXT_FILENAMES` |
| State refs | `memoryEditing`, `memoryEditContent`, `memorySaving` | `fileEditing`, `fileEditContent`, `fileSaving` |
| Module | `memory.js` | `filePreview.js` |
| Unchanged | Yes — no changes to memory editing | N/A — new feature |

The two paths are **mutually exclusive** in the UI: if a file is a memory file, only the memory edit path is shown; otherwise, the general edit path is shown (if the file qualifies).

---

## 7. Security Considerations

| Concern | Mitigation |
|---------|-----------|
| Path traversal | `resolve()` + prefix check against `workDir` |
| Writing outside workDir | Rejected with error before any I/O |
| Overwriting binary files via crafted message | Extension/filename allowlist check |
| Large file writes | 500 KB content limit |
| Creating new files | `stat()` check — file must already exist |
| sensitive files (`.env`, credentials) | Allowed — user has full filesystem access via Claude already; restricting would be inconsistent |
| Concurrent edits | Last-write-wins (acceptable for single-user local tool) |

---

## 8. i18n Keys

Add to each locale file:

```json
{
  "file": {
    "edit": "Edit",
    "editing": "Editing",
    "discardChanges": "You have unsaved changes. Discard?",
    "saveFailed": "Save failed: {error}"
  }
}
```

Reuse existing keys where possible: `memory.save`, `memory.saving`, `loop.cancel`.

---

## 9. Files Changed

| File | Change |
|------|--------|
| `agent/src/file-readers.ts` | Export `TEXT_EXTENSIONS`, `TEXT_FILENAMES`; increase `textReader.maxSize` to 500 KB |
| `agent/src/directory-handlers.ts` | Add `handleUpdateFile()` |
| `agent/src/connection.ts` | Add `case 'update_file'` to message dispatch |
| `server/web/src/modules/filePreview.js` | Add `canEditFile`, `startFileEdit`, `cancelFileEdit`, `saveFileEdit`, `handleFileUpdated`; reset edit state on file change |
| `server/web/src/modules/handlers/file-handler.js` | Add `file_updated` handler |
| `server/web/src/store.js` | Add `fileEditing`, `fileEditContent`, `fileSaving` refs; wire new methods |
| `server/web/src/components/PreviewPanel.vue` | Add Edit button for general files, textarea for editing, save/cancel controls |
| `server/web/src/components/Sidebar.vue` | Same edit UI for mobile preview |
| `server/web/public/locales/*.json` | Add `file.edit`, `file.editing`, `file.discardChanges` keys |

---

## 10. Implementation Order

1. **Agent: export constants** — Export `TEXT_EXTENSIONS` and `TEXT_FILENAMES` from `file-readers.ts`, increase `maxSize` to 500 KB
2. **Agent: handler** — `handleUpdateFile` in `directory-handlers.ts` with all validations
3. **Agent: dispatch** — Wire `case 'update_file'` in `connection.ts`
4. **Web: state** — Add `fileEditing`, `fileEditContent`, `fileSaving` refs in `store.js`
5. **Web: module** — Add edit methods to `filePreview.js`
6. **Web: handler** — Route `file_updated` in `file-handler.js`
7. **Web: UI** — Edit button + textarea in `PreviewPanel.vue` and `Sidebar.vue`
8. **i18n** — Add locale keys
9. **Test** — Manual E2E: edit text file, save, verify content; try editing outside workDir (should fail); try large file; try binary file (button should not appear)
