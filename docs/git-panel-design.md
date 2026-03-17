# Git Panel — Design Document

## 1. Overview

Add a Git panel to the AgentLink web UI, allowing users to view repository status, browse changed files, and inspect diffs — all from the web interface without needing a local terminal.

The Git panel is a **side panel** (same position as the existing File Browser and Memory panels), toggled from the working directory dropdown menu in the sidebar.

### Goals

- Show current branch, tracking info, and ahead/behind counts
- Display changed files grouped by status (staged, modified, untracked)
- View unified diffs for individual files (staged or unstaged)
- Refresh on demand (git state changes frequently)
- Work on both desktop and mobile

### Non-goals

- Git operations (commit, push, pull, checkout, stage/unstage)
- Merge conflict resolution UI
- Git log / commit history browser (future enhancement)
- Blame / annotation view
- Submodule support

---

## 2. Layout Architecture

### 2.1 Panel Positioning

The Git panel occupies the **same slot** as the existing File Browser and Memory panels — a column between the sidebar and chat area. These panels are **mutually exclusive**: opening Git closes File Browser/Memory and vice versa.

```
.main-body (flex row)
├── .sidebar (260px)
├── .file-panel OR .memory-panel OR .git-panel (280px, collapsible)  ← mutually exclusive
├── .preview-panel (400px, optional, for diff view)
└── .chat-area (flex: 1)
```

### 2.2 Responsive Behavior

| Viewport | Git Panel Behavior |
|----------|-------------------|
| **> 1200px** | Full panel (280px) + optional preview panel for diff |
| **768–1200px** | Narrower panel (`clamp(200px, 20vw, 280px)`) |
| **< 768px** | Replaces sidebar content (mobile view-switching, same as File Browser) |

---

## 3. Entry Point

### 3.1 Sidebar Working Directory Menu

Add a "Git" item to the existing dropdown menu in the sidebar, after "Memory":

```
┌─────────────────────┐
│ 📂 Browse Files     │
│ 📁 Change Directory │
│ 📋 Copy Path        │
│ 📄 Memory           │
│ ⎇  Git              │  ← NEW
└─────────────────────┘
```

The Git icon uses a branch/fork SVG. Clicking "Git" calls `workdirMenuGit()`, which:
1. Closes the dropdown menu
2. Closes any open File Browser or Memory panel
3. Opens the Git panel
4. Sends `{ type: 'git_status' }` to the agent to fetch current state
5. On mobile: switches `sidebarView` to `'git'`

---

## 4. Git Panel Structure (Desktop)

### 4.1 Panel Layout

```
┌─────────────────────────────┐
│  GIT        [↻]  [✕]       │  ← header (reuses file-panel-header style)
├─────────────────────────────┤
│  ⎇ master                   │  ← branch info bar
│  ← origin/master  ↑2 ↓0    │     tracking + ahead/behind
├─────────────────────────────┤
│  ▾ Staged (2)               │  ← collapsible group
│    A  new-file.ts           │     status icon + filename
│    M  store.js              │
│  ▾ Modified (3)             │  ← collapsible group
│    M  connection.ts         │
│    M  sidebar.js            │
│    M  App.vue               │
│  ▸ Untracked (1)            │  ← collapsible group (default collapsed)
│    ?  temp.js               │
├─────────────────────────────┤
│  Clean working tree ✓       │  ← shown when no changes (alternative)
└─────────────────────────────┘
```

### 4.2 Header

Reuses `.file-panel-header` styling:
- Title: "GIT" (uppercase, `0.8rem`, `var(--text-secondary)`)
- Refresh button (↻ icon) — re-sends `git_status` request
- Close button (✕ icon) — closes the panel

### 4.3 Branch Info Bar

Below the header, a compact info section:

```css
.git-branch-bar {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--border);
  font-size: 0.8rem;
  font-family: var(--font-mono);
}
```

- **Line 1**: Branch icon (SVG) + current branch name (bold)
- **Line 2**: Tracking remote name + ahead/behind badges
  - Ahead badge: `↑2` with green text
  - Behind badge: `↓3` with orange text
  - Up-to-date: no badges shown (or subtle "up to date" text)
- If **detached HEAD**: show abbreviated commit hash instead of branch name
- If **not a git repo**: show "Not a git repository" message and hide the file list

### 4.4 File Groups

Three collapsible sections, each showing a group of changed files:

| Group | Label | Default State | Condition |
|-------|-------|---------------|-----------|
| **Staged** | `Staged (N)` | Expanded | `N > 0` |
| **Modified** | `Modified (N)` | Expanded | `N > 0` |
| **Untracked** | `Untracked (N)` | Collapsed | `N > 0` |

Groups with zero files are hidden entirely.

Each group header is clickable to toggle expand/collapse, using the same arrow rotation pattern as the file tree (`▶` → rotates 90° when expanded).

### 4.5 File Items

Each file row shows:

```
[status-icon]  filename                          [path-hint]
```

- **Status icon**: Single colored letter (`M`, `A`, `D`, `R`, `?`, `C`)
- **Filename**: Just the basename (e.g., `store.js`), monospace font
- **Path hint**: For files not at repo root, show parent directory in smaller secondary text (e.g., `src/modules/`)
- **Hover**: Background highlight `var(--bg-tertiary)`, same as file tree
- **Click**: Opens diff in the Preview Panel (see section 5)

### 4.6 Status Icon Colors

| Icon | Status | Color |
|------|--------|-------|
| `M` | Modified | `#e5a50a` (amber) |
| `A` | Added | `#3fb950` (green) |
| `D` | Deleted | `#f85149` (red) |
| `R` | Renamed | `#58a6ff` (blue) |
| `C` | Copied | `#58a6ff` (blue) |
| `?` | Untracked | `var(--text-secondary)` (gray) |

These colors work on both light and dark themes (they're standard GitHub/VS Code git colors).

### 4.7 Empty State

When the working tree is clean (no staged, modified, or untracked files):

```
┌─────────────────────────────┐
│  GIT        [↻]  [✕]       │
├─────────────────────────────┤
│  ⎇ master                   │
│  ← origin/master            │
├─────────────────────────────┤
│                              │
│     ✓ Clean working tree    │  ← centered, muted text
│                              │
└─────────────────────────────┘
```

---

## 5. Diff View (Preview Panel)

### 5.1 Reuse Preview Panel

When a file is clicked in the Git panel, its diff is displayed in the **existing Preview Panel** (right side of the chat area). This reuses:
- The panel frame (`.preview-panel` with resize handle, header, close button)
- The panel transition animation
- The panel width persistence

The diff content replaces the normal file preview content. A `previewMode` state distinguishes between file preview and diff view.

### 5.2 Diff Header

```
┌──────────────────────────────────────┐
│  store.js   [Staged ▾]  [Raw]  [✕]  │
```

- **Filename**: Full relative path from repo root
- **Status badge**: Colored pill showing `Staged`, `Modified`, or `Untracked`
  - For files that are both staged and modified, a dropdown lets the user switch between staged diff (`--cached`) and unstaged diff
- **Raw toggle** (optional): Switch between rendered diff and raw diff text
- **Close button**: Closes the preview panel

### 5.3 Diff Body — Unified Diff View

The diff is rendered as a unified diff with syntax-aware line coloring:

```
┌──────────────────────────────────────┐
│  store.js   [Modified]         [✕]  │
├──────────────────────────────────────┤
│                                      │
│  @@ -42,6 +42,8 @@ setup()          │  ← hunk header
│                                      │
│  42  42   const workDir = ref('');   │  ← context line
│  43  43   const status = ref('idle');│
│     44 + const gitPanelOpen = ref(fa │  ← added line
│     45 + const gitInfo = ref(null);  │
│  44  46   const hostname = ref('');  │
│                                      │
│  @@ -128,3 +130,7 @@ setup()          │  ← next hunk
│                                      │
│ 128 130   function toggleSidebar() { │
│ 129    -   sidebarOpen.value = !side │  ← removed line
│     131+   sidebarOpen.value = !side │  ← added line
│     132+   if (gitPanelOpen.value) { │
│     133+     gitPanelOpen.value = fal│
│     134+   }                         │
│                                      │
└──────────────────────────────────────┘
```

### 5.4 Diff Line Styling

| Element | Style |
|---------|-------|
| **Hunk header** (`@@ ... @@`) | `background: var(--bg-tertiary)`, italic, full width, `color: var(--text-secondary)`, `padding: 4px 12px` |
| **Added line** (`+`) | `background: rgba(46, 160, 67, 0.15)`, `border-left: 3px solid #3fb950` |
| **Removed line** (`-`) | `background: rgba(248, 81, 73, 0.15)`, `border-left: 3px solid #f85149` |
| **Context line** | Normal background, no left border |
| **Line number gutter** | Two columns (old/new), `width: 40px` each, `color: var(--text-secondary)`, `font-size: 0.75rem`, `text-align: right`, `padding-right: 8px`, `user-select: none`, `border-right: 1px solid var(--border)` |
| **Diff content** | `font-family: var(--font-mono)`, `font-size: 0.8rem`, `line-height: 1.5`, `white-space: pre`, `overflow-x: auto` |

### 5.5 Line Number Gutter

Each diff line shows two line numbers side by side:

```
 old | new   line content
──────────────────────────
  42 |  42   const workDir = ref('');     ← context: both numbers
  43 |  43   const status = ref('idle');
     |  44 + const gitPanelOpen = ...     ← added: only new number
     |  45 + const gitInfo = ...
 129 |    -   sidebarOpen.value = ...     ← removed: only old number
  44 |  46   const hostname = ref('');
```

- Context lines: both old and new line numbers
- Added lines: only new line number (old side blank)
- Removed lines: only old line number (new side blank)

### 5.6 Hunk Collapsing

Each hunk (starting with `@@`) is independently collapsible:
- Default: all hunks expanded
- Click on hunk header to collapse/expand
- Collapsed hunk shows: `@@ -42,6 +42,8 @@  (6 lines hidden)`

This helps navigate large diffs.

### 5.7 Diff for New/Deleted/Binary Files

| Case | Display |
|------|---------|
| **New file** (untracked/added) | All lines shown as added (green), no old line numbers |
| **Deleted file** | All lines shown as removed (red), no new line numbers |
| **Renamed file** | Header shows `old-name → new-name`, diff of content changes if any |
| **Binary file** | "Binary file differs" message, no line-by-line diff |
| **Empty diff** | "No changes" message (file is staged with no content difference from HEAD) |

### 5.8 Large Diff Handling

If a diff exceeds **5000 lines**, truncate and show a notice:

```
┌──────────────────────────────────────┐
│  ... (diff truncated)                │
│  Showing first 5000 of 12340 lines   │
└──────────────────────────────────────┘
```

---

## 6. Mobile Behavior (< 768px)

### 6.1 Git View in Sidebar

On mobile, the Git panel replaces the sidebar content (same pattern as File Browser):

```
sidebarView = 'git'
```

```
┌─────────────────────────────┐
│  ← Sessions        [↻]     │  ← back button + refresh
├─────────────────────────────┤
│  ⎇ master                   │
│  ← origin/master  ↑2 ↓0    │
├─────────────────────────────┤
│  ▾ Staged (2)               │
│    A  new-file.ts           │
│    M  store.js              │
│  ▾ Modified (3)             │
│    ...                      │
└─────────────────────────────┘
```

### 6.2 Diff View on Mobile

Clicking a file on mobile:
1. Switches `sidebarView` to `'preview'` (reuses existing mobile preview view)
2. Renders the diff in the mobile preview panel
3. Back button returns to `'git'` view

---

## 7. WebSocket Protocol

### 7.1 New Message Types

**Web → Agent:**

| Type | Purpose | Fields |
|------|---------|--------|
| `git_status` | Request repo status | — |
| `git_diff` | Request diff for a file | `filePath: string`, `staged: boolean` |

**Agent → Web:**

| Type | Purpose | Fields |
|------|---------|--------|
| `git_status_result` | Repo status response | See 7.2 |
| `git_diff_result` | File diff response | See 7.3 |

### 7.2 `git_status_result` Payload

```typescript
{
  type: 'git_status_result',
  isRepo: boolean,              // false if not a git repository
  branch: string | null,        // current branch name, null if detached
  detachedHead: string | null,  // abbreviated commit hash if detached
  upstream: string | null,      // e.g. "origin/master"
  ahead: number,
  behind: number,
  staged: GitFileEntry[],
  modified: GitFileEntry[],
  untracked: GitFileEntry[],
}

interface GitFileEntry {
  path: string,        // relative path from repo root (e.g. "src/store.js")
  status: 'M' | 'A' | 'D' | 'R' | 'C' | '?',
  oldPath?: string,    // for renames: original path
}
```

### 7.3 `git_diff_result` Payload

```typescript
{
  type: 'git_diff_result',
  filePath: string,
  staged: boolean,
  diff: string,          // raw unified diff output
  binary: boolean,       // true if binary file
  error?: string,        // error message if diff failed
}
```

The raw diff string is parsed client-side into hunks and lines for rendering. This keeps the agent simple (just runs `git diff` and returns the output) and moves presentation logic to the frontend.

### 7.4 Agent-Side Git Commands

The agent executes these git commands in the current working directory:

| Command | Purpose |
|---------|---------|
| `git rev-parse --is-inside-work-tree` | Check if workdir is a git repo |
| `git rev-parse --abbrev-ref HEAD` | Current branch name (returns "HEAD" if detached) |
| `git rev-parse --short HEAD` | Short commit hash (for detached head display) |
| `git rev-parse --abbrev-ref @{upstream}` | Upstream tracking branch |
| `git rev-list --left-right --count HEAD...@{upstream}` | Ahead/behind counts |
| `git status --porcelain=v2` | Structured file status |
| `git diff -- <file>` | Unstaged diff for a specific file |
| `git diff --cached -- <file>` | Staged diff for a specific file |
| `git diff -- .` | Full unstaged diff (for untracked files: `git diff --no-index /dev/null <file>`) |

All commands use `child_process.execFile` (not `exec`) to avoid shell injection. File paths from the client are validated against the working directory to prevent path traversal.

---

## 8. Agent-Side Implementation

### 8.1 New File: `agent/src/git-handlers.ts`

```typescript
export function createGitHandlers(workDir: string, send: SendFn) {
  return {
    handleGitStatus,
    handleGitDiff,
  };
}
```

### 8.2 `handleGitStatus()`

1. Run `git rev-parse --is-inside-work-tree` — if fails, send `{ isRepo: false }`
2. Run branch/upstream/ahead-behind commands in parallel (`Promise.all`)
3. Run `git status --porcelain=v2` and parse output:
   - Lines starting with `1` or `2`: tracked changes (extract staged vs. unstaged from XY status field)
   - Lines starting with `?`: untracked files
4. Build and send `git_status_result`

### 8.3 `handleGitDiff(msg)`

1. Validate `msg.filePath` is relative and within the working directory
2. Run `git diff [--cached] -- <filePath>`
3. Check if output is empty or contains "Binary files differ"
4. Send `git_diff_result`

### 8.4 Security

- All file paths received from the web client must be validated:
  - Must be relative (no absolute paths)
  - Must not contain `..` path traversal
  - Must resolve to within the current working directory
- Use `execFile` (not `exec`) to prevent shell injection
- Set `maxBuffer` to 5MB for diff output to handle large files
- Set execution timeout (10s) for git commands

---

## 9. Web-Side Implementation

### 9.1 New Module: `modules/git.js`

```javascript
export function createGit(deps) {
  // deps: wsSend, workDir, gitPanelOpen, previewFile, previewPanelOpen

  // Internal reactive state
  const gitInfo = ref(null);        // git_status_result data
  const gitLoading = ref(false);    // loading indicator
  const gitDiffLoading = ref(false);
  const expandedGroups = ref({ staged: true, modified: true, untracked: false });

  return {
    gitInfo,
    gitLoading,
    gitDiffLoading,
    expandedGroups,
    openPanel,           // Open git panel + fetch status
    closePanel,          // Close git panel
    refresh,             // Re-fetch git status
    toggleGroup,         // Expand/collapse a file group
    openFileDiff,        // Click a file → request + show diff
    handleGitStatus,     // Process git_status_result message
    handleGitDiff,       // Process git_diff_result message
    parseDiff,           // Parse raw diff string into structured hunks
  };
}
```

### 9.2 Diff Parser (`parseDiff`)

Parse the raw unified diff string into a structured format for rendering:

```javascript
function parseDiff(rawDiff) {
  // Returns:
  // {
  //   hunks: [
  //     {
  //       header: '@@ -42,6 +42,8 @@ setup()',
  //       oldStart: 42, oldCount: 6,
  //       newStart: 42, newCount: 8,
  //       lines: [
  //         { type: 'context', content: '  const workDir = ref("");', oldLine: 42, newLine: 42 },
  //         { type: 'add', content: '  const gitPanelOpen = ref(false);', newLine: 44 },
  //         { type: 'remove', content: '  sidebarOpen.value = !sidebar', oldLine: 129 },
  //       ]
  //     },
  //     ...
  //   ]
  // }
}
```

This parsing happens entirely on the client side.

### 9.3 Integration with Preview Panel

The diff view reuses the existing `preview-panel` infrastructure. When a git file is clicked:

1. Set `previewFile` to a special object with `isDiff: true` flag
2. Open `previewPanelOpen`
3. The Preview Panel template checks `previewFile.isDiff` and renders the diff template instead of the normal file preview template

```javascript
// In openFileDiff():
previewFile.value = {
  fileName: entry.path,
  filePath: entry.path,
  isDiff: true,
  staged: isStaged,
  status: entry.status,
  diffLoading: true,
  hunks: [],
};
previewPanelOpen.value = true;
wsSend({ type: 'git_diff', filePath: entry.path, staged: isStaged });
```

When `git_diff_result` arrives:
```javascript
previewFile.value.diffLoading = false;
previewFile.value.hunks = parseDiff(msg.diff);
previewFile.value.binary = msg.binary;
```

### 9.4 Handler Registration

In `modules/handlers/feature-handler.js`, add handlers for `git_status_result` and `git_diff_result`:

```javascript
git_status_result: (msg) => deps.git.handleGitStatus(msg),
git_diff_result: (msg) => deps.git.handleGitDiff(msg),
```

---

## 10. State Management

### 10.1 New Reactive Refs

| Ref | Type | Default | Location |
|-----|------|---------|----------|
| `gitPanelOpen` | `boolean` | `false` | `store.js` |
| `gitInfo` | `object\|null` | `null` | `git.js` |
| `gitLoading` | `boolean` | `false` | `git.js` |
| `gitDiffLoading` | `boolean` | `false` | `git.js` |
| `expandedGroups` | `object` | `{ staged: true, modified: true, untracked: false }` | `git.js` |

### 10.2 Panel Mutual Exclusion

Opening the Git panel closes File Browser and Memory panels:

```javascript
function openPanel() {
  filePanelOpen.value = false;
  memoryPanelOpen.value = false;
  gitPanelOpen.value = true;
  refresh();
}
```

Similarly, opening File Browser or Memory closes the Git panel.

### 10.3 Workdir Change

When the working directory changes, if the Git panel is open:
- Clear `gitInfo`
- Re-fetch git status for the new directory

### 10.4 Conversation Switching

Git panel state is **global** (not per-conversation), same as File Browser. The git status reflects the current working directory shared across all conversations.

---

## 11. New Vue Component: `GitPanel.vue`

A new SFC component at `server/web/src/components/GitPanel.vue`, following the same pattern as `FilePanel.vue` and `PreviewPanel.vue`.

### 11.1 Template Structure

```html
<template>
  <!-- Desktop git panel -->
  <Transition name="file-panel">
    <div v-if="gitPanelOpen && !isMobile" class="file-panel git-panel">
      <!-- Header -->
      <div class="file-panel-header">
        <span class="file-panel-title">GIT</span>
        <div class="file-panel-actions">
          <button class="file-panel-btn" @click="refresh()" :title="t('sidebar.refresh')">↻</button>
          <button class="file-panel-btn" @click="gitPanelOpen = false">✕</button>
        </div>
      </div>

      <!-- Branch info -->
      <div class="git-branch-bar">...</div>

      <!-- Loading -->
      <div v-if="gitLoading" class="file-panel-loading">Loading...</div>

      <!-- Not a repo -->
      <div v-else-if="gitInfo && !gitInfo.isRepo" class="git-not-repo">Not a git repository</div>

      <!-- File groups -->
      <div v-else-if="gitInfo" class="git-file-list">
        <!-- Staged group -->
        <!-- Modified group -->
        <!-- Untracked group -->
        <!-- Clean state -->
      </div>
    </div>
  </Transition>
</template>
```

---

## 12. New CSS: `css/git.css`

### 12.1 Branch Bar

```css
.git-branch-bar {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--border);
  font-family: var(--font-mono);
  font-size: 0.8rem;
}

.git-branch-name {
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.git-tracking {
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin-top: 2px;
}

.git-ahead {
  color: #3fb950;
  font-weight: 600;
}

.git-behind {
  color: #e5a50a;
  font-weight: 600;
}
```

### 12.2 File Groups

```css
.git-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
}

.git-group-header:hover {
  background: var(--bg-tertiary);
}

.git-file-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px 3px 24px;   /* indented under group */
  font-size: 0.8rem;
  font-family: var(--font-mono);
  cursor: pointer;
}

.git-file-item:hover {
  background: var(--bg-tertiary);
}

.git-status-icon {
  flex-shrink: 0;
  width: 14px;
  font-weight: 700;
  text-align: center;
}

.git-status-M { color: #e5a50a; }
.git-status-A { color: #3fb950; }
.git-status-D { color: #f85149; }
.git-status-R { color: #58a6ff; }
.git-status-C { color: #58a6ff; }
.git-status-U { color: var(--text-secondary); }

.git-file-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-file-dir {
  font-size: 0.7rem;
  color: var(--text-secondary);
  margin-left: 4px;
}
```

### 12.3 Diff View

```css
.diff-container {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  line-height: 1.5;
  overflow: auto;
  height: 100%;
}

.diff-hunk-header {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-style: italic;
  padding: 4px 12px;
  cursor: pointer;
  user-select: none;
  border-top: 1px solid var(--border);
  font-size: 0.75rem;
}

.diff-hunk-header:first-child {
  border-top: none;
}

.diff-line {
  display: flex;
  min-height: 1.5em;
  white-space: pre;
}

.diff-line-add {
  background: rgba(46, 160, 67, 0.15);
  border-left: 3px solid #3fb950;
}

.diff-line-remove {
  background: rgba(248, 81, 73, 0.15);
  border-left: 3px solid #f85149;
}

.diff-line-context {
  border-left: 3px solid transparent;
}

.diff-gutter {
  display: flex;
  flex-shrink: 0;
  user-select: none;
}

.diff-line-number {
  width: 40px;
  text-align: right;
  padding-right: 8px;
  color: var(--text-secondary);
  font-size: 0.75rem;
  border-right: 1px solid var(--border);
}

.diff-line-number:last-child {
  margin-right: 8px;
}

.diff-line-content {
  flex: 1;
  padding-left: 8px;
  overflow-x: auto;
}

.diff-status-badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 0.7rem;
  font-weight: 600;
}

.diff-status-badge.staged { background: rgba(63, 185, 80, 0.2); color: #3fb950; }
.diff-status-badge.modified { background: rgba(229, 165, 10, 0.2); color: #e5a50a; }
.diff-status-badge.untracked { background: var(--bg-tertiary); color: var(--text-secondary); }

.diff-binary-notice,
.diff-empty-notice {
  padding: 1rem;
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.diff-truncated-notice {
  padding: 0.5rem 0.75rem;
  font-size: 0.75rem;
  color: var(--text-secondary);
  border-top: 1px solid var(--border);
  background: var(--bg-secondary, var(--bg-primary));
  text-align: center;
}

.git-clean-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem 1rem;
  color: var(--text-secondary);
  font-size: 0.85rem;
  gap: 0.5rem;
}

.git-not-repo {
  padding: 2rem 1rem;
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.85rem;
}
```

---

## 13. Edge Cases

| Scenario | Handling |
|----------|----------|
| **Not a git repo** | `git rev-parse` fails → `isRepo: false` → show "Not a git repository" message |
| **Detached HEAD** | Show abbreviated commit hash instead of branch name |
| **No upstream** | Hide tracking/ahead-behind section, show just branch name |
| **Large diff (> 5000 lines)** | Truncate diff output, show "diff truncated" notice |
| **Binary files** | `binary: true` in response → show "Binary file differs" message |
| **Renamed file** | Show `oldPath → path` in the file item and diff header |
| **Permission error** | Git command fails → `error` field in response → show error inline |
| **Agent disconnect** | Panel stays visible but non-interactive; reconnection re-enables |
| **Workdir change** | Clear git state, re-fetch if panel is open |
| **Very large number of changed files (100+)** | Render all; virtualization out of scope for v1 |
| **Git command timeout** | 10s timeout per command; error shown to user |
| **Concurrent requests** | Ignore stale responses (compare response workDir with current) |

---

## 14. Files Changed

| File | Changes |
|------|---------|
| `agent/src/git-handlers.ts` | **New file** — `createGitHandlers()`: git status + diff command execution |
| `agent/src/connection.ts` | Register `git_status` and `git_diff` message handlers |
| `server/web/src/modules/git.js` | **New file** — `createGit()`: git state management, diff parser |
| `server/web/src/components/GitPanel.vue` | **New file** — Git panel component (desktop + mobile) |
| `server/web/src/components/Sidebar.vue` | Add "Git" menu item to workdir dropdown |
| `server/web/src/components/PreviewPanel.vue` | Add diff view template (conditional on `previewFile.isDiff`) |
| `server/web/src/css/git.css` | **New file** — Git panel + diff view styles |
| `server/web/src/modules/sidebar.js` | Add `workdirMenuGit()` function |
| `server/web/src/modules/handlers/feature-handler.js` | Add `git_status_result` and `git_diff_result` handlers |
| `server/web/src/store.js` | Add `gitPanelOpen` ref, create + provide git module |
| `server/web/src/App.vue` | Import and render `GitPanel` component |
| `server/web/src/main.js` | Import `git.css` |

---

## 15. Implementation Order

1. **Agent: `git-handlers.ts`** — Implement `handleGitStatus()` (parse `git status --porcelain=v2`, branch info, ahead/behind) and `handleGitDiff()` (run `git diff` with path validation). Unit tests in `test/agent/git-handlers.test.ts`.

2. **Agent: register handlers** — Wire up `git_status` and `git_diff` message types in `connection.ts`.

3. **Web: `modules/git.js`** — Create module with state management, diff parser, and preview panel integration. Unit test the diff parser in `test/web/gitDiffParser.test.ts`.

4. **Web: `GitPanel.vue`** — Build the panel component with branch bar, file groups, and loading/empty states.

5. **Web: diff view in `PreviewPanel.vue`** — Add the diff rendering template with line numbers, hunk headers, and colored lines.

6. **Web: `css/git.css`** — All git-specific styles.

7. **Web: sidebar integration** — Add "Git" menu item to `Sidebar.vue`, `workdirMenuGit()` to `sidebar.js`, `gitPanelOpen` to `store.js`.

8. **Web: handler registration** — Add `git_status_result` and `git_diff_result` to `feature-handler.js`.

9. **Web: mobile support** — Add `sidebarView === 'git'` mobile view in `Sidebar.vue`.

10. **Functional test** — Add `test/functional/git-panel.test.ts` with mock agent sending git status/diff messages, verify UI rendering.

---

## 16. Future Enhancements (Out of Scope)

Not part of the initial implementation:

- Git operations (commit, push, pull, stage, unstage, stash)
- Git log / commit history viewer
- Side-by-side diff view (vs. unified)
- Inline word-level diff highlighting
- Auto-refresh on file system changes
- Branch switching UI
- Git blame / annotation
- Merge conflict resolution UI
- Stash list viewer
- `.gitignore` awareness in untracked list
