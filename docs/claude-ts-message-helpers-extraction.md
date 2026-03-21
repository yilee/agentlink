# Design: Extract Message Helpers from claude.ts

## Motivation

`agent/src/claude.ts` is 1,228 lines — the largest file in the project. It mixes 6+ responsibilities into a single module. This PR extracts the **message processing helpers** into a dedicated file as the first low-risk step.

## What Moves

The following 5 exported functions (lines 790–920, ~131 lines) move to a new file `agent/src/claude-message-helpers.ts`:

| Function | Lines | Purpose |
|----------|-------|---------|
| `handleResultMessage()` | 796–827 | Process `result` message: extract errors, send `turn_completed` with usage stats |
| `handleAssistantMessage()` | 833–871 | Compute text delta, forward `tool_use` blocks (excluding `AskUserQuestion`) |
| `isTaskNotification()` | 877–889 | Detect `<task-notification>` in user messages |
| `handleUserMessage()` | 895–920 | Forward tool results, extract `<local-command-stdout/stderr>` |
| `buildControlResponse()` | 110–125 | Build `control_response` JSON envelope |

### Dependencies these functions need

- Types: `ClaudeMessage`, `ConversationState`, `SendFn` (all from `claude.ts`)
- No module-level state access (no `conversations`, `sendFn`, `pendingControlRequests`)
- No Node.js imports (no `child_process`, `fs`, `readline`)

These are **pure functions** (or near-pure — `handleResultMessage` mutates the `state` arg passed to it, but has no side effects beyond that).

## What Stays in claude.ts

Everything else stays: types, constants, module state, observer chain, public API (`handleChat`, `abort`, `handleBtwQuestion`, etc.), `processOutput` loop, `startQuery`, `cleanupConversation`, permission handling.

`claude.ts` will import the 5 functions from `claude-message-helpers.ts` and re-export them for backward compatibility.

## File Naming

`claude-message-helpers.ts` — follows existing naming pattern (`team-templates.ts`, `team-persistence.ts`, `team-naming.ts`, `directory-handlers.ts`, `git-handlers.ts`).

## Changes

### New file: `agent/src/claude-message-helpers.ts`

```typescript
import type { ClaudeMessage, ConversationState, SendFn } from './claude.js';

export function buildControlResponse(...) { ... }
export function handleResultMessage(...) { ... }
export function handleAssistantMessage(...) { ... }
export function isTaskNotification(...) { ... }
export function handleUserMessage(...) { ... }
```

### Modified: `agent/src/claude.ts`

1. Remove the 5 function bodies (lines 110–125, 790–920)
2. Add: `import { buildControlResponse, handleResultMessage, handleAssistantMessage, isTaskNotification, handleUserMessage } from './claude-message-helpers.js';`
3. Add re-exports: `export { buildControlResponse, handleResultMessage, handleAssistantMessage, isTaskNotification, handleUserMessage } from './claude-message-helpers.js';`

This preserves all existing imports from `'./claude.js'` — no call sites change.

### Modified: `test/agent/claude-helpers.test.ts`

No changes needed. The test imports from `'../../agent/src/claude.js'` which still re-exports everything.

### Types

`SendFn` is currently a private type alias inside `claude.ts`:
```typescript
type SendFn = (msg: Record<string, unknown>) => void;
```

It needs to become `export type SendFn` so the new file can import it. This is the only type visibility change.

## Risk Assessment

- **Zero runtime behavior change** — functions are identical, just in a different file
- **Zero API change** — re-exports preserve all existing imports
- **Existing tests cover 100%** of the extracted functions (371-line test file)
- **Net reduction**: `claude.ts` shrinks by ~131 lines (1,228 → ~1,097)

## Verification

```bash
npm run build    # TypeScript compilation
npm test         # Existing claude-helpers.test.ts passes unchanged
```
