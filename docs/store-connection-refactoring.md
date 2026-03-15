# Store & Connection Refactoring Plan

## Overview

Refactor `store.js` (947 lines) and `connection.js` (731 lines) before Phase 9 cutover.

---

## Part 1: store.js — Multi-Provide Pattern

### Problem
store.js has a 233-line return block where **170+ properties are re-exports** from sub-modules (team ~65, loop ~70, sidebar ~30, memory ~6, fileBrowser ~3, etc.). Components do `inject('store')` and destructure everything from one giant object.

### Solution
Split into multiple `provide()` calls so components inject directly from domain modules. Store keeps only chat core + module orchestration.

### New Provide Keys

| Key | Source | What it provides |
|-----|--------|-----------------|
| `store` | store.js | Chat core: messages, input, send, status, theme, i18n, auth, attachments, plan mode, btw, slash menu, viewMode, message helpers |
| `team` | team.js return | All team properties (~65): viewMode, teamsList, launchTeam, dissolveTeam, TEMPLATES, etc. |
| `loop` | loop.js return | All loop properties (~70): loopsList, toggleLoop, runNow, LOOP_TEMPLATES, etc. |
| `sidebar` | sidebar.js return | All sidebar properties (~30): toggleSidebar, sessions, folder picker, workdir, rename/delete |
| `files` | Composed in store | fileBrowser, filePreview, memory, filePanel state |

### Component Changes

Each component changes `inject('store')` to inject from specific keys:

| Component | Current | After |
|-----------|---------|-------|
| **TopBar.vue** | `inject('store')` | `inject('store')` + `inject('sidebar')` for toggleSidebar |
| **ChatInput.vue** | `inject('store')` | `inject('store')` only (all chat-core) |
| **ChatView.vue** | `inject('store')` | `inject('store')` + `inject('team')` for team ref |
| **TeamView.vue** | `inject('store')` | `inject('store')` + `inject('team')` |
| **LoopView.vue** | `inject('store')` | `inject('store')` + `inject('loop')` |
| **Sidebar.vue** | `inject('store')` | `inject('store')` + `inject('sidebar')` + `inject('team')` + `inject('loop')` + `inject('files')` |
| **FilePanel.vue** | `inject('store')` | `inject('store')` + `inject('files')` |
| **PreviewPanel.vue** | `inject('store')` | `inject('store')` + `inject('files')` |
| **AuthDialog.vue** | `inject('store')` | `inject('store')` only |
| **ConfirmDialog.vue** | `inject('store')` | `inject('store')` + `inject('team')` |
| **FolderPickerDialog.vue** | `inject('store')` | `inject('sidebar')` |
| **BtwOverlay.vue** | `inject('store')` | `inject('store')` only |

### store.js Return Block Changes

**Delete from return block (~170 lines):**
- All team forwarding (~65 properties)
- All loop forwarding (~70 properties)
- All sidebar forwarding (~30 properties): toggleSidebar, sessions, folder picker, workdir, rename/delete
- All files forwarding (~10 properties): fileBrowser, filePreview, memory panel methods

**Keep in return block (~60 properties):**
- Connection: status, agentName, hostname, workDir, sessionId, error, serverVersion, agentVersion, latency, wsSend
- Messages: messages, visibleMessages, hasMoreMessages, loadMoreMessages, inputText, isProcessing, isCompacting, queuedMessages, usageStats, hasStreamingMessage
- Send/input: canSend, hasInput, sendMessage, cancelExecution, inputRef, fileInputRef
- Slash menu: slashMenuVisible, slashMenuOpen, slashMenuIndex, filteredSlashCommands, selectSlashCommand, handleKeydown, autoResize, openSlashMenu
- Plan mode: planMode, pendingPlanMode, togglePlanMode
- Btw: btwState, btwPending, dismissBtw
- Message helpers: renderMarkdown, getRenderedContent, copyMessage, toggleContextSummary, toggleTool, isEditTool, getEditDiffHtml, getFormattedToolInput, getToolIcon, getToolSummary, isPrevAssistant, formatTimestamp
- Ask question: selectQuestionOption, submitQuestionAnswer, hasQuestionAnswer, getQuestionResponseSummary
- Theme/i18n: theme, toggleTheme, t, locale, toggleLocale, localeLabel, displayStatus
- Auth: authRequired, authLocked, authPassword, authError, authAttempts, submitPassword
- Attachments: attachments, triggerFileInput, handleFileSelect, removeAttachment, formatFileSize, handleDragOver, handleDragLeave, handleDrop, handlePaste, dragOver
- UI: viewMode, isMobile, loadingHistory, onMessageListScroll, formatUsage, removeQueuedMessage
- Misc: conversationCache/currentConversationId/processingConversations (needed by sidebar, but sidebar can access via late-bind)

### App.vue Changes

```js
// Before:
const store = createStore();
provide('store', store);

// After:
const store = createStore();
provide('store', store);
provide('team', store._team);      // raw team module return
provide('loop', store._loop);      // raw loop module return
provide('sidebar', store._sidebar); // raw sidebar module return
provide('files', store._files);     // composed files object
```

store.js exposes `_team`, `_loop`, `_sidebar`, `_files` as internal refs (not in the public return block, just on the store object for App.vue to provide).

### Expected Result
- store.js: **947 → ~550 lines** (delete ~170 forwarding + ~230 line return block shrinks to ~80)
- Each component: minor change (add 1-2 inject calls, move destructures)

---

## Part 2: connection.js — Extract Handler Modules

### Problem
`connect()` function is 507 lines with all WebSocket message handlers inlined in one giant `onmessage` callback.

### Solution
Extract message handlers into domain-specific handler modules. connection.js becomes a thin WebSocket manager + dispatcher.

### New File Structure

```
modules/
  connection.js              (~200 lines) Core WebSocket, connect/reconnect, dispatch
  handlers/
    claude-output.js         (~80 lines)  handleClaudeOutput, finalizeStreamingMsg, tool msg map
    session-handler.js       (~70 lines)  sessions_list, conversation_resumed, session_deleted/renamed
    execution-handler.js     (~60 lines)  turn_completed, execution_cancelled, context_compaction
    file-handler.js          (~50 lines)  directory_listing, file_content, memory_*
    feature-handler.js       (~50 lines)  btw_answer, plan_mode_changed, workdir_changed
```

### Handler Interface

Each handler module exports a factory:
```js
export function createClaudeOutputHandlers(deps) {
  // deps = { messages, streaming, team, loop, ... }
  return {
    claude_output: (msg) => { ... },
  };
}
```

connection.js merges all handlers into a dispatch map:
```js
const handlers = {
  ...createClaudeOutputHandlers(deps),
  ...createSessionHandlers(deps),
  ...createExecutionHandlers(deps),
  ...createFileHandlers(deps),
  ...createFeatureHandlers(deps),
};

ws.onmessage = (raw) => {
  const msg = decrypt(raw);
  // Special routing for team/loop/background stays in connection.js
  if (msg.teamId) { team?.handleMessage(msg); return; }
  if (isLoopMessage(msg)) { loop?.handleMessage(msg); return; }
  handlers[msg.type]?.(msg);
};
```

### What Stays in connection.js
- WebSocket creation, open/close/error handlers
- Encryption/decryption
- `wsSend()`, `startPing()`, `stopPing()`
- `scheduleReconnect()`
- Late-binding setters
- Auth message handling (small, tightly coupled to connect flow)
- Team/loop/background routing (dispatch logic)
- `connected` / `agent_disconnected` / `agent_reconnected` / `active_conversations` (connection lifecycle)

### Expected Result
- connection.js: **731 → ~250 lines**
- 5 handler files: ~50-80 lines each

---

## Execution Order

1. **Refactor store.js** — multi-provide, update all 13 components
2. **Refactor connection.js** — extract handlers
3. **Rebuild + E2E verify** — same smoke test as before
4. **Commit**

Phase 9 cutover deferred — user will review after E2E.
