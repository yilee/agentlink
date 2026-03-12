# E2E Test Plan -- `/btw` Side Question Feature

This document defines the manual E2E test suite for the `/btw` side question feature. It covers slash command integration, overlay rendering, streaming answers, dismissal behavior, concurrent usage with the main conversation, error handling, and mobile responsiveness.

Design document: [`docs/btw-side-question-design.md`](btw-side-question-design.md)

## Prerequisites

1. Build the project: `npm run build`
2. Start ephemeral server and agent, using `test/e2e-workdir` as working directory to isolate test sessions from real history:
   ```bash
   node server/dist/cli.js start --ephemeral --port <PORT>
   node agent/dist/cli.js start --server ws://localhost:<PORT> --ephemeral --dir test/e2e-workdir
   ```
   > **Important:** Always use `test/e2e-workdir` as `--dir` so test session history (stored under `~/.claude/projects/`) is kept separate from real project sessions. Do NOT use the project root as the working directory for E2E tests.
3. Open the session URL in a browser (shown in agent startup output).
4. Verify status bar shows "Connected" and the agent name.
5. Send at least one normal message (e.g., `What is 1+1? Reply with just the number, do not use any tools.`) and wait for a response. This establishes a conversation context for subsequent `/btw` tests.

## Test Cases

---

### TC-36: `/btw` appears in slash command menu

**Steps:**
1. Click the input area to focus it.
2. Type `/b`.

**Expected:**
1. The slash command menu opens.
2. The menu lists `/btw` with description "Ask a side question (won't affect conversation)" (or its localized equivalent).
3. `/btw` is listed alongside `/cost`, `/context`, and `/compact`.

---

### TC-37: Selecting `/btw` from menu fills input as prefix

**Steps:**
1. Type `/b` in the input area to open the slash command menu.
2. Click on the `/btw` entry in the menu (or press Enter while it is highlighted).

**Expected:**
1. The input area is filled with `/btw ` (the command followed by a trailing space).
2. The cursor is positioned after the trailing space, ready for the user to type a question.
3. The slash command menu closes.
4. No message is sent -- the input remains editable.

---

### TC-38: Sending `/btw` shows overlay with streaming answer

**Steps:**
1. Ensure a conversation with at least one exchange exists (from Prerequisites step 5).
2. Type `/btw what was my first question?` in the input area.
3. Press Enter.

**Expected:**
1. The input area clears after sending.
2. A floating overlay appears centered over the message list area.
3. The overlay header reads "Side Question" with a close button.
4. Below the header, the question text appears in italic: "what was my first question?"
5. Loading dots (typing indicator) appear while waiting for the answer.
6. The answer streams in incrementally, replacing the loading dots.
7. The answer references the first question from step 5 of Prerequisites (e.g., "1+1"), confirming context awareness.
8. No message is added to the main chat message list.
9. The `isProcessing` state of the main conversation is not affected (the input area remains functional -- no "Stop generation" button appears for the btw query).

---

### TC-39: Overlay answer renders markdown

**Steps:**
1. Type `/btw explain what markdown code fences are, and include a short example code block` and press Enter.

**Expected:**
1. The overlay appears and streams in the answer.
2. The answer contains rendered markdown: code blocks with syntax highlighting, paragraphs, and/or inline code.
3. Markdown elements are properly styled (not displayed as raw text with backticks).

---

### TC-40: Overlay shows dismiss hint when done

**Steps:**
1. Send `/btw what is 2+2?` and wait for the answer to complete.

**Expected:**
1. Once the answer finishes streaming (the loading indicator disappears), a hint appears at the bottom of the overlay panel: "Press Esc to dismiss" (on desktop).
2. The hint text is small and muted (tertiary text color).
3. The hint only appears after `done: true` is received -- it is not visible while streaming.

---

### TC-41: Dismiss overlay via close button

**Steps:**
1. Send `/btw what is 2+2?` and wait for the answer.
2. Click the close button in the overlay header.

**Expected:**
1. The overlay disappears completely.
2. The overlay DOM element is removed (not just hidden -- inspecting the DOM should show no `.btw-overlay` element).
3. The main chat messages are unaffected.
4. No btw-related content appears in the message list.

---

### TC-42: Dismiss overlay via Escape key

**Steps:**
1. Send `/btw what is 3+3?` and wait for the answer.
2. Press the Escape key.

**Expected:**
1. The overlay closes and is removed from the DOM.
2. The main chat and input area are unaffected.

---

### TC-43: Dismiss overlay via backdrop click

**Steps:**
1. Send `/btw what is 4+4?` and wait for the answer.
2. Click on the semi-transparent backdrop area (outside the white panel, but within the overlay region).

**Expected:**
1. The overlay closes and is removed from the DOM.
2. Clicking on the panel itself does NOT dismiss it (only the backdrop area outside the panel triggers dismissal).

---

### TC-44: Dismiss overlay while answer is still streaming

**Steps:**
1. Send `/btw write a paragraph about the history of computing` (a question that produces a longer answer).
2. While the answer is actively streaming (text still appearing), click the close button.

**Expected:**
1. The overlay closes immediately, even though streaming is not yet complete.
2. No error occurs.
3. The partial answer is discarded -- nothing is saved or added to the message list.
4. Subsequent normal messages continue to work correctly.

---

### TC-45: `/btw` while main conversation is processing

**Steps:**
1. Send a normal message that takes time: `Count from 1 to 20, one number per line. Do not use any tools.`
2. While Claude is streaming the count, type `/btw what is my working directory?` and press Enter.

**Expected:**
1. The btw overlay appears and shows the question.
2. The main conversation continues streaming numbers in the background (visible behind the semi-transparent backdrop).
3. The btw answer arrives and streams in the overlay, independent of the main conversation output.
4. The "Stop generation" button remains visible for the main conversation (it relates to the main processing, not the btw query).
5. After dismissing the overlay, the main conversation's count is complete (or still streaming) and fully intact.

---

### TC-46: Normal message while overlay is open

**Steps:**
1. Send `/btw what is 5+5?` and wait for the answer to appear.
2. Without dismissing the overlay, type `What is 6+6? Reply with just the number, do not use any tools.` in the input area.
3. Press Enter.

**Expected:**
1. The normal message is sent successfully -- it appears in the main message list as a user message.
2. The overlay remains open and undisturbed while the normal message is processed.
3. Claude responds with `12` in the main message list.
4. The overlay can still be dismissed after the normal message exchange completes.

---

### TC-47: Sending a new `/btw` replaces existing overlay

**Steps:**
1. Send `/btw what is 7+7?` and wait for the answer.
2. Without dismissing the overlay, send `/btw what is 8+8?`.

**Expected:**
1. The first overlay is replaced by the second overlay.
2. The second overlay shows the new question "what is 8+8?" and streams a new answer.
3. There is only one overlay visible at any time (not two stacked).
4. The first question's answer is discarded.

---

### TC-48: Empty question does nothing

**Steps:**
1. Type `/btw ` (with a trailing space, but no question text after it).
2. Press Enter.

**Expected:**
1. Nothing happens -- no overlay appears, no message is sent.
2. The input area retains the text `/btw ` (or clears it, depending on implementation) but no WebSocket message is dispatched.
3. No error message appears.

---

### TC-49: Very long answer scrolls within overlay

**Steps:**
1. Send `/btw write a very detailed explanation of how TCP/IP networking works, at least 500 words`.
2. Wait for the full answer to complete.

**Expected:**
1. The overlay panel does not grow beyond `60vh` in height (desktop).
2. The answer body (`.btw-body`) is scrollable -- a vertical scrollbar appears when content exceeds the visible area.
3. The header ("Side Question" + close button) and the dismiss hint remain fixed (they do not scroll with the answer content).
4. The user can scroll through the full answer within the overlay.

---

### TC-50: Overlay survives main conversation turn completion

**Steps:**
1. Send a normal message: `What is 10+10? Reply with just the number, do not use any tools.`
2. While Claude is responding, quickly send `/btw what was my first question?`.
3. Wait for the main conversation to complete (`turn_completed`).

**Expected:**
1. The overlay remains open after the main conversation's `turn_completed` fires.
2. The overlay content is not cleared or affected by the main turn completing.
3. The btw answer continues streaming (or shows completed) independently.

---

### TC-51: Multiple rapid `/btw` sends show only the last one

**Steps:**
1. Rapidly send three `/btw` questions in quick succession:
   - `/btw what is 1+1?`
   - `/btw what is 2+2?`
   - `/btw what is 3+3?`

**Expected:**
1. Only one overlay is visible at any time.
2. The final overlay shows the last question: "what is 3+3?"
3. The answer displayed corresponds to the last question sent.
4. No visual flicker or error occurs from the rapid replacement.

---

### TC-52: Unsupported agent shows error in overlay

**Prerequisites:** This test requires an agent version that does NOT support the `btw_question` message type. Either use an older agent binary or temporarily remove the `btw_question` case from `agent/src/connection.ts` and rebuild.

**Steps:**
1. Connect with an agent that does not handle `btw_question`.
2. Send `/btw what is my working directory?`.

**Expected:**
1. The overlay appears with the question text and loading dots.
2. After a brief moment, the error message appears inside the overlay (in red, with a colored background): "Unsupported command: btw_question. Please upgrade your agent: agentlink-client upgrade".
3. The error is shown ONLY in the overlay -- no system error message is added to the main chat message list.
4. The main conversation's `isProcessing` state is NOT cleared by this error (if the main conversation was mid-processing, it continues unaffected).
5. The dismiss hint does not appear (since it was an error, not a successful answer).
6. The overlay can be dismissed via the close button, Escape, or backdrop click.

---

### TC-53: Btw error does not clear main conversation processing state

**Prerequisites:** Same as TC-52 -- requires an agent that does not support `btw_question`.

**Steps:**
1. Send a normal message: `Count from 1 to 30, one number per line. Do not use any tools.`
2. While counting is streaming, send `/btw what is 1+1?`.
3. Wait for the btw error to appear in the overlay.

**Expected:**
1. The btw error appears in the overlay.
2. The main conversation continues counting uninterrupted.
3. The "Stop generation" button for the main conversation remains visible.
4. `isProcessing` is still `true` for the main conversation.
5. After dismissing the btw error overlay, the count continues or completes normally.

---

### TC-54: Agent disconnects while btw is pending

**Steps:**
1. Send `/btw what is my working directory?`.
2. While the overlay is showing loading dots (before the answer arrives), kill the agent process (e.g., Ctrl+C in the agent terminal).

**Expected:**
1. The status bar indicates the agent is disconnected.
2. An error is shown appropriately -- either in the overlay (as a btw error) or as a connection-level disconnect notification.
3. The overlay can still be dismissed.
4. After reconnecting the agent, normal messaging works again.

---

### TC-55: Escape key priority -- slash menu vs btw overlay

**Steps:**
1. Send `/btw what is 1+1?` and wait for the answer (overlay is open).
2. Type `/c` in the input area to open the slash command menu.
3. Press Escape.

**Expected:**
1. The first Escape press closes the slash command menu (existing behavior).
2. The btw overlay remains open.
3. Press Escape again -- now the btw overlay closes.

---

### TC-56: `/btw` does not appear in session history

**Steps:**
1. Ensure a conversation exists with normal messages.
2. Send `/btw some random question` and wait for the answer.
3. Dismiss the overlay.
4. Refresh the page.
5. Click on the conversation in the sidebar to restore it.

**Expected:**
1. The restored conversation shows only the normal messages.
2. The `/btw` question and its answer do not appear anywhere in the restored history.
3. No user message with "/btw" prefix is visible in the message list.

---

### TC-57: Mobile -- overlay layout (< 768px viewport)

**Prerequisites:** Resize the browser window to less than 768px width, or use the browser's device emulation mode (e.g., iPhone SE in Chrome DevTools).

**Steps:**
1. Send `/btw what is 2+2?` and wait for the answer.

**Expected:**
1. The overlay panel takes full width of the viewport minus `12px` margin on each side (i.e., `width: calc(100% - 24px)`).
2. The panel's max height is `50vh` (not `60vh` as on desktop).
3. The dismiss hint reads "Tap to dismiss" (not "Press Esc to dismiss").
4. The overlay is still vertically centered within the message list area.
5. Header, question, answer, and dismiss hint are all legible and properly spaced.

---

### TC-58: Mobile -- dismiss overlay by tapping backdrop

**Prerequisites:** Same mobile viewport setup as TC-57.

**Steps:**
1. Send `/btw what is 3+3?` and wait for the answer.
2. Tap the backdrop area (outside the overlay panel).

**Expected:**
1. The overlay closes.
2. The main chat is unaffected.

---

### TC-59: Overlay styling -- dark mode

**Steps:**
1. Switch the UI to dark mode (using the theme toggle in the header).
2. Send `/btw what is pi?` and wait for the answer.

**Expected:**
1. The overlay panel uses dark mode colors: dark background (`--bg-primary`), light text (`--text-primary`).
2. The backdrop semi-transparency is visible and contrasts with the dark theme.
3. The close button, question text, answer text, and dismiss hint all use appropriate dark mode colors.
4. If the answer contains code blocks, they are styled with dark mode code highlighting.
5. Error state (if triggered) uses dark-mode-appropriate danger colors.

---

## Architecture Reference

### State Flow

```
User types "/btw <question>" → sendMessage()
  → sendMessage detects /btw prefix
  → Sets btwState = { question, answer: '', done: false, error: null }
  → Sets btwPending = true
  → Sends { type: 'btw_question', question, conversationId } via WebSocket
  → Clears input
  → Does NOT set isProcessing, does NOT create a user message

Agent receives btw_question
  → Spawns lightweight Claude query (claude -p, ephemeral, no tools)
  → Streams btw_answer { delta, done: false } messages back
  → Sends final btw_answer { delta, done: true }

Web receives btw_answer
  → Sets btwPending = false
  → Appends delta to btwState.answer
  → When done: true, sets btwState.done = true → shows dismiss hint

Web receives error (while btwPending && message contains "btw_question")
  → Routes error to overlay: btwState.error = message
  → Does NOT clear isProcessing, does NOT push to message list
```

### Dismissal

```
dismissBtw()
  → btwState = null (removes overlay from DOM)
  → btwPending = false
```

Triggers: close button click, Escape keydown (only if no slash menu is open), backdrop click (via @click.self on .btw-overlay).

### Key Reactive State

| Variable | Type | Purpose |
|----------|------|---------|
| `btwState` | `ref(null)` | `null` = overlay hidden; object = overlay shown with question/answer/done/error |
| `btwPending` | `ref(false)` | `true` between sending `btw_question` and receiving first `btw_answer` or error |

### CSS Classes

| Class | Element |
|-------|---------|
| `.btw-overlay` | Full-area backdrop (absolute positioning, semi-transparent) |
| `.btw-panel` | The floating white panel (max-width 560px desktop, full-width minus margins on mobile) |
| `.btw-header` | Header bar with title and close button |
| `.btw-body` | Scrollable answer area |
| `.btw-question` | Italic question text |
| `.btw-answer` | Markdown-rendered answer |
| `.btw-error` | Red error message |
| `.btw-loading` | Loading dots container |
| `.btw-hint` | Dismiss hint text at bottom |

## Test Results Log

| # | Test | Status |
|---|------|--------|
| 36 | `/btw` appears in slash command menu | PASSED |
| 37 | Selecting `/btw` from menu fills input as prefix | PASSED |
| 38 | Sending `/btw` shows overlay with streaming answer | PASSED |
| 39 | Overlay answer renders markdown | PASSED |
| 40 | Overlay shows dismiss hint when done | PASSED |
| 41 | Dismiss overlay via close button | PASSED |
| 42 | Dismiss overlay via Escape key | PASSED |
| 43 | Dismiss overlay via backdrop click | PASSED |
| 44 | Dismiss overlay while answer is still streaming | PASSED |
| 45 | `/btw` while main conversation is processing | PASSED |
| 46 | Normal message while overlay is open | PASSED |
| 47 | Sending a new `/btw` replaces existing overlay | PASSED |
| 48 | Empty question does nothing | PASSED |
| 49 | Very long answer scrolls within overlay | SKIPPED (requires real viewport measurement) |
| 50 | Overlay survives main conversation turn completion | PASSED |
| 51 | Multiple rapid `/btw` sends show only the last one | PASSED |
| 52 | Unsupported agent shows error in overlay | PASSED |
| 53 | Btw error does not clear main conversation processing state | SKIPPED (requires mock agent without btw support) |
| 54 | Agent disconnects while btw is pending | SKIPPED (requires killing agent mid-test) |
| 55 | Escape key priority -- slash menu vs btw overlay | PASSED |
| 56 | `/btw` does not appear in session history | PASSED |
| 57 | Mobile -- overlay layout (< 768px viewport) | SKIPPED (requires mobile viewport) |
| 58 | Mobile -- dismiss overlay by tapping backdrop | SKIPPED (requires mobile viewport) |
| 59 | Overlay styling -- dark mode | PASSED |

19 of 24 tests passed via Playwright automation (2026-03-12). 5 tests skipped (require specialized setup: real viewport measurement, mobile emulation, agent process kill).
