# Fork Conversation — Design v2 (Simplified)

## Overview

Fork a new conversation from any assistant message. The forked conversation receives the full cleaned-up chat history (up to the clicked message) as context, optionally with a user instruction, and auto-sends to Claude immediately.

**Use case:** After Claude outputs a plan with N tasks, fork a conversation per task — keeping the parent clean and each task isolated.

## Changes from v1

- **Removed AI-generated summary mode** — only full history (via existing `readConversationContext()`)
- **No fork dialog** — fork button on assistant message hover opens a lightweight inline popover, not a modal
- **Auto-send** — clicking "Fork" immediately creates and sends the new conversation
- **Optional instruction** — user can type an instruction; if empty, history alone is sent
- **Fork point = clicked message** — the clicked assistant message becomes the last message in the context

## User Experience

### 1. Fork Button (Message Hover)

On hover over any **assistant message**, a Fork icon (branch icon) appears in the `.message-actions` bar, alongside the existing Copy button:

```
┌──────────────────────────────────────────────────┐
│                            [Fork] [Copy]         │
│  Here are the 5 tasks we need to do:             │
│  1. Refactor auth module                         │
│  2. Add unit tests for stream.ts                 │
│  ...                                             │
└──────────────────────────────────────────────────┘
```

### 2. Fork Popover

Clicking Fork opens a small popover anchored below the button:

```
┌─────────────────────────────────────┐
│  Fork Conversation                  │
│                                     │
│  ┌─────────────────────────────┐    │
│  │ Instruction (optional)      │    │
│  │ e.g. Execute task 3...      │    │
│  └─────────────────────────────┘    │
│                                     │
│  Context: 12 messages up to here    │
│                                     │
│             [Cancel]  [Fork →]      │
└─────────────────────────────────────┘
```

- **Instruction textarea**: Optional. Placeholder text guides the user.
- **Context indicator**: Shows message count to give a sense of how much context will be included.
- **Fork button**: Clicking it triggers the fork immediately.
- **Cancel**: Closes the popover.
- **Esc / click outside**: Also closes.

### 3. Fork Execution (Auto-send)

1. Frontend sends `fork_conversation` to agent with `claudeSessionId` + `forkMessageIndex`
2. Agent reads JSONL, extracts cleaned history up to fork point, returns `fork_context_response`
3. Frontend creates new `conversationId`, calls `switchConversation(newConvId)`
4. Frontend inserts a **collapsible context block** (role `fork-context`) showing "Forked from previous conversation" — collapsed by default, expandable to view the full injected history
5. Frontend composes the first message and sends it as a `chat` message
6. Claude begins responding immediately

### 4. Collapsible Fork Context in Chat

The forked conversation's first visible element is a collapsible context bar (reusing the existing `context-summary-wrapper` pattern used by meeting/briefing/devops context injection):

```
┌─ 🔀 Forked from previous conversation          [Show] ─┐
└─────────────────────────────────────────────────────────┘
```

Clicking "Show" expands to reveal the full conversation history that was injected:

```
┌─ 🔀 Forked from previous conversation          [Hide] ─┐
│                                                         │
│  [User]                                                 │
│  How should we refactor the auth module?                │
│                                                         │
│  [Assistant]                                            │
│  Here's my analysis of the auth module...               │
│  ...                                                    │
└─────────────────────────────────────────────────────────┘
```

This keeps the initial view clean while allowing the user to inspect the injected context at any time. Uses Vue message role `fork-context` with the same `toggleContextSummary()` mechanism.

### 5. New Conversation Appears

The forked conversation appears in the sidebar session list. The user can switch back to the parent at any time.

## First Message Format

**With instruction:**
```
Continue working based on the following conversation history.

<conversation-history>
[User]
How should we refactor the auth module?

[Assistant]
Here's my analysis...
</conversation-history>

User's instruction: Execute task 3 — refactor the auth middleware to use JWT tokens.
```

**Without instruction:**
```
Continue working based on the following conversation history. Review the context and let the user know you're ready to continue.

<conversation-history>
[User]
How should we refactor the auth module?

[Assistant]
Here's my analysis...
</conversation-history>
```

## Data Flow

```
User hovers assistant message → clicks Fork
  → popover opens (optional instruction input)
  → user clicks "Fork →"
  │
  ├─ Frontend sends:
  │    { type: 'fork_conversation',
  │      claudeSessionId: 'abc123',
  │      forkMessageIndex: 5 }
  │
  ├─ Agent receives fork_conversation
  │    → calls readConversationContext(workDir, sessionId, upToIndex)
  │    → returns cleaned user/assistant text up to fork point
  │
  └─ Agent sends:
       { type: 'fork_context_response',
         status: 'done' | 'error',
         context: '...',
         messageCount: 12,
         error?: '...' }

  Frontend receives fork_context_response:
    → switchConversation(newConvId)
    → inserts collapsible fork-context message (role: 'fork-context', collapsed by default)
    → wsSend({ type: 'chat', conversationId: newConvId, prompt: composedMessage })
```

## WebSocket Protocol

### New Message Types

| Direction | Type | Fields | Description |
|-----------|------|--------|-------------|
| Web → Agent | `fork_conversation` | `claudeSessionId`, `forkMessageIndex` | Request cleaned history up to fork point |
| Agent → Web | `fork_context_response` | `status`, `context?`, `messageCount?`, `error?` | Cleaned history text |

Only 2 new message types (down from 4 in v1).

## Fork Point Mapping

The frontend's `messages` array doesn't directly match JSONL line numbers. We use an **entry count** approach:

- `readConversationContext()` already walks JSONL entries sequentially and counts user + assistant text entries
- Frontend counts the message index among assistant messages in `store.messages` (skipping tool, system, and non-text messages)
- The `forkMessageIndex` is this count — "include the first N assistant text entries"
- This is approximate but good enough: both sides count the same logical entries (user text + assistant text, skipping tool calls)

**Implementation:** Extend `readConversationContext(workDir, sessionId, upToAssistantIndex?)`:
- New optional 3rd param: stop after emitting the Nth assistant entry (0-indexed)
- If omitted, behaves as today (return all)

## Implementation

### Agent Side

**`agent/src/history.ts`** — Extend `readConversationContext()`:
```typescript
export function readConversationContext(
  workDir: string,
  sessionId: string,
  upToAssistantIndex?: number   // NEW: stop after this assistant entry (inclusive)
): string | null
```
- Add an assistant entry counter
- When `upToAssistantIndex` is defined, stop processing after the Nth assistant entry
- Everything else stays the same (summary tracking, tool stripping, truncation)

**`agent/src/connection.ts`** — Handle new message type:
```typescript
case 'fork_conversation': {
  const { claudeSessionId, forkMessageIndex } = msg;
  const context = readConversationContext(state.workDir, claudeSessionId, forkMessageIndex);
  send({
    type: 'fork_context_response',
    status: context ? 'done' : 'error',
    context,
    messageCount: /* count from context */,
    error: context ? undefined : 'Could not read conversation history',
  });
  break;
}
```

### Web Frontend

**`server/web/src/components/MessageList.vue`** — Add fork button + fork-context block:
- New Fork icon button in `.message-actions` div (before Copy button)
- `@click="openForkPopover(msg, msgIdx, $event)"` — passes message and click event for positioning
- New `fork-context` role block using `context-summary-wrapper` pattern (collapsed by default, expandable)

**`server/web/src/components/ForkPopover.vue`** — New component:
- Lightweight popover (not a full modal)
- Positioned relative to fork button click
- Textarea for optional instruction
- "Context: N messages up to here" indicator
- Cancel + Fork buttons
- Closes on Esc, click outside

**`server/web/src/modules/fork.js`** — New module:
```javascript
export function createFork(deps) {
  const { wsSend, switchConversation, messages, streaming, t } = deps;

  const forkPopoverOpen = ref(false);
  const forkPopoverPos = ref({ x: 0, y: 0 });
  const forkTargetMsg = ref(null);
  const forkInstruction = ref('');
  const forkPending = ref(false);  // waiting for agent response

  function openForkPopover(msg, msgIdx, event) { ... }
  function closeForkPopover() { ... }
  function executeFork() {
    // 1. Send fork_conversation to agent
    // 2. Wait for fork_context_response
    // 3. switchConversation(newConvId)
    // 4. Insert system message
    // 5. Send chat with composed prompt
  }
  function handleForkResponse(msg) { ... }

  return { forkPopoverOpen, forkPopoverPos, forkTargetMsg,
           forkInstruction, forkPending,
           openForkPopover, closeForkPopover, executeFork,
           handleForkResponse };
}
```

**`server/web/src/store.js`** — Wire fork module:
- Import and instantiate `createFork(deps)`
- Expose fork methods + state

**`server/web/src/modules/connection.js`** — Handle response:
- Add `fork_context_response` to handler dispatch

**`server/web/src/css/fork.css`** — New styles for popover

**`server/web/public/locales/en.json`** + `zh.json` — i18n keys:
- `fork.forkConversation`, `fork.instruction`, `fork.instructionPlaceholder`, `fork.contextInfo`, `fork.cancel`, `fork.fork`, `fork.forking`, `fork.forked`, `fork.error`

## File Changes Summary

| File | Change |
|------|--------|
| `agent/src/history.ts` | Add `upToAssistantIndex` param to `readConversationContext()` |
| `agent/src/connection.ts` | Handle `fork_conversation` message type |
| `server/web/src/components/MessageList.vue` | Add Fork button in `.message-actions` |
| `server/web/src/components/ForkPopover.vue` | **New**: fork popover component |
| `server/web/src/modules/fork.js` | **New**: fork module (state + logic) |
| `server/web/src/store.js` | Wire fork module |
| `server/web/src/modules/connection.js` | Handle `fork_context_response` |
| `server/web/src/css/fork.css` | **New**: popover styles |
| `server/web/public/locales/en.json` | Fork i18n keys |
| `server/web/public/locales/zh.json` | Fork i18n keys (Chinese) |

## Open Questions (Resolved)

| Question | Decision |
|----------|----------|
| Context mode? | Full history only (no AI summary) |
| Entry point? | Message hover button on assistant messages |
| Fork point? | Clicked message = last message in fork |
| Instruction? | Optional — always inject context, instruction is extra |
| Auto-send? | Yes, fork auto-sends immediately |
| Dialog vs popover? | Lightweight popover, not a modal |
| Fork metadata? | Not for MVP — no lineage tracking |
