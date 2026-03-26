# Global Recent Sessions

## Goal

Provide an entry point to display the most recent N sessions across **all working directories**, not just the current one. Clicking a session switches workDir and resumes it.

## Data Source

### JSONL files in `~/.claude/projects/`

```
~/.claude/projects/
├── Q--src-agentlink/          # one folder per workDir
│   ├── <sessionId>.jsonl
│   └── ...
├── C--Users-kailunshi-Desktop-my-kusto/
│   ├── <sessionId>.jsonl
│   └── ...
└── ...
```

Each folder name is a sanitized workDir (via Claude's `pathToProjectFolder`: all non-alphanumeric chars → `-`).

### What's inside each JSONL

Each line is a JSON object. The first `type: "user"` message contains everything we need:

```json
{
  "type": "user",
  "cwd": "Q:\\src\\agentlink",          // ← original workDir (projectPath)
  "sessionId": "01c02fca-...",
  "gitBranch": "master",
  "version": "2.1.74",
  "timestamp": "2026-03-22T12:04:57.336Z",
  "message": {
    "role": "user",
    "content": "the user's first message..."
  }
}
```

Other useful record types in the same file:
- `type: "custom-title"` → `{ title: "..." }` (user-set title, best display name)
- `type: "summary"` → AI-generated summary (fallback title)

### Why not `sessions-index.json`?

Claude Code has a bug ([#25032](https://github.com/anthropics/claude-code/issues/25032)) where `sessions-index.json` stops being updated. Only 3 of 22 project folders on the dev machine have this file, all stale since early Feb 2026. Community workaround: [repair script](https://gist.github.com/tirufege/0720c288092c1a3a4750f7c198aa524b) that rebuilds it from JSONL. We skip this file entirely and read JSONL directly.

## Data Extraction Strategy

### For each project folder under `~/.claude/projects/`:

1. List `*.jsonl` files, sort by **file mtime** descending
2. Take only the top N files (e.g., 5 per project) to limit I/O
3. For each file, read only the **first few lines** (not the whole file):
   - First `type: "user"` line → extract `cwd`, `sessionId`, `timestamp`, `message.content` (truncate to ~100 chars as `firstPrompt`)
   - `type: "custom-title"` line → extract `title` (if present, within first ~20 lines)
   - `type: "summary"` line → extract summary (fallback title)
4. Use file `mtime` as `lastModified` (avoids reading the entire file for the last timestamp)

### Output per session:

```typescript
interface GlobalSessionInfo {
  sessionId: string;
  projectPath: string;    // from cwd field — needed for workDir switch + resume
  projectFolder: string;  // sanitized folder name, e.g. "Q--src-agentlink"
  title: string;          // custom-title > summary > firstPrompt (truncated)
  firstPrompt: string;    // first user message (truncated ~100 chars)
  lastModified: number;   // file mtime (epoch ms)
  gitBranch?: string;
}
```

### Merge & sort:

Collect sessions from all project folders, sort by `lastModified` descending, return top N globally (e.g., 20).

## Message Protocol

New message type: `list_recent_sessions` (web → agent) and `recent_sessions_list` (agent → web).

```
Web → Agent:  { type: "list_recent_sessions", limit?: number }
Agent → Web:  { type: "recent_sessions_list", sessions: GlobalSessionInfo[] }
```

## Resume Flow

When user clicks a global session that belongs to a **different** workDir:

1. Send `change_workdir` with the session's `projectPath`
2. Wait for `workdir_changed` confirmation
3. Send `resume_conversation` with the `sessionId`

If the session belongs to the **current** workDir, skip step 1-2 and resume directly.

## Performance Notes

- File mtime sorting avoids reading file contents just to rank recency
- Reading only the first few lines of each JSONL is fast (~microseconds per file)
- Capping per-project files (e.g., top 5 by mtime) bounds total I/O even with many projects
- Total scan: ~20 projects × 5 files × few lines each = negligible

## UI

### Placement: Tab switcher in the workdir area

Replace the current "Recent Directories" section with a two-tab switcher:

```
┌──────────────────────────┐
│ Working Directory        │
│ Q:\src\agentlink      ▼  │
├──────────────────────────┤
│ Recent                   │  ← section label (replaces "Recent Directories")
│ [Dirs | Sessions]        │  ← tab toggle (same style as Chat|Feed segmented control)
├──────────────────────────┤

  Tab: Dirs                     Tab: Sessions
  (current behavior)            (new)
┌──────────────────────┐    ┌──────────────────────────┐
│ Q:\src\my-kusto      │    │ Fix login bug            │
│ C:\Users\kailunshi × │    │   agentlink · 2h ago     │
│ ...                  │    │ Review PR #42            │
└──────────────────────┘    │   my-kusto · yesterday   │
                            │ Refactor auth module     │
                            │   CyberX · 3 days ago    │
                            └──────────────────────────┘
```

### Dirs tab (default)

Exactly the current "Recent Directories" behavior — list of previously visited workDirs with delete buttons.

### Sessions tab

- Each item shows: **title** (line 1) + **project name · relative time** (line 2, dimmed)
- Project name = last segment of `projectPath` (e.g., `Q:\src\agentlink` → `agentlink`)
- Sorted by `lastModified` descending, show top 20
- Data loaded lazily: first switch to the Sessions tab sends `list_recent_sessions`
- Clicking a session:
  - If `projectPath` matches current workDir → resume directly
  - Otherwise → `change_workdir` first, then resume
