# `/btw` Side Question — Design Document

## 1. Overview

Add a `/btw` (side question) feature to the AgentLink web UI, allowing users to ask a quick question about their current work **without polluting the conversation history**. The answer appears in a dismissible floating overlay and is fully ephemeral.

This mirrors the `/btw` command in Claude Code CLI ([docs](https://code.claude.com/docs/en/interactive-mode#side-questions-with-%2Fbtw)).

### Goals

- Ask a quick question that has full visibility into the current conversation context
- Display the answer in a floating overlay, not in the message list
- Work while Claude is actively processing (non-blocking)
- Support streaming responses with markdown rendering
- Work on both desktop and mobile (iPhone)
- Gracefully handle older agents that don't support `btw_question`

### Non-goals

- Multi-turn follow-up within the overlay
- Tool access (file reads, bash commands, search) from the side question
- Persisting side question history

---

## 2. User Experience

### 2.1 Trigger

User types `/btw <question>` in the input box and presses Enter. The slash menu already shows `/btw` as an option when typing `/b`.

Unlike other slash commands (`/cost`, `/compact`, `/context`) which send immediately on selection, `/btw` is a **prefix command** — selecting it from the menu fills the input with `/btw ` (with trailing space) and places the cursor after it, letting the user type their question before sending.

### 2.2 Overlay — Desktop (≥ 768px)

```
┌─────────────────────────────────────────────────┐
│  Chat messages area                             │
│  ...                                            │
│                                                 │
│     ┌──────────────────────────────────────┐    │
│     │  Side Question                    ✕  │    │
│     │  ──────────────────────────────────  │    │
│     │  Q: what was the config file name?   │    │
│     │                                      │    │
│     │  The config file is located at       │    │
│     │  ~/.agentlink/config.json, defined   │    │
│     │  in agent/src/config.ts ...          │    │
│     │                                      │    │
│     │           Press Esc to dismiss       │    │
│     └──────────────────────────────────────┘    │
│                                                 │
├─────────────────────────────────────────────────┤
│  /btw what was the config file name?     [Send] │
└─────────────────────────────────────────────────┘
```

- Panel floats in the center of `.message-list`, horizontally centered
- Max width: `560px`, max height: `60vh`
- Scrollable if answer is long
- Semi-transparent backdrop behind the panel (does **not** block input area)

### 2.3 Overlay — Mobile (< 768px)

```
┌────────────────────────────┐
│  Chat messages              │
│  ┌────────────────────────┐ │
│  │ Side Question        ✕ │ │
│  │ ────────────────────── │ │
│  │ Q: config file name?   │ │
│  │                        │ │
│  │ ~/.agentlink/config..  │ │
│  │                        │ │
│  │    Tap to dismiss      │ │
│  └────────────────────────┘ │
│                             │
├─────────────────────────────┤
│ Input area                  │
└─────────────────────────────┘
```

- Full width with `12px` horizontal margin
- Max height: `50vh`
- Dismiss hint reads "Tap to dismiss" instead of "Press Esc to dismiss"

### 2.4 States

| State | Overlay content |
|-------|-----------------|
| **Loading** | Question text + animated dots (same typing indicator pattern) |
| **Streaming** | Question text + incrementally revealed answer (markdown rendered) |
| **Complete** | Question text + full answer + dismiss hint |
| **Error** | Question text + error message in red |

### 2.5 Dismissal

| Action | Result |
|--------|--------|
| Click ✕ button | Close overlay |
| Press `Escape` | Close overlay |
| Click backdrop (outside panel) | Close overlay |
| Tap overlay on mobile | Close overlay |

After dismissal, the overlay and its content are discarded entirely — nothing is added to the message list.

### 2.6 Concurrent Usage

- User can send `/btw` while Claude is processing the main conversation
- A new `/btw` replaces any currently open side question overlay
- The input area remains fully functional while the overlay is open

---

## 3. Protocol

### 3.1 New WebSocket Message Types

**Web → Agent:**

```typescript
{
  type: 'btw_question',
  question: string,         // the user's question (without the "/btw " prefix)
  conversationId?: string,  // current conversation ID (for context lookup)
}
```

**Agent → Web:**

```typescript
// Streaming delta
{
  type: 'btw_answer',
  delta: string,            // incremental text chunk
  done: false,
}

// Final message
{
  type: 'btw_answer',
  delta: string,            // last chunk (may be empty)
  done: true,
}
```

### 3.2 Agent-Side Implementation

When the agent receives `btw_question`:

1. Collect the current conversation's message history as context
2. Spawn a lightweight Claude query (`claude -p`) with:
   - The conversation history as context
   - The user's question appended
   - `--no-session-persistence` (ephemeral, not saved)
   - `--tools ""` (no tools available — read-only from context)
   - `--output-format stream-json` (for streaming)
3. Stream `btw_answer` messages back as output arrives
4. Send a final `btw_answer` with `done: true` when complete

The side question does **not** touch the main conversation's Claude process.

### 3.3 Backward Compatibility — Unsupported Agent

If the agent does not recognize `btw_question`, it returns:

```json
{
  "type": "error",
  "message": "Unsupported command: btw_question. Please upgrade your agent: agentlink-client upgrade"
}
```

This is the existing fallback in `agent/src/connection.ts:593-595`.

**Problem:** The current error handler in `connection.js:390-409` treats all `error` messages the same — it pushes a system error message into the message list, clears `isProcessing`, and dequeues the next message. For a `/btw` error this is wrong because:

1. The error appears permanently in the message list (btw should be ephemeral)
2. It clears `isProcessing`, which may interrupt a running main conversation
3. It dequeues queued messages prematurely

**Solution:** Track whether a btw question is pending. When an `error` message arrives while a btw question is pending, route the error to the btw overlay instead of the message list.

```
Web sends btw_question
  → sets btwPending = true

Agent responds with error (unsupported)
  → error handler checks btwPending
  → if true: show error in btw overlay, set btwPending = false, do NOT clear isProcessing
  → if false: existing behavior (system message in chat)
```

The detection logic: if `btwPending` is `true` and the error message contains `btw_question`, route it to the overlay. This avoids false positives from unrelated errors arriving at the same time.

---

## 4. Implementation

### 4.1 Files to Modify

| File | Changes |
|------|---------|
| `server/web/app.js` | Slash menu entry, btw state, overlay template, keydown handler |
| `server/web/style.css` | Overlay styles (desktop + mobile) |
| `server/web/modules/connection.js` | Handle `btw_answer`, route btw errors to overlay |
| `server/web/locales/en.json` | Add `slash.btw`, `btw.*` keys |
| `server/web/locales/zh.json` | Add `slash.btw`, `btw.*` keys |
| `agent/src/connection.ts` | Handle `btw_question` message type |
| `agent/src/claude.ts` | Add `handleBtwQuestion()` function |

### 4.2 Slash Command Registration

Add to `SLASH_COMMANDS` array in `app.js`:

```js
const SLASH_COMMANDS = [
  { command: '/btw', descKey: 'slash.btw', isPrefix: true },
  { command: '/cost', descKey: 'slash.cost' },
  { command: '/context', descKey: 'slash.context' },
  { command: '/compact', descKey: 'slash.compact' },
];
```

The `isPrefix` flag changes `selectSlashCommand()` behavior:

```js
function selectSlashCommand(cmd) {
  if (cmd.isPrefix) {
    inputText.value = cmd.command + ' ';
    nextTick(() => inputRef.value?.focus());
    // Don't send — let user type their question
  } else {
    inputText.value = cmd.command;
    sendMessage();
  }
}
```

### 4.3 Sending the Question

In `sendMessage()`, detect the `/btw` prefix and branch:

```js
function sendMessage() {
  const text = inputText.value.trim();

  if (text.startsWith('/btw ')) {
    const question = text.slice(5).trim();
    if (!question) return;

    btwState.value = { question, answer: '', done: false, error: null };
    btwPending.value = true;
    wsSend({ type: 'btw_question', question, conversationId: currentConversationId.value });
    inputText.value = '';
    return;
  }

  // ... existing send logic
}
```

Note: Sending `/btw` does **not** set `isProcessing`, does **not** create a user message in the message list, and does **not** interact with the message queue.

### 4.4 Reactive State

```js
// Side question overlay state
const btwState = ref(null);
// null = overlay hidden
// { question: string, answer: string, done: boolean, error: string|null }

const btwPending = ref(false);
// true between sending btw_question and receiving first btw_answer (or error)
```

### 4.5 Connection Handler — `btw_answer`

In `connection.js`, add handler for `btw_answer`:

```js
else if (msg.type === 'btw_answer') {
  btwPending.value = false;
  if (btwState.value) {
    btwState.value.answer += msg.delta;
    if (msg.done) {
      btwState.value.done = true;
    }
  }
}
```

### 4.6 Connection Handler — Error Routing

Modify the existing `error` handler in `connection.js`:

```js
else if (msg.type === 'error') {
  // Route btw-related errors to the overlay instead of the message list
  if (btwPending.value && msg.message && msg.message.includes('btw_question')) {
    btwPending.value = false;
    if (btwState.value) {
      btwState.value.error = msg.message;
      btwState.value.done = true;
    }
    return;  // Do NOT clear isProcessing or push to message list
  }

  // ... existing error handling unchanged
}
```

### 4.7 Template — Overlay

Insert inside `.chat-content`, after `.message-list` and before `.input-area`:

```html
<Transition name="fade">
  <div v-if="btwState" class="btw-overlay" @click.self="dismissBtw">
    <div class="btw-panel">
      <div class="btw-header">
        <span class="btw-title">{{ t('btw.title') }}</span>
        <button class="btw-close" @click="dismissBtw" :aria-label="t('btw.dismiss')">✕</button>
      </div>
      <div class="btw-body">
        <div class="btw-question">{{ btwState.question }}</div>
        <div v-if="btwState.error" class="btw-error">{{ btwState.error }}</div>
        <div v-else-if="btwState.answer" class="btw-answer" v-html="renderMarkdown(btwState.answer)"></div>
        <div v-else class="btw-loading">
          <span class="typing-dots"><span></span><span></span><span></span></span>
        </div>
      </div>
      <div v-if="btwState.done && !btwState.error" class="btw-hint">
        {{ isMobile ? t('btw.tapDismiss') : t('btw.escDismiss') }}
      </div>
    </div>
  </div>
</Transition>
```

### 4.8 Dismiss Function

```js
function dismissBtw() {
  btwState.value = null;
  btwPending.value = false;
}
```

Add `Escape` key handling in `handleKeydown`:

```js
// At the top of handleKeydown, before other handlers:
if (e.key === 'Escape' && btwState.value) {
  dismissBtw();
  e.preventDefault();
  return;
}
```

### 4.9 Style — Desktop

```css
.btw-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay-bg, rgba(0, 0, 0, 0.3));
  z-index: 500;                     /* Below modals (1000) but above messages */
}

.btw-panel {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  width: 90%;
  max-width: 560px;
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.btw-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.btw-title {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
}

.btw-close {
  background: none;
  border: none;
  font-size: 16px;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 4px 8px;
  border-radius: 4px;
}

.btw-close:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.btw-body {
  padding: 16px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.btw-question {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
  font-style: italic;
}

.btw-answer {
  font-size: 14px;
  color: var(--text-primary);
  line-height: 1.6;
}

/* Reuse existing markdown styles inside btw-answer */
.btw-answer pre,
.btw-answer code,
.btw-answer p { /* inherits from global markdown styles */ }

.btw-error {
  font-size: 13px;
  color: var(--danger, #e53e3e);
  background: var(--danger-bg, rgba(229, 62, 62, 0.08));
  padding: 10px 12px;
  border-radius: 6px;
}

.btw-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px 0;
}

.btw-hint {
  text-align: center;
  font-size: 12px;
  color: var(--text-tertiary);
  padding: 8px 16px 12px;
  flex-shrink: 0;
}
```

### 4.10 Style — Mobile (< 768px)

```css
@media (max-width: 768px) {
  .btw-panel {
    width: calc(100% - 24px);
    max-width: none;
    max-height: 50vh;
    margin: 0 12px;
  }

  .btw-header {
    padding: 10px 14px;
  }

  .btw-body {
    padding: 14px;
  }
}
```

### 4.11 Locale Keys

**en.json:**

```json
"slash.btw": "Ask a side question (won't affect conversation)",
"btw.title": "Side Question",
"btw.dismiss": "Dismiss",
"btw.escDismiss": "Press Esc to dismiss",
"btw.tapDismiss": "Tap to dismiss"
```

**zh.json:**

```json
"slash.btw": "快速旁问（不影响对话）",
"btw.title": "旁问",
"btw.dismiss": "关闭",
"btw.escDismiss": "按 Esc 关闭",
"btw.tapDismiss": "点击关闭"
```

### 4.12 Agent-Side — `connection.ts`

Add a new case in the message handler switch:

```typescript
case 'btw_question': {
  const { question, conversationId } = msg as { question: string; conversationId?: string };
  handleBtwQuestion(question, conversationId, send);
  break;
}
```

### 4.13 Agent-Side — `claude.ts`

```typescript
async function handleBtwQuestion(
  question: string,
  conversationId: string | undefined,
  send: (msg: unknown) => void,
): Promise<void> {
  // 1. Get the current conversation's session ID for context
  const sessionId = conversationId
    ? conversations.get(conversationId)?.claudeSessionId
    : lastClaudeSessionId;

  if (!sessionId) {
    send({ type: 'btw_answer', delta: 'No active conversation context available.', done: true });
    return;
  }

  // 2. Spawn a lightweight Claude query with session context
  const args = [
    '-p', question,
    '--resume', sessionId,
    '--no-session-persistence',
    '--tools', '""',
    '--output-format', 'stream-json',
  ];

  // 3. Stream output back as btw_answer deltas
  // (Implementation: spawn child process, parse stream-json lines,
  //  extract text deltas, forward as btw_answer messages)
}
```

> **Note:** The exact implementation of the agent-side streaming will depend on whether `--resume` + `--no-session-persistence` + `--tools ""` is a valid combination in the Claude CLI. This needs verification during implementation. An alternative approach is to construct the prompt with conversation summary inline rather than using `--resume`.

---

## 5. Edge Cases

| Scenario | Handling |
|----------|----------|
| Empty question (`/btw ` with nothing after) | `sendMessage` returns early, no action |
| `/btw` without space (just the command) | Slash menu selects it, fills `/btw ` with trailing space |
| Agent disconnected | Overlay shows error (existing disconnect detection) |
| Agent doesn't support `btw_question` | Error routed to overlay: "Unsupported command... Please upgrade" |
| User sends another `/btw` while one is open | Previous overlay replaced with new question |
| User presses Escape while slash menu is open | Closes slash menu (existing behavior), not the btw overlay |
| Overlay open + user sends normal message | Normal message sent as usual, overlay stays open |
| Overlay open + Claude finishes main turn | `turn_completed` processed normally, overlay unaffected |
| Very long answer overflows | `.btw-body` scrolls vertically, capped at `60vh`/`50vh` |
| Network error during streaming | Overlay shows partial answer received so far; user can dismiss |

---

## 6. Sequencing

1. **Phase 1 — Web UI only** (no agent changes): Register `/btw` in slash menu, build overlay UI, handle `btw_answer` in connection handler, route `btw_question` errors to overlay. Test with current agent (should show upgrade prompt in overlay).
2. **Phase 2 — Agent support**: Add `btw_question` handler in `connection.ts` and `claude.ts`, implement streaming side-question query.
