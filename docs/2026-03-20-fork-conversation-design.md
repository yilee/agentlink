# Fork Conversation — Design Document

## Overview

Add a "Fork Conversation" feature that lets users branch off a new conversation from any point in an existing chat. The new conversation receives context from the parent (either full message history or an AI-generated summary) plus a user-provided initial instruction.

**Primary use case:** After Claude outputs a summary with N TODO tasks, the user can fork a new conversation for each task — keeping the parent session lean and each task in its own isolated context.

## User Experience

### 1. Fork Entry Point

On hover over any **assistant message**, a Fork button appears alongside the existing Copy button:

```
┌──────────────────────────────────────────────────┐
│                              [Fork] [Copy]       │
│  Here are the 5 tasks we need to do:             │
│  1. Refactor auth module                         │
│  2. Add unit tests for stream.ts                 │
│  ...                                             │
└──────────────────────────────────────────────────┘
```

The Fork button is only shown on assistant messages (not user, tool, or system messages).

### 2. Fork Dialog

Clicking Fork opens a modal dialog with:

```
┌─────────────── Fork Conversation ────────────────┐
│                                                  │
│  Context mode:                                   │
│  ○ Full conversation history                     │
│  ○ AI-generated summary                          │
│                                                  │
│  ┌──────────────────────────────────────────┐     │
│  │ [Summary text area]                      │     │
│  │ (loading spinner while generating...)    │     │
│  │ (editable once generated)                │     │
│  └──────────────────────────────────────────┘     │
│                                                  │
│  Initial instruction:                            │
│  ┌──────────────────────────────────────────┐     │
│  │ Please execute Task 3: refactor auth...  │     │
│  └──────────────────────────────────────────┘     │
│                                                  │
│                        [Cancel]  [Create Fork]    │
└──────────────────────────────────────────────────┘
```

**Behavior by context mode:**

- **Full conversation history (default):** No summary text area shown. The new conversation's first message will include all messages from the latest compact point to the fork point, extracted from the JSONL session file.
- **AI-generated summary:** Summary text area appears with a loading spinner. Agent spawns a temporary Claude process to generate a summary of the conversation up to the fork point. Once ready, text is editable. User can refine before confirming.

**Initial instruction** is always required — it tells the forked conversation what to do.

### 3. Summary Generation Loading State

When the user selects "AI-generated summary":

1. Text area shows a skeleton/spinner with "Generating summary..." text
2. A `fork_summary_request` WebSocket message is sent to the agent
3. Agent spawns a temporary Claude process, feeds it the conversation history, asks for a summary
4. Agent returns `fork_summary_response` with the summary text
5. Text area populates with the summary, becomes editable
6. If generation fails, show an error message with a "Retry" button
7. User can switch back to "Full conversation history" at any time to skip waiting

The user can fill in the "Initial instruction" field while waiting for the summary.

### 4. Fork Execution

When the user clicks "Create Fork":

1. Frontend creates a new `conversationId` (UUID)
2. Frontend calls `switchConversation(newConvId)` (new blank conversation)
3. Frontend sends a `chat` message with a composed first prompt:
   - **Full history mode:** The context payload includes the raw messages (extracted by the agent from JSONL)
   - **Summary mode:** The context is the user-edited summary text
4. The new conversation appears in the sidebar

**First message format (summary mode):**
```
Based on the following conversation context, please execute the user's instruction.

<conversation-context>
{summary text}
</conversation-context>

<user-instruction>
{user's initial instruction}
</user-instruction>
```

**First message format (full history mode):**
```
Based on the following conversation history, please execute the user's instruction.

<conversation-history>
{formatted message history from JSONL}
</conversation-history>

<user-instruction>
{user's initial instruction}
</user-instruction>
```

## Data Flow

### Fork Summary Generation

```
User clicks Fork → selects "AI-generated summary"
  │
  ├─ Frontend sends:
  │    { type: 'fork_summary_request',
  │      conversationId: 'current-conv-id',
  │      forkPointMessageIndex: 12 }         ← see Open Questions #1
  │
  ├─ Agent receives fork_summary_request
  │    → reads JSONL for current session
  │    → extracts messages from last compact point to fork point
  │    → spawns temp Claude process with prompt:
  │        "Summarize the following conversation concisely..."
  │    → collects output
  │    → sends response
  │
  └─ Agent sends:
       { type: 'fork_summary_response',
         conversationId: 'current-conv-id',
         status: 'done' | 'error',
         summary: '...',
         error?: '...' }
```

### Fork with Full History

```
User clicks Fork → selects "Full conversation history" → clicks "Create Fork"
  │
  ├─ Frontend sends:
  │    { type: 'fork_history_request',
  │      conversationId: 'current-conv-id',
  │      forkPointMessageIndex: 12 }
  │
  ├─ Agent receives fork_history_request
  │    → reads JSONL for current session
  │    → extracts messages from last compact point to fork point
  │    → formats as text
  │    → sends response
  │
  └─ Agent sends:
       { type: 'fork_history_response',
         conversationId: 'current-conv-id',
         status: 'done' | 'error',
         history: '...',                    ← formatted conversation text
         error?: '...' }
```

After receiving the history/summary, frontend composes the first message and sends it as a normal `chat` message in the new conversation.

### New Chat with Forked Context

```
Frontend:
  → switchConversation(newConvId)
  → wsSend({ type: 'chat',
             conversationId: newConvId,
             prompt: composedFirstMessage })
```

## WebSocket Message Protocol

### New Message Types

| Direction | Type | Fields | Description |
|-----------|------|--------|-------------|
| Web → Agent | `fork_summary_request` | `conversationId`, `forkPointMessageIndex` | Request AI-generated summary up to fork point |
| Agent → Web | `fork_summary_response` | `conversationId`, `status`, `summary?`, `error?` | Summary result |
| Web → Agent | `fork_history_request` | `conversationId`, `forkPointMessageIndex` | Request formatted history up to fork point |
| Agent → Web | `fork_history_response` | `conversationId`, `status`, `history?`, `error?` | Formatted history text |

## Implementation Details

### Agent Side (agent/src/)

**New file: `fork.ts`** (or add to `claude.ts`)

1. **`handleForkSummaryRequest(conversationId, forkPointIndex)`**
   - Get the `claudeSessionId` for the given conversation
   - Call `readConversationContext(workDir, claudeSessionId)` (already exists in `history.ts`, needs `upToIndex` extension) to extract messages from JSONL
   - Spawn a temporary Claude process (no `--resume`, one-shot):
     ```bash
     claude -p - --no-session-persistence --output-format stream-json --verbose
     # prompt piped via stdin to avoid ENAMETOOLONG (see BTW doc for details)
     ```
   - Send a single prompt: "Summarize the following conversation concisely, preserving key decisions, context, and current state:\n\n{formatted messages}"
   - Collect the `result` text output
   - Kill the temporary process
   - Send `fork_summary_response` back to web client
   - **IMPORTANT: Ephemeral process** — This temporary Claude process must NOT persist a session. It must not write a JSONL session file or appear in the user's chat history. Use a transient invocation that leaves no trace (e.g., `--no-session` flag if available, or ensure the session file is deleted after use).

2. **`handleForkHistoryRequest(conversationId, forkPointIndex)`**
   - Same JSONL extraction as above
   - Format messages as readable text (role labels + content)
   - Send `fork_history_response` back to web client

**Changes to `history.ts`:**

- ~~New function: `readRawSessionMessages(workDir, sessionId, upToIndex?)`~~ **Already implemented** as `readConversationContext(workDir, sessionId)` in `history.ts` (added by the [BTW Lightweight Context](2026-03-21-btw-lightweight-context.md) feature). This function:
  - Returns messages from the last `summary` entry (compact point) onward
  - **Only includes user and assistant text content** — strips all tool_use and tool_result blocks
  - Formats as readable `[Summary]/[User]/[Assistant]` dialogue text
  - Truncates from the beginning if exceeding 100,000 characters (`CONTEXT_MAX_CHARS`)
  - Returns `null` if no extractable content
  - **For fork**: needs an `upToIndex?` parameter to stop at the fork point (currently reads to the end). This is the only addition needed.

**Changes to `connection.ts`:**
- Add handler for `fork_summary_request` and `fork_history_request` message types
- Route to the new fork functions

### Web Frontend (server/web/src/)

**Changes to `ChatView.vue`:**
- Add Fork button next to Copy button on assistant messages
- Emit event or call store method when clicked

**New component: `ForkDialog.vue`**
- Modal dialog with context mode radio, summary textarea, instruction input
- Manages loading state for summary generation
- On confirm: triggers fork execution in store

**Changes to `store.js`:**
- Add `forkConversation(contextMode, context, instruction)` method
- Composes first message, creates new conversation, sends chat

**Changes to `connection.js`:**
- Add `fork_summary_response` and `fork_history_response` handlers
- Route responses to the ForkDialog component (via store ref or event)

**New CSS: `fork-dialog.css`** (or extend `confirm-dialog.css`)

### Message Formatting

**Both modes (full history and summary) only include user and assistant text content.** All tool use blocks (`tool_use`, `tool_result`) are stripped entirely. This keeps the context clean and focused on the conversation itself.

**For full history mode**, convert JSONL messages to readable text:

```
[User]
How should we refactor the auth module?

[Assistant]
Here's my analysis of the auth module...

[User]
Let's go with approach B.

[Assistant]
Great, here are the 5 tasks:
1. ...
```

**For summary mode**, the same filtered text (user + assistant only) is fed to the temporary Claude process for summarization.

## File Changes

| File | Change |
|------|--------|
| `agent/src/fork.ts` | New: fork summary generation, history extraction |
| `agent/src/history.ts` | Extend existing `readConversationContext()` with optional `upToIndex` parameter (base function already implemented by BTW feature) |
| `agent/src/connection.ts` | Handle `fork_summary_request`, `fork_history_request` |
| `server/web/src/components/ChatView.vue` | Add Fork button on assistant message hover |
| `server/web/src/components/ForkDialog.vue` | New: fork modal dialog component |
| `server/web/src/store.js` | `forkConversation()` method, fork state refs |
| `server/web/src/modules/connection.js` | Handle `fork_summary_response`, `fork_history_response` |
| `server/web/src/css/fork-dialog.css` | New: fork dialog styles |

## Open Questions

### 1. Fork Point Message Index Mapping

The frontend's `store.messages` array index does not directly correspond to JSONL line numbers. Reasons:
- UI filters out some system messages
- Tool use blocks are split into separate UI entries
- Compact summaries appear differently in UI vs JSONL

**Options:**
- **A)** Use a stable identifier (e.g., timestamp or message hash) that both frontend and JSONL share, so the agent can find the matching JSONL position
- **B)** Frontend sends the `claudeSessionId` + a message index relative to what the UI shows, and the agent applies a best-effort mapping
- **C)** Frontend sends the fork point assistant message's text content (or a prefix), and the agent searches the JSONL for a match
- **D)** Agent ignores fine-grained fork point — always returns everything from last compact to the latest message. Frontend truncates on its side if needed

**Decision needed:** Which approach best balances accuracy vs implementation complexity?

### 2. Temporary Claude Process for Summary Generation

- Should the summary prompt be hardcoded or configurable?
- What if the conversation history is very large (close to context limit)? Should we truncate or chunk?
- Should we use `--max-turns 1` or similar flags to ensure the temp process exits after one response?

### 3. Fork UI Placement and Design

- Exact icon/button design for the Fork action (what icon to use?)
- Should Fork be visible on every assistant message, or only on the last one?
- Mobile/responsive behavior of the Fork dialog

### 4. Concurrent Fork Requests

- What happens if the user requests a summary, then cancels and requests another? Should the agent abort the first temp Claude process?
- Should we support a cancel mechanism for summary generation?

### 5. Brain Mode / Plan Mode Inheritance

- Should the forked conversation inherit the parent's Brain Mode setting?
- Plan Mode state: should it reset in the fork?

### 6. Fork Metadata / Lineage

- Should we store which conversation was forked from which? (e.g., for UI display like "Forked from Conversation X")
- Not needed for MVP but might be useful later
