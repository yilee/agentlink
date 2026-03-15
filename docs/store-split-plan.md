# Store.js Split Plan

## Current State

`server/web-src/src/store.js` — 1231 lines, structured as:

| Section | Lines | Content |
|---------|-------|---------|
| Imports | 1-26 | 11 factory + utility imports |
| SLASH_COMMANDS | 28-34 | Constant array |
| createStore() | 40-1231 | Main factory function |
| ├─ ref() declarations | 41-220 | ~70 reactive state vars |
| ├─ switchConversation | 223-303 | Multi-session cache logic |
| ├─ i18n + scroll + highlight | 305-328 | Module setup |
| ├─ Module instantiation | 330-425 | 8 factory calls + circular dep resolution |
| ├─ Event handlers | 427-440 | Resize, click, keyboard |
| ├─ Computed properties | 441-461 | 8 computed (hasInput, canSend, etc.) |
| ├─ Standalone functions | 463-691 | sendMessage, handleKeydown, autoResize, etc. |
| ├─ Watchers + lifecycle | 693-747 | 5 watch() + onMounted/onUnmounted |
| └─ Return block | 749-1231 | 482 lines: forwarding + ~30 inline methods |

## Problem

The return block (482 lines) contains ~30 inline method implementations that belong in domain modules. Combined with ~70 undifferentiated ref declarations, this makes the file hard to navigate.

## Strategy

Move inline methods AND their associated refs out of store.js into existing (or new) module files. Each module already uses the factory pattern `createFoo(deps) → methods`, so we extend their interfaces.

After splitting, store.js should be ~500-600 lines with a ~150-line return block that only forwards.

## Extraction Plan

### A. Team methods → `modules/team.js` (existing)

**Methods to move** (currently inline in return block):
- `startTeamRename(tm)`, `confirmTeamRename()`, `cancelTeamRename()`
- `requestDeleteTeam(tm)`, `confirmDeleteTeam()`, `cancelDeleteTeam()`
- `launchTeamFromPanel()`, `formatTeamTime(ts)`, `getTaskAgent(task)`, `viewAgentWithHistory(agent)`, `getLatestAgentActivity(agent)`

**Refs to move**:
- `renamingTeamId`, `renameTeamText`
- `deleteTeamConfirmOpen`, `deleteTeamConfirmTitle`, `pendingDeleteTeamId`
- `teamInstruction`, `selectedTemplate`, `editedLeadPrompt`, `leadPromptExpanded`, `kanbanExpanded`, `instructionExpanded`

**Dependencies needed**: `wsSend`, `sidebar.resumeSession`, `sidebar.loadSessions`, `TEMPLATES`, `TEMPLATE_KEYS`, `buildFullLeadPrompt`

### B. Loop methods → `modules/loop.js` (existing)

**Methods to move**:
- `startLoopRename(lp)`, `confirmLoopRename()`, `cancelLoopRename()`
- `requestDeleteLoop(lp)`, `confirmDeleteLoop()`, `cancelDeleteLoop()`
- `newLoop()`, `viewLoop(lp)`, `selectLoopTemplate(key)`
- `formatDuration(ms)`, `padTwo(n)`

**Refs to move**:
- `loopName`, `loopPrompt`, `loopScheduleType`, `loopScheduleHour`, `loopScheduleMinute`, `loopScheduleDayOfWeek`, `loopCronExpr`, `loopSelectedTemplate`
- `loopDeleteConfirmOpen`, `loopDeleteConfirmId`, `loopDeleteConfirmName`
- `renamingLoopId`, `renameLoopText`

**Dependencies needed**: `wsSend`, `sidebar.loadSessions`, `LOOP_TEMPLATES`, `LOOP_TEMPLATE_KEYS`, `buildCronExpression`, `formatSchedule`

### C. Memory methods → `modules/memory.js` (NEW)

**Methods to move**:
- `workdirMenuMemory()`, `refreshMemory()`, `openMemoryFile(file)`
- `startMemoryEdit()`, `cancelMemoryEdit()`, `saveMemoryEdit()`, `deleteMemoryFile()`

**Refs to move**:
- `memoryPanelOpen`, `memoryFiles`, `memoryDir`
- `memoryLoading`, `memoryEditing`, `memoryEditContent`, `memorySaving`

**Dependencies needed**: `wsSend`, `workDir`

**Factory signature**: `createMemory({ wsSend, workDir })`

### D. Workdir menu methods → `modules/sidebar.js` (existing)

**Methods to move**:
- `workdirMenuBrowse()`, `workdirMenuChangeDir(entry)`, `workdirMenuCopyPath()`

**Refs to move**:
- `workdirMenuOpen`, `workdirHistory`, `workdirSwitching`

**Dependencies needed**: `wsSend`, `workDir`, `sidebar.openFolderPicker`, `sidebar.changeWorkDir`

### E. What stays in store.js

- `switchConversation()` — cross-module orchestration
- `sendMessage()` — cross-module orchestration
- `handleKeydown()` — cross-module orchestration
- `autoResize()` — simple UI helper
- `loadMoreMessages()` — simple UI helper
- `feedAgentName()`, `feedContentRest()` — template adapters
- `_isPrevAssistant()`, `_submitQuestionAnswer()` — wrappers
- All computed properties (hasInput, canSend, slashMenuVisible, etc.)
- All watchers
- Lifecycle hooks (onMounted, onUnmounted)
- Module instantiation & circular dependency resolution
- Core refs not belonging to any domain (status, messages, inputText, isProcessing, sessionId, etc.)

## Execution Order

1. **A: Team** — Move team inline methods + refs to `modules/team.js`
2. **B: Loop** — Move loop inline methods + refs to `modules/loop.js`
3. **C: Memory** — Create `modules/memory.js`, move memory methods + refs
4. **D: Workdir menu** — Move workdir menu methods + refs to `modules/sidebar.js`
5. Build + test after each step, commit after all 4

## Estimated Result

| File | Before | After |
|------|--------|-------|
| store.js | 1231 | ~500-600 |
| team.js | 396 | ~500 |
| loop.js | 338 | ~450 |
| memory.js | (new) | ~80 |
| sidebar.js | 402 | ~430 |

## Risk & Constraints

- Must use Node.js scripts (`.cjs` files) to read/transform store.js — do NOT load the full file into Claude's context
- Module factory functions already accept dependency objects, so extending params is natural
- Return block forwarding: after extraction, each module returns its refs + methods, store.js spreads them into the return object
- Build + test must pass after each step
