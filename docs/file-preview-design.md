# File Preview Panel — Design Document

## 1. Overview

Add a file preview panel to the AgentLink web UI, allowing users to click a file in the file browser and see its contents in a dedicated column to the right of the chat area.

Supports text-based files with syntax highlighting and images rendered inline.

### Goals

- Preview text files (source code, config, markdown, plain text, etc.) with syntax highlighting
- Preview common image formats (png, jpg, gif, svg, webp) inline
- New resizable column to the right of the chat area
- Reuse existing highlight.js (already bundled for markdown rendering)
- Minimal protocol addition: one new request/response message pair

### Non-goals

- File editing, saving, or write-back
- Binary file hex viewer
- PDF rendering
- Video / audio playback
- Previewing files larger than the size cap (show metadata only)

---

## 2. Layout Architecture

### 2.1 Current Layout

```
.main-body (flex row)
├── .sidebar (260px)
├── .file-panel (280px, collapsible)
└── .chat-area (flex: 1)
```

### 2.2 Proposed Layout

```
.main-body (flex row)
├── .sidebar (260px)
├── .file-panel (280px, collapsible)
├── .chat-area (flex: 1, min-width: 300px)
└── .preview-panel (400px default, collapsible, resizable)
```

The `.preview-panel` is appended **after** `.chat-area` inside `.main-body`. When closed, it is removed from the DOM (`v-if`), and `.chat-area` reclaims the space via `flex: 1`.

### 2.3 Responsive Breakpoints

| Viewport Width | Preview Panel Behavior |
|----------------|------------------------|
| **≥ 1200px** | Full column, user-resizable |
| **768–1199px** | Capped at `min(400px, 40vw)`, still resizable |
| **< 768px** | Opens as a full-screen overlay with a close button (no column) |

---

## 3. WebSocket Protocol

### 3.1 New Message: `read_file` (Web → Agent)

```json
{
  "type": "read_file",
  "filePath": "/absolute/path/to/file.ts",
  "maxBytes": 102400
}
```

| Field | Type | Description |
|-------|------|-------------|
| `filePath` | `string` | Absolute path on the agent host |
| `maxBytes` | `number?` | Max bytes to read (default 100 KB for text, 5 MB for images) |

### 3.2 New Message: `file_content` (Agent → Web)

```json
{
  "type": "file_content",
  "filePath": "/absolute/path/to/file.ts",
  "fileName": "file.ts",
  "content": "...file content or base64...",
  "encoding": "utf8",
  "mimeType": "text/typescript",
  "truncated": false,
  "totalSize": 4523,
  "error": null
}
```

| Field | Type | Description |
|-------|------|-------------|
| `filePath` | `string` | Echoed back for correlation |
| `fileName` | `string` | Basename for display |
| `content` | `string` | UTF-8 text or base64-encoded binary |
| `encoding` | `"utf8" \| "base64"` | Encoding of `content` |
| `mimeType` | `string` | Detected MIME type (e.g. `text/plain`, `image/png`) |
| `truncated` | `boolean` | Whether the file was truncated |
| `totalSize` | `number` | Original file size in bytes |
| `error` | `string?` | Error message if reading failed |

### 3.3 MIME / Type Detection (Agent-Side)

Extension-based lookup:

```
Text:   .ts .js .mjs .cjs .jsx .tsx .json .json5 .yaml .yml .toml .xml
        .html .htm .css .scss .less .md .txt .log .sh .bash .zsh .fish
        .ps1 .bat .cmd .py .rb .rs .go .java .c .h .cpp .hpp .cs .swift
        .kt .lua .r .sql .graphql .proto .env .ini .cfg .conf
        .gitignore .dockerignore .editorconfig Makefile Dockerfile
        (+ any file without extension under 100 KB → attempt UTF-8 read, fallback to binary)

Image:  .png .jpg .jpeg .gif .svg .webp .ico .bmp

Binary (metadata only): everything else
```

### 3.4 Size Limits

| Category | Max Read Size | Behavior When Exceeded |
|----------|---------------|------------------------|
| Text | 100 KB | Read first 100 KB, `truncated: true` |
| Image | 5 MB | Return error: "File too large to preview" |
| Binary | 0 | Return metadata only (size, MIME), no content |

---

## 4. Agent-Side Implementation — Extensible Reader Architecture

The file reading logic lives in a new module `agent/src/file-readers.ts`, separate from `connection.ts`. This keeps `connection.ts` as a thin dispatcher and makes it easy to add new format readers (Word, PDF, Excel, etc.) without touching the core message handling.

### 4.1 Architecture Overview

```
agent/src/
├── connection.ts          # Thin dispatcher: resolves path, calls readFile()
└── file-readers.ts        # Reader registry + built-in readers
```

```
┌─────────────────────────────────────────────────┐
│  connection.ts                                  │
│  handleReadFile(msg)                            │
│    → resolve path, stat file                    │
│    → call readFile(resolved, stats)             │
│    → send result                                │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│  file-readers.ts                                │
│                                                 │
│  FileReader interface                           │
│  ┌───────────┐ ┌───────────┐ ┌───────────────┐ │
│  │ TextReader │ │ImageReader│ │ BinaryReader  │ │
│  │ .ts .js   │ │ .png .jpg │ │ (fallback)    │ │
│  │ .py .md.. │ │ .gif .svg │ │ metadata only │ │
│  └───────────┘ └───────────┘ └───────────────┘ │
│                                                 │
│  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐ │
│    Future:                                      │
│  │ ┌───────────┐ ┌───────────┐ ┌───────────┐ │ │
│    │ DocxReader │ │ PdfReader │ │ XlsxReader│   │
│  │ └───────────┘ └───────────┘ └───────────┘ │ │
│  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘ │
└─────────────────────────────────────────────────┘
```

### 4.2 Types & Interfaces (`file-readers.ts`)

```typescript
import { stat, open, readFile as fsReadFile } from 'fs/promises';
import { extname, basename } from 'path';

/** Result returned by every reader */
export interface FileReadResult {
  content: string | null;     // file content (text or base64), null for metadata-only
  encoding: 'utf8' | 'base64';
  mimeType: string;
  truncated: boolean;
}

/** A reader that handles a specific category of files */
export interface FileReader {
  /** Max file size this reader will attempt (bytes). Files exceeding this → error. */
  maxSize: number;
  /** Read the file and return a result. Receives the resolved path and file size. */
  read(filePath: string, totalSize: number): Promise<FileReadResult>;
}
```

### 4.3 Reader Registry

```typescript
// ── Reader registry ────────────────────────────────────────────

const readers = new Map<string, FileReader>();

/** Register a reader for one or more file extensions (including the dot). */
export function registerReader(extensions: string[], reader: FileReader): void {
  for (const ext of extensions) {
    readers.set(ext.toLowerCase(), reader);
  }
}

/** Look up the reader for a given extension. Falls back to a heuristic. */
function resolveReader(ext: string, totalSize: number): FileReader {
  const reader = readers.get(ext.toLowerCase());
  if (reader) return reader;

  // No extension or unknown extension: try text if small enough
  if (ext === '' || totalSize <= textReader.maxSize) return textReader;

  return binaryReader;
}
```

### 4.4 Built-in Readers

```typescript
// ── Text reader ────────────────────────────────────────────────

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.json5',
  '.yaml', '.yml', '.toml', '.xml', '.html', '.htm', '.css', '.scss', '.less',
  '.md', '.txt', '.log', '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  '.py', '.rb', '.rs', '.go', '.java', '.c', '.h', '.cpp', '.hpp', '.cs',
  '.swift', '.kt', '.lua', '.r', '.sql', '.graphql', '.proto',
  '.env', '.ini', '.cfg', '.conf', '.vue', '.svelte',
  '.gitignore', '.dockerignore', '.editorconfig',
]);

// Also match extensionless known filenames
const TEXT_FILENAMES = new Set([
  'Makefile', 'Dockerfile', 'Vagrantfile', 'Gemfile', 'Rakefile',
  'LICENSE', 'CHANGELOG', 'AUTHORS',
]);

const textReader: FileReader = {
  maxSize: 100 * 1024, // 100 KB
  async read(filePath, totalSize) {
    const bytesToRead = Math.min(totalSize, this.maxSize);
    const buf = Buffer.alloc(bytesToRead);
    const fd = await open(filePath, 'r');
    try {
      await fd.read(buf, 0, bytesToRead, 0);
    } finally {
      await fd.close();
    }
    return {
      content: buf.toString('utf8'),
      encoding: 'utf8',
      mimeType: MIME_TYPES[extname(filePath).toLowerCase()] || 'text/plain',
      truncated: totalSize > this.maxSize,
    };
  },
};

// ── Image reader ───────────────────────────────────────────────

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp',
]);

const imageReader: FileReader = {
  maxSize: 5 * 1024 * 1024, // 5 MB
  async read(filePath, totalSize) {
    if (totalSize > this.maxSize) {
      return { content: null, encoding: 'base64',
               mimeType: MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream',
               truncated: true };
    }
    const buf = await fsReadFile(filePath);
    return {
      content: buf.toString('base64'),
      encoding: 'base64',
      mimeType: MIME_TYPES[extname(filePath).toLowerCase()] || 'image/png',
      truncated: false,
    };
  },
};

// ── Binary reader (fallback — metadata only) ───────────────────

const binaryReader: FileReader = {
  maxSize: 0,
  async read(filePath) {
    return {
      content: null,
      encoding: 'utf8',
      mimeType: MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream',
      truncated: false,
    };
  },
};

// ── MIME type lookup ───────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  '.ts': 'text/typescript', '.tsx': 'text/tsx', '.js': 'text/javascript',
  '.json': 'application/json', '.md': 'text/markdown', '.html': 'text/html',
  '.css': 'text/css', '.py': 'text/x-python', '.rs': 'text/x-rust',
  '.go': 'text/x-go', '.java': 'text/x-java', '.c': 'text/x-c',
  '.cpp': 'text/x-c++', '.rb': 'text/x-ruby', '.sh': 'text/x-shellscript',
  '.yaml': 'text/yaml', '.yml': 'text/yaml', '.xml': 'text/xml',
  '.sql': 'text/x-sql', '.txt': 'text/plain', '.log': 'text/plain',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.bmp': 'image/bmp',
  // Add more as needed
};

// ── Register built-in readers ──────────────────────────────────

registerReader([...TEXT_EXTENSIONS], textReader);
// Register known text filenames as '' extension (handled in resolveReader)
registerReader([...IMAGE_EXTENSIONS], imageReader);
```

### 4.5 Public API (`file-readers.ts`)

```typescript
/** Main entry point — called by connection.ts handleReadFile. */
export async function readFileForPreview(
  filePath: string,
  totalSize: number,
): Promise<FileReadResult & { fileName: string }> {
  const ext = extname(filePath).toLowerCase();
  const fileName = basename(filePath);

  // Check extensionless known filenames
  const reader = (ext === '' && TEXT_FILENAMES.has(fileName))
    ? textReader
    : resolveReader(ext, totalSize);

  const result = await reader.read(filePath, totalSize);
  return { ...result, fileName };
}
```

### 4.6 Connection Handler (`connection.ts`)

`connection.ts` stays thin — just resolves the path, stats the file, delegates to `readFileForPreview`:

```typescript
import { readFileForPreview } from './file-readers.js';

async function handleReadFile(msg: { filePath: string }): Promise<void> {
  const filePath = msg.filePath;
  try {
    const resolved = isAbsolute(filePath) ? resolve(filePath) : resolve(state.workDir, filePath);
    const stats = await stat(resolved);
    const result = await readFileForPreview(resolved, stats.size);

    send({
      type: 'file_content',
      filePath: resolved,
      fileName: result.fileName,
      content: result.content,
      encoding: result.encoding,
      mimeType: result.mimeType,
      truncated: result.truncated,
      totalSize: stats.size,
    });
  } catch (err) {
    send({
      type: 'file_content',
      filePath,
      fileName: basename(filePath),
      content: null,
      encoding: 'utf8',
      mimeType: 'application/octet-stream',
      truncated: false,
      totalSize: 0,
      error: (err as Error).message,
    });
  }
}
```

Message dispatch (add to existing switch):

```typescript
case 'read_file':
  await handleReadFile(msg);
  break;
```

### 4.7 Adding New Readers (Future Example)

Adding a `.docx` reader only requires a new file + one `registerReader` call:

```typescript
// file-readers.ts — or a separate file imported by file-readers.ts

import mammoth from 'mammoth';  // npm install mammoth

const docxReader: FileReader = {
  maxSize: 10 * 1024 * 1024, // 10 MB
  async read(filePath, totalSize) {
    if (totalSize > this.maxSize) {
      return { content: null, encoding: 'utf8', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', truncated: true };
    }
    const result = await mammoth.convertToHtml({ path: filePath });
    return {
      content: result.value,    // HTML string
      encoding: 'utf8',
      mimeType: 'text/html',    // tells web UI to render as HTML
      truncated: false,
    };
  },
};

registerReader(['.docx', '.doc'], docxReader);
```

The web UI already handles `encoding: 'utf8'` content — for HTML-converted documents, a future enhancement could detect `mimeType: 'text/html'` and render via `v-html` instead of `<pre><code>` (sandboxed appropriately).

---

## 5. Web UI: Preview Panel Module

### 5.1 New Module: `server/web/modules/filePreview.js`

Factory pattern consistent with other modules:

```javascript
export function createFilePreview(deps) {
  const {
    wsSend,
    previewPanelOpen,   // ref(false)
    previewPanelWidth,  // ref(parseInt(localStorage...) || 400)
    previewFile,        // ref(null) — { filePath, fileName, content, encoding, mimeType, truncated, totalSize, error }
    previewLoading,     // ref(false)
  } = deps;

  function openPreview(filePath) { ... }
  function closePreview() { ... }
  function handleFileContent(msg) { ... }

  // Resize handle (same pattern as fileBrowser.js)
  const MIN_WIDTH = 200;
  const MAX_WIDTH = 800;
  function onResizeStart(e) { ... }
  function onResizeMove(e) { ... }
  function onResizeEnd(e) { ... }

  return { openPreview, closePreview, handleFileContent, onResizeStart };
}
```

### 5.2 Reactive State (app.js)

```javascript
const previewPanelOpen = ref(false);
const previewPanelWidth = ref(parseInt(localStorage.getItem('agentlink-preview-panel-width'), 10) || 400);
const previewFile = ref(null);
const previewLoading = ref(false);
```

### 5.3 Message Routing (connection.js)

In the decrypted message handler, add:

```javascript
case 'file_content':
  filePreview.handleFileContent(msg);
  break;
```

---

## 6. Web UI: Template & Rendering

### 6.1 Template (app.js, inside `.main-body`)

```html
<!-- Preview Panel (after .chat-area) -->
<div v-if="previewPanelOpen && !isMobile" class="preview-panel"
     :style="{ width: previewPanelWidth + 'px' }">
  <div class="preview-panel-resize-handle"
       @mousedown="filePreview.onResizeStart($event)"
       @touchstart="filePreview.onResizeStart($event)"></div>
  <div class="preview-panel-header">
    <span class="preview-panel-filename" :title="previewFile?.filePath">
      {{ previewFile?.fileName || 'Preview' }}
    </span>
    <span v-if="previewFile" class="preview-panel-size">
      {{ formatFileSize(previewFile.totalSize) }}
    </span>
    <button class="preview-panel-close" @click="filePreview.closePreview()"
            title="Close preview">&times;</button>
  </div>
  <div class="preview-panel-body">
    <!-- Loading -->
    <div v-if="previewLoading" class="preview-loading">Loading...</div>
    <!-- Error -->
    <div v-else-if="previewFile?.error" class="preview-error">
      {{ previewFile.error }}
    </div>
    <!-- Image -->
    <div v-else-if="previewFile?.encoding === 'base64' && previewFile?.content"
         class="preview-image-container">
      <img :src="'data:' + previewFile.mimeType + ';base64,' + previewFile.content"
           :alt="previewFile.fileName" class="preview-image" />
    </div>
    <!-- Text -->
    <div v-else-if="previewFile?.content" class="preview-text-container">
      <pre class="preview-code"><code :class="'language-' + detectLanguage(previewFile.fileName)"
           v-html="highlightCode(previewFile.content, previewFile.fileName)"></code></pre>
      <div v-if="previewFile.truncated" class="preview-truncated-notice">
        File truncated — showing first 100 KB of {{ formatFileSize(previewFile.totalSize) }}
      </div>
    </div>
    <!-- Binary (no content) -->
    <div v-else-if="previewFile && !previewFile.content" class="preview-binary-info">
      <p>Binary file — {{ previewFile.mimeType }}</p>
      <p>{{ formatFileSize(previewFile.totalSize) }}</p>
    </div>
  </div>
</div>

<!-- Mobile overlay -->
<div v-if="previewPanelOpen && isMobile" class="preview-overlay">
  <!-- Same content as above, full-screen -->
</div>
```

### 6.2 Syntax Highlighting

Reuse the already-bundled `highlight.js`:

```javascript
function detectLanguage(fileName) {
  const ext = fileName.split('.').pop()?.toLowerCase();
  const map = { ts: 'typescript', js: 'javascript', py: 'python', ... };
  return map[ext] || ext || 'plaintext';
}

function highlightCode(code, fileName) {
  if (!window.hljs) return escapeHtml(code);
  const lang = detectLanguage(fileName);
  try {
    return window.hljs.highlight(code, { language: lang }).value;
  } catch {
    return window.hljs.highlightAuto(code).value;
  }
}
```

### 6.3 Trigger: File Click in File Browser

In `fileBrowser.js`, modify the file-click behavior:

- **Current:** Right-click opens context menu; left-click does nothing (or also opens context menu)
- **New:** Single-click on a **file** node calls `filePreview.openPreview(node.path)`
- Context menu remains available via right-click

Integration: `createFileBrowser` receives a new dep `onFileClick` callback, wired in `app.js`:

```javascript
const fileBrowser = createFileBrowser({
  ...existingDeps,
  onFileClick: (filePath) => filePreview.openPreview(filePath),
});
```

---

## 7. CSS Styling

### 7.1 Preview Panel

```css
.preview-panel {
  width: 400px;
  flex-shrink: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-left: 1px solid var(--border);
  background: var(--bg);
}

.preview-panel-resize-handle {
  position: absolute;
  top: 0;
  left: -3px;          /* LEFT side, since panel is on the right */
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
  background: transparent;
  transition: background 0.15s;
}

.preview-panel-resize-handle:hover,
.preview-panel-resize-handle:active {
  background: var(--accent);
  opacity: 0.4;
}
```

Note: The resize handle is on the **left** edge (opposite of file-panel's right-edge handle), since the preview panel is the rightmost column. Dragging left makes it wider, dragging right makes it narrower.

### 7.2 Header

```css
.preview-panel-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.preview-panel-filename {
  flex: 1;
  font-weight: 600;
  font-size: 0.85rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-panel-size {
  font-size: 0.75rem;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.preview-panel-close {
  background: none;
  border: none;
  font-size: 1.2rem;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 0 0.25rem;
}
```

### 7.3 Body / Content

```css
.preview-panel-body {
  flex: 1;
  overflow: auto;
  padding: 0;
}

.preview-text-container {
  overflow: auto;
  height: 100%;
}

.preview-code {
  margin: 0;
  padding: 0.75rem;
  font-size: 0.8rem;
  line-height: 1.5;
  white-space: pre;
  overflow-x: auto;
  background: var(--bg);   /* inherits theme */
}

.preview-image-container {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  height: 100%;
}

.preview-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.preview-truncated-notice {
  padding: 0.5rem 0.75rem;
  font-size: 0.75rem;
  color: var(--text-secondary);
  border-top: 1px solid var(--border);
  background: var(--bg-secondary);
  text-align: center;
}
```

### 7.4 Mobile Overlay

```css
.preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: var(--bg);
  display: flex;
  flex-direction: column;
}
```

### 7.5 Responsive Adjustments

```css
@media (max-width: 1200px) and (min-width: 769px) {
  .preview-panel {
    max-width: min(400px, 40vw);
  }
}

@media (max-width: 768px) {
  .preview-panel {
    display: none;   /* use overlay instead */
  }
}
```

---

## 8. Edge Cases

| Scenario | Behavior |
|----------|----------|
| File deleted between browse and click | Show error in preview: "File not found" |
| Encoding issues (non-UTF8 text) | Agent reads as UTF-8 with replacement chars; preview renders as-is |
| Extremely long lines | `white-space: pre; overflow-x: auto` — horizontal scroll |
| File with no extension | Attempt text read (if ≤ 100 KB), fallback to binary info |
| Same file clicked again | Skip re-fetch if `previewFile.filePath` matches |
| Preview open + working directory changes | Close preview panel automatically |
| Large SVG files | Treated as image (rendered in `<img>` tag, not inline SVG to prevent XSS) |
| Symlinks | `fs.stat` follows them; broken symlinks → error |

---

## 9. Security Considerations

- **Path traversal:** Agent resolves paths via `path.resolve()`, same as `handleListDirectory`. No additional restriction needed since the user already has full filesystem access via Claude.
- **SVG XSS:** SVGs rendered in `<img>` tags (not inline HTML), which sandboxes scripts.
- **Base64 size:** 5 MB image → ~6.7 MB base64 → goes through existing encrypted WebSocket. Acceptable for local relay.

---

## 10. Files Changed

| File | Change |
|------|--------|
| `agent/src/file-readers.ts` | **New file** — `FileReader` interface, reader registry, built-in text/image/binary readers, `readFileForPreview()` |
| `agent/src/connection.ts` | Add thin `handleReadFile` (resolves path, delegates to `file-readers.ts`); add `'read_file'` to message dispatch |
| `server/web/modules/filePreview.js` | **New file** — preview panel controller |
| `server/web/modules/fileBrowser.js` | Add `onFileClick` dep; wire single-click on file nodes |
| `server/web/modules/connection.js` | Route `file_content` messages to `filePreview.handleFileContent` |
| `server/web/app.js` | Add reactive state, create `filePreview` module, add template |
| `server/web/style.css` | Preview panel, header, body, resize handle, overlay, responsive styles |

---

## 11. Implementation Order

1. **Reader module** — `agent/src/file-readers.ts`: interfaces, registry, text/image/binary readers, `readFileForPreview()`
2. **Agent handler** — `connection.ts`: thin `handleReadFile` + message dispatch
3. **Web module** — `filePreview.js` with open/close/handleFileContent/resize
4. **App integration** — reactive state in `app.js`, template, module wiring
5. **Message routing** — `connection.js` routes `file_content`
6. **File browser click** — wire `onFileClick` in `fileBrowser.js`
7. **CSS** — all preview panel styles
8. **Mobile overlay** — responsive behavior
9. **Testing** — manual E2E: text files, images, large files, binary files, errors
