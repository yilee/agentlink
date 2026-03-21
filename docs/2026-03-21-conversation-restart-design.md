# Conversation Restart Redesign

## Overview

Refactor the plan mode toggle implementation to eliminate prompt injection ("Enter plan mode now."), and introduce a shared `restartConversation()` primitive that can be reused by future features like reload.

## Motivation

### Problem: Current Plan Mode Is Non-Deterministic

The current plan mode toggle has two paths:

1. **Injected path** (process idle): Enqueues `"Enter plan mode now."` / `"Exit plan mode now."` as a user message into Claude's stdin, hoping Claude will call the `EnterPlanMode` / `ExitPlanMode` tool. This is **unreliable** — Claude may misunderstand, give random replies, or not call the tool at all.

2. **Immediate path** (process busy or dead): Kills the process and recreates state with the correct `--permission-mode`. This is **deterministic and reliable**.

Additionally, the immediate path for exiting plan mode spawns Claude with `"Exit plan mode now."` to record the exit in JSONL — another source of random output.

### Insight from Claude Code CLI

Claude Code CLI implements plan mode via:
1. **System prompt injection** — appends plan mode instructions telling Claude to only use read-only tools
2. **Tool filtering** — reportedly removes write tools from the API `tools` array (hard enforcement)
3. **Client state machine** — tracks `NORMAL ↔ PLAN_MODE` to control the above

However, **our experiments show that `--permission-mode plan` does NOT remove write tools from the tools list** — they remain available but Claude is instructed via system prompt not to use them (soft enforcement). This is sufficient in practice as Claude reliably obeys the restriction.

AgentLink interacts with Claude via the `claude` CLI subprocess, which accepts `--permission-mode plan` as a process-level argument. This flag triggers system prompt changes internally. We don't need to inject prompts — just restart the process with the right flag.

### Experimental Verification

We ran live experiments with `claude` CLI v2.1.74 to validate the approach:

**Experiment 1: `--permission-mode plan` enforces read-only**

```bash
echo '{"type":"user","message":{"role":"user","content":"Write hello to test.txt"}}' \
  | claude --output-format stream-json --input-format stream-json --permission-mode plan
```

Results:
- Claude responded: *"I'm currently in plan mode, so I can only read files and write to the plan file — I cannot create or edit any other files."* — **refused to write** ✅
- The `init` message included `"permissionMode": "plan"` ✅
- **Important finding: the `tools` array still includes `Edit`, `Write`, `NotebookEdit`** — `--permission-mode plan` is **soft enforcement via system prompt**, not hard enforcement via tool filtering. Claude is instructed not to use write tools but they remain technically available.
- Despite being soft enforcement, Claude strictly obeyed the restriction in testing.

**Experiment 2: Resume same session with different `--permission-mode`**

```bash
echo '{"type":"user","message":{"role":"user","content":"Write hello to test.txt"}}' \
  | claude --output-format stream-json --input-format stream-json \
    --permission-mode bypassPermissions --resume <session-id-from-exp-1>
```

Results:
- The `init` message showed `"permissionMode": "bypassPermissions"` — **mode successfully switched** ✅
- Claude immediately called the `Write` tool and created `test.txt` — **write operations restored** ✅
- Same `session_id` preserved, conversation history intact ✅

**Key takeaways:**
1. `--permission-mode` is respected per-process — no need to record mode in JSONL history
2. Killing and resuming with a different `--permission-mode` works seamlessly
3. Plan mode is soft enforcement (system prompt), not hard enforcement (tool removal), but Claude reliably obeys it

### Solution: Always Kill + Recreate

Eliminate the injected path entirely. **All mode switches go through kill → recreate state → resume on next chat.** This:
- Removes all randomness
- Reuses the proven cleanup → resume pattern (same as `cancel_execution`, `change_workdir`)
- Is simpler to reason about

## Design: Shared `restartConversation()` Primitive

### Observation: Multiple Features Share the Same Pattern

| Operation | Kill process | Resume same session | Change planMode | Re-send history to UI |
|-----------|:---:|:---:|:---:|:---:|
| Plan mode toggle | ✅ | ✅ | ✅ | ❌ |
| Reload conversation | ✅ | ✅ | ❌ | ✅ |
| Resume different session | ✅ | ✅ (different ID) | ❌ | ✅ |

All three operations follow the same core: **kill the current Claude process, preserve session ID, recreate conversation state, optionally change parameters.**

### New Function: `restartConversation()`

Location: `agent/src/claude.ts`

```typescript
export interface RestartOptions {
  /** New plan mode. If undefined, preserves current value. */
  planMode?: boolean;
  /** If true, reads JSONL history and includes it in the returned result. */
  reloadHistory?: boolean;
}

export interface RestartResult {
  /** The claudeSessionId that can be used to resume. */
  claudeSessionId: string | null;
  /** Whether an active turn was interrupted. */
  wasTurnActive: boolean;
  /** Reloaded history messages (only if reloadHistory was true). */
  history?: HistoryMessage[];
}

export function restartConversation(
  conversationId: string | undefined,
  options: RestartOptions = {},
): RestartResult {
  const convId = conversationId || DEFAULT_CONVERSATION_ID;
  const existing = conversations.get(convId);

  if (!existing) {
    return { claudeSessionId: null, wasTurnActive: false };
  }

  const wasTurnActive = existing.turnActive;
  const sessionId = existing.claudeSessionId || existing.lastClaudeSessionId;
  const workDir = existing.workDir;
  const newPlanMode = options.planMode ?? existing.planMode;

  // Kill current process, cleanup resources
  cleanupConversation(convId);

  // Recreate state with updated parameters
  const newState: ConversationState = {
    child: null,
    inputStream: null,
    abortController: null,
    claudeSessionId: null,
    workDir,
    turnActive: false,
    turnResultReceived: false,
    conversationId: convId,
    lastClaudeSessionId: sessionId,
    isCompacting: false,
    createdAt: Date.now(),
    planMode: newPlanMode,
    brainMode: existing.brainMode,
  };
  conversations.set(convId, newState);

  // Optionally reload history from JSONL
  let history: HistoryMessage[] | undefined;
  if (options.reloadHistory && sessionId) {
    history = readSessionMessages(workDir, sessionId);
  }

  return { claudeSessionId: sessionId, wasTurnActive, history };
}
```

### Refactor `setPermissionMode()` → Use `restartConversation()`

The existing `setPermissionMode()` function is **replaced** by calling `restartConversation()` with `planMode` option:

```typescript
// Before (complex, two paths):
export function setPermissionMode(conversationId, mode, claudeSessionId) { ... }

// After (deleted entirely — callers use restartConversation directly)
```

### Handling "No Existing Conversation" (Pre-First-Message Toggle)

If the user toggles plan mode before sending any message, there's no conversation to restart. The current code creates a "placeholder" state. We keep this behavior but move it to the caller (`connection.ts`):

```typescript
case 'set_plan_mode': {
  const { enabled, conversationId } = msg;
  const conv = getConversation(conversationId);

  if (conv) {
    // Restart with new mode
    const result = restartConversation(conversationId, { planMode: enabled });
    if (result.wasTurnActive) {
      send({ type: 'execution_cancelled', conversationId });
    }
  } else {
    // No conversation yet — create placeholder
    createPlaceholderConversation(conversationId, { planMode: enabled });
  }

  send({ type: 'plan_mode_changed', enabled, conversationId });
  break;
}
```

## Changes by Layer

### Agent (`agent/src/claude.ts`)

1. **Add `restartConversation()` function** — shared primitive as described above.
2. **Delete `setPermissionMode()` function** (lines 552-629) — replaced by `restartConversation()`.
3. **Delete EnterPlanMode/ExitPlanMode detection in output handler** (lines 943-962) — no longer needed since we don't inject plan mode prompts and don't need Claude to "natively call" these tools.
4. **Keep `planMode` field in `ConversationState`** — still needed to determine `--permission-mode` in `startQuery()`.
5. **Keep `startQuery()` logic** (line 722) that reads `state.planMode` to set `--permission-mode plan` or `bypassPermissions` — unchanged.

### Agent (`agent/src/connection.ts`)

1. **Simplify `set_plan_mode` handler** (lines 492-521):
   - Remove injected/immediate path distinction
   - Remove "Exit plan mode now." recording logic (lines 516-518)
   - Call `restartConversation(convId, { planMode: enabled })` directly
   - Send `plan_mode_changed` response

2. **Simplify `resume_conversation` handler** (lines 342-355):
   - Remove plan mode history scanning (checking last `EnterPlanMode`/`ExitPlanMode` tool_use in JSONL)
   - Plan mode always resets to `false` on resume (safe default, matches page refresh behavior)

### Web UI (`server/web/src/`)

Minimal changes — the protocol stays the same:

1. **`store.js`**: Keep `pendingPlanMode` for loading state. Remove `immediate` flag handling — all responses now behave like the old "immediate" path.

2. **`handlers/feature-handler.js`**: Simplify `plan_mode_changed` handler — remove `immediate` branch, always clear `isProcessing` and update state.

3. **`components/ChatInput.vue`**: No change. Toggle already disabled when `isProcessing === true`.

4. **`components/ToolBlock.vue`**: Keep EnterPlanMode/ExitPlanMode divider rendering for backward compatibility with existing history that has these tool_use blocks.

### Protocol

**No protocol changes.** Same messages, same fields:

- Web → Agent: `set_plan_mode { enabled, conversationId }`
- Agent → Web: `plan_mode_changed { enabled, conversationId }`

The `immediate` field in `plan_mode_changed` becomes unnecessary (all are "immediate" now) but can be kept for backward compat or simply removed.

## Future: Reload Feature

Reload uses the same `restartConversation()` primitive:

```typescript
// In connection.ts (future)
case 'reload_conversation': {
  const { conversationId } = msg;
  const result = restartConversation(conversationId, { reloadHistory: true });

  if (result.wasTurnActive) {
    send({ type: 'execution_cancelled', conversationId });
  }

  send({
    type: 'conversation_resumed',
    conversationId,
    claudeSessionId: result.claudeSessionId,
    history: result.history || [],
  });
  break;
}
```

UI work (reload button, wiring) is out of scope for this PR.

## JSONL History Considerations

### Why We No Longer Need EnterPlanMode/ExitPlanMode in JSONL

Previously, injecting `"Enter plan mode now."` was justified by wanting Claude to record `EnterPlanMode` tool_use in JSONL, so that on resume Claude would "remember" it's in plan mode.

This is unnecessary because:
- `--permission-mode plan` is enforced at the CLI level via system prompt — Claude self-enforces read-only behavior regardless of what's in its history
- AgentLink tracks `planMode` in its own `ConversationState`, and sets `--permission-mode` accordingly on every process spawn
- On resume from history, plan mode resets to `false` (safe default) — user can toggle it back

### Backward Compatibility

Existing sessions that have `EnterPlanMode`/`ExitPlanMode` tool_use blocks in JSONL will still work fine — Claude sees them as past tool calls in its history, which is harmless.

## Edge Cases

1. **Toggle during processing**: Button disabled. User must wait or press Stop first.
2. **No active conversation**: Placeholder state created with the desired `planMode`.
3. **Page refresh**: `planMode` resets to `false`. Safe default.
4. **Multi-conversation**: Each conversation has independent `planMode` in `ConversationState`.
5. **Process already dead**: `restartConversation()` handles this — `cleanupConversation()` is a no-op on dead processes, state is recreated normally.

## Implementation Checklist

- [ ] Add `restartConversation()` to `agent/src/claude.ts`
- [ ] Delete `setPermissionMode()` from `agent/src/claude.ts`
- [ ] Delete EnterPlanMode/ExitPlanMode detection in output handler (`claude.ts` lines 943-962)
- [ ] Simplify `set_plan_mode` handler in `agent/src/connection.ts`
- [ ] Remove plan mode JSONL scanning in `resume_conversation` handler
- [ ] Simplify `plan_mode_changed` handler in web `feature-handler.js`
- [ ] Simplify `pendingPlanMode` logic in web `store.js`
- [ ] Update tests (`claude-plan-mode.test.ts`, `planMode.test.ts`, `plan-mode.test.ts`)
- [ ] (Future) Add `reload_conversation` handler using `restartConversation({ reloadHistory: true })`
- [ ] (Future) Add reload button to web UI
