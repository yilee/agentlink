# BTW Lightweight Context — Design Document

## Problem

The current `/btw` implementation uses `--resume sessionId` to give Claude the conversation context. This has two major issues:

1. **Context too heavy**: `--resume` loads the full JSONL session history, including all `tool_use`, `tool_result`, system messages, etc. A simple side question ends up loading hundreds of KB (or MB) of irrelevant tool call details, making it slow and token-expensive.
2. **Semantic coupling**: Although `--no-session-persistence` prevents writing back, `--resume` still ties BTW to the Claude CLI session mechanism. If the session file is being written to by the main process, there could be read contention.

### Desired Behavior

BTW context should be **lightweight**: only the conversation text (user + assistant) from the last compact point onward, with all tool_use/tool_result stripped. This matches the "Full conversation history" option from the [fork-conversation design](fork-conversation-design.md) — human-readable dialogue only.

## Solution

Replace `--resume sessionId` with a self-built context prompt. The agent reads the JSONL, extracts a stripped-down conversation, and passes it inline via `-p`.

### Before (current)

```
claude -p "user's question" --resume SESSION_ID --no-session-persistence --output-format stream-json --verbose
```

### After (proposed)

```
claude -p "<composed prompt with inline context>" --no-session-persistence --output-format stream-json --verbose
```

## Implementation

### 1. New function in `history.ts`: `readConversationContext()`

Extract user/assistant text from the JSONL, starting from the last `summary` entry (compact point).

```typescript
export function readConversationContext(workDir: string, sessionId: string): string | null
```

**Logic:**

1. Read the JSONL file for `sessionId`
2. Find the last `summary` entry — this is the compact point. If none exists, start from the beginning.
3. From the compact point onward, extract:
   - `summary` entry text (the compact summary itself, if present)
   - `user` messages → text content only (strip system tags via existing `stripSystemTags()`)
   - `assistant` messages → text blocks only (skip `tool_use` blocks entirely)
4. Skip: `tool_result` messages, `system` messages, hidden commands (via existing `isHiddenCommand()`)
5. Format as readable dialogue:

```
[Summary]
{compact summary text, if present}

[User]
How should we refactor the auth module?

[Assistant]
Here's my analysis...

[User]
Let's go with approach B.

[Assistant]
Great, here are the 5 tasks:
1. ...
```

6. If the formatted text exceeds a size limit (e.g. 100,000 characters), truncate from the beginning (keep the most recent messages).
7. Return `null` if the JSONL file doesn't exist or has no extractable content.

**Shared with fork-conversation:** This function serves the same purpose as `readRawSessionMessages()` described in the fork-conversation design doc. When fork is implemented later, it reuses this function directly.

### 2. Modify `handleBtwQuestion()` in `claude.ts`

Replace `--resume sessionId` with inline context.

**Current flow:**
```
1. Find sessionId from conversations map
2. Spawn: claude -p question --resume sessionId --no-session-persistence ...
```

**New flow:**
```
1. Find sessionId from conversations map
2. Call readConversationContext(workDir, sessionId) to get stripped dialogue
3. Compose prompt with system instruction + context + question
4. Spawn: claude -p composedPrompt --no-session-persistence ...
```

**Composed prompt:**

```
This is a side question from the user — a quick, read-only query that should not affect the current task.

Rules:
- Answer concisely based on the conversation context and your knowledge
- Do NOT call any tools (no file reads, no bash commands, no edits)
- Do NOT produce any tool_use blocks
- Do NOT continue or modify the main task

<conversation-context>
{output of readConversationContext()}
</conversation-context>

Side question: {user's question}
```

**Fallback when no context is available:**

If `readConversationContext()` returns `null` (no session, empty session, or file not found), send the question without context:

```
Answer this question concisely. No tool calls, no file operations — text answer only.

Question: {user's question}
```

This is better than the current "No active conversation context available" hard failure — BTW can still answer general knowledge questions.

### 3. Remove `--resume` and `--verbose` from BTW spawn args

**Final spawn args:**

```typescript
const args = [
  '-p', composedPrompt,
  '--no-session-persistence',
  '--output-format', 'stream-json',
];
```

Changes:
- Removed `--resume sessionId` — context is now inline
- Removed `--verbose` — BTW doesn't need system/debug messages in output
- The `-p` value changes from the raw question to the composed prompt

### 4. Brain mode

When `conv?.brainMode` is true, the `brain` command is used instead of `claude`. The same composed prompt approach applies — change `-p question` to `-p composedPrompt`. No special handling needed since `brain` also accepts `-p`.

## What Does NOT Change

| Component | Status |
|-----------|--------|
| Web frontend (`BtwOverlay.vue`, `store.js`, `feature-handler.js`) | No changes |
| WebSocket protocol (`btw_question` / `btw_answer`) | No changes |
| Server relay | No changes |
| BTW error routing in `connection.js` | No changes |
| Dismissal, keyboard shortcuts, mobile behavior | No changes |
| Localization keys | No changes |

## Edge Cases

| Scenario | Handling |
|----------|----------|
| No session exists yet (first message not sent) | Fallback prompt without context |
| Session file is empty | Fallback prompt without context |
| Very long conversation after compact | Truncate from beginning, keep recent ~100K chars |
| Compact summary is very large | Include it; it replaces all prior context so it's essential |
| JSONL file is being written to by main process | `readFileSync` reads a snapshot; partial last line is handled by existing try/catch in JSON.parse |
| `readConversationContext()` throws | Catch in `handleBtwQuestion()`, use fallback prompt |

## Test Changes

### `test/agent/btw.test.ts`

Update existing tests:

| Current test | Change needed |
|---|---|
| Tests that verify `--resume` in spawn args | Remove; verify `-p` contains composed prompt instead |
| Tests that verify `sessionId` lookup priority | Keep priority logic, but verify it's used for `readConversationContext()` call instead of `--resume` arg |
| No-session fallback test | Update expected behavior: should send fallback prompt (not hard-fail with "No active conversation context") |

Add new tests:

| New test | Description |
|---|---|
| Context extraction | Verify `readConversationContext()` strips tool_use/tool_result, keeps user/assistant text |
| Compact point | Verify extraction starts from last `summary` entry |
| Truncation | Verify long conversations are truncated to limit |
| System prompt format | Verify composed prompt contains rules + context + question |
| Empty session | Verify fallback prompt is used |

### Functional tests (`test/functional/btw-*.test.ts`)

No changes needed — these test the WebSocket protocol and UI rendering, which are unchanged.

## File Changes Summary

| File | Change |
|------|--------|
| `agent/src/history.ts` | Add `readConversationContext()` |
| `agent/src/claude.ts` | Modify `handleBtwQuestion()`: replace `--resume` with inline context |
| `test/agent/btw.test.ts` | Update spawn arg tests, add context extraction tests |
