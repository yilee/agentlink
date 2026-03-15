# Fix: Processing State Lost After Page Refresh

## Problem

Two UI bugs occur when the user refreshes the page while Claude is actively processing:

### Symptom 1: Chat shows as "completed" after refresh

When refreshing during an active turn, the chat UI shows the conversation as idle — no
typing indicator, the send button appears instead of the stop button, and no loading
animation. However, if the user clicks the session in the sidebar (triggering a
`resume_conversation`), the state restores correctly. On the *next* refresh it breaks
again, creating an alternating correct/incorrect pattern.

### Symptom 2: Sidebar pulsing dot missing for active sessions

The sidebar session list used to show a pulsing dot (CSS `pulse` animation) on sessions
that are actively processing. After introducing multi-session parallel support, this
indicator stopped appearing after page refreshes.

Both symptoms share the same root cause.

## Root Cause

### The conversationId mismatch after page refresh

The web client generates `currentConversationId` as a random UUID on every page load:

```javascript
// store.js:115
const currentConversationId = ref(crypto.randomUUID());
```

When a user sends a message, this UUID is attached as `conversationId` and the agent
stores the conversation in its Map keyed by that ID (e.g. `"AAA"`).

On page refresh, the web client generates a **new** UUID (e.g. `"BBB"`). The reconnection
flow then proceeds:

1. WebSocket connects → server sends `connected`
2. Web sends `query_active_conversations`
3. Agent responds with `active_conversations: [{ conversationId: "AAA", ... }]`
4. `handleActiveConversations()` checks if `"AAA"` matches `currentConversationId` (`"BBB"`)
5. **It does not match** → `isProcessing` is set to `false`
6. The entry `"AAA"` is also not in `conversationCache` (empty after refresh) → skipped

The relevant code in `connection.js:343-385`:

```javascript
function handleActiveConversations(msg) {
  const activeSet = new Set();
  const convs = msg.conversations || [];
  for (const entry of convs) {
    if (entry.conversationId) activeSet.add(entry.conversationId);
  }

  // ❌ currentConversationId is a fresh UUID — will never be in activeSet
  if (!activeSet.has(currentConversationId && currentConversationId.value)) {
    isProcessing.value = false;
    isCompacting.value = false;
  }

  for (const entry of convs) {
    const convId = entry.conversationId;
    // ❌ convId ("AAA") !== currentConversationId ("BBB") → skipped
    if (currentConversationId && currentConversationId.value === convId) {
      isProcessing.value = true;             // never reached
    // ❌ conversationCache is empty after refresh → skipped
    } else if (conversationCache && conversationCache.value[convId]) {
      // ...                                  // never reached
    }
    // processingConversations["AAA"] = true  // set, but nobody reads it by "AAA"
  }
}
```

### Why it alternates

1. **First refresh**: `active_conversations` returns `"AAA"` but client has `"BBB"` →
   mismatch → `isProcessing = false` → UI looks idle.
2. **User clicks session in sidebar**: `resumeSession()` sends `resume_conversation` with
   a new `conversationId: "CCC"`. Agent calls `rebindConversation("AAA" → "CCC")`.
   Agent replies `conversation_resumed` with `isProcessing: true` → UI correct.
3. **Second refresh**: `active_conversations` now returns `"CCC"` but client has `"DDD"` →
   mismatch again → `isProcessing = false` → UI looks idle again.

### Why the sidebar pulsing dot disappears

The dot is controlled by `isSessionProcessing(claudeSessionId)` in `sidebar.js:352-365`,
which checks two sources:

1. `conversationCache` entries where `cached.claudeSessionId === target` — but the cache
   is empty after a fresh page load.
2. Foreground: `currentClaudeSessionId === target && isProcessing.value` — but
   `isProcessing` is `false` (due to the mismatch above) and `currentClaudeSessionId` is
   also empty until the user clicks into a session.

The CSS (`.session-item.processing .session-title::before` with `animation: pulse`) and
the class binding (`:class="{ processing: isSessionProcessing(s.sessionId) }"`) are both
correct. The issue is purely that the processing state is never set.

## Affected Files

| File | Role |
|------|------|
| `server/web/src/modules/connection.js` | `handleActiveConversations()` — matching logic |
| `server/web/src/modules/sidebar.js` | `isSessionProcessing()` — sidebar dot condition |
| `server/web/src/store.js` | `currentConversationId` — generated fresh each load |
| `agent/src/connection.ts` | `query_active_conversations` handler — response payload |
| `agent/src/claude.ts` | `rebindConversation()` — remaps conversation key |

## Fix Plan

### Approach: Match by `claudeSessionId` when `conversationId` doesn't match

The `active_conversations` response already includes `claudeSessionId` for each active
entry. After a page refresh, the web client doesn't know its old `conversationId`, but
the session list in the sidebar contains `claudeSessionId` values. We can use
`claudeSessionId` as a secondary matching key.

### Change 1: Auto-adopt active conversations on page refresh

**File:** `server/web/src/modules/connection.js` — `handleActiveConversations()`

After the existing matching-by-`conversationId` loop, add a second pass: for any active
entry that was **not** matched by `conversationId`, check if there is exactly one active
conversation (common case = single foreground session). If so, adopt it:

```javascript
function handleActiveConversations(msg) {
  const activeSet = new Set();
  const convs = msg.conversations || [];
  for (const entry of convs) {
    if (entry.conversationId) activeSet.add(entry.conversationId);
  }

  // Phase 1: clear state for conversations not in the active set (existing logic)
  const wasForegroundProcessing = isProcessing.value;
  if (!activeSet.has(currentConversationId && currentConversationId.value)) {
    isProcessing.value = false;
    isCompacting.value = false;
  }
  // ... existing cache/processingConversations cleanup ...

  // Phase 2: restore state for matched conversations (existing logic)
  let foregroundMatched = false;
  for (const entry of convs) {
    const convId = entry.conversationId;
    if (!convId) continue;
    if (currentConversationId && currentConversationId.value === convId) {
      isProcessing.value = true;
      isCompacting.value = !!entry.isCompacting;
      foregroundMatched = true;
    } else if (conversationCache && conversationCache.value[convId]) {
      // ... existing cache update ...
    }
    if (processingConversations) {
      processingConversations.value[convId] = true;
    }
  }

  // Phase 3 (NEW): adopt unmatched active conversations after page refresh
  // If the foreground wasn't matched by conversationId and there are active
  // conversations, auto-resume each one so the UI reflects the live state.
  if (!foregroundMatched && convs.length > 0) {
    // If current foreground has no messages (fresh page load), adopt the first
    // active conversation as the foreground session.
    const isFreshPage = messages.value.length === 0
        && !currentClaudeSessionId.value;

    for (const entry of convs) {
      if (!entry.conversationId || !entry.claudeSessionId) continue;

      if (isFreshPage && entry === convs[0]) {
        // Adopt as foreground: trigger resume_conversation so the agent
        // rebinds this conversation to our new currentConversationId and
        // sends back conversation_resumed with isProcessing/history.
        wsSend({
          type: 'resume_conversation',
          conversationId: currentConversationId.value,
          claudeSessionId: entry.claudeSessionId,
        });
        loadingHistory.value = true;
      } else {
        // Additional active conversations → create cached background entries
        // so the sidebar shows their processing state.
        const bgConvId = entry.conversationId; // use agent's existing key
        if (processingConversations) {
          processingConversations.value[bgConvId] = true;
        }
        if (conversationCache) {
          if (!conversationCache.value[bgConvId]) {
            conversationCache.value[bgConvId] = {
              messages: [],
              isProcessing: true,
              isCompacting: !!entry.isCompacting,
              claudeSessionId: entry.claudeSessionId,
            };
          } else {
            conversationCache.value[bgConvId].isProcessing = true;
          }
        }
      }
    }
  }

  // ... existing team/idle-check/dequeue logic ...
}
```

This triggers `resume_conversation`, which causes the agent to call
`rebindConversation()` (remapping the conversation to the web client's new UUID) and
respond with `conversation_resumed` carrying `isProcessing: true` plus full history.
The existing `conversation_resumed` handler in `session-handler.js:23-58` then correctly
sets `isProcessing.value = true` and rebuilds the message list.

### Change 2: Update `isSessionProcessing` to also check `processingConversations`

**File:** `server/web/src/modules/sidebar.js` — `isSessionProcessing()`

Add a fallback: scan `processingConversations` for entries that are `true` and whose
cached `claudeSessionId` matches the target. This handles background conversations that
were registered in Phase 3 above:

```javascript
function isSessionProcessing(claudeSessionId) {
  if (!conversationCache || !processingConversations) return false;

  // Check cached background conversations
  for (const [convId, cached] of Object.entries(conversationCache.value)) {
    if (cached.claudeSessionId === claudeSessionId && cached.isProcessing) {
      return true;
    }
  }

  // Check current foreground conversation
  if (currentClaudeSessionId.value === claudeSessionId && isProcessing.value) {
    return true;
  }

  // (NEW) Check processingConversations directly — covers entries created
  // by handleActiveConversations Phase 3 that may not yet have full cache
  // entries with claudeSessionId set.
  // → This is required for the pulsing dot to show before resume_conversation
  //   completes.

  return false;
}
```

Actually, since the Phase 3 code above already populates `conversationCache` with
`claudeSessionId` for background entries, the existing `isSessionProcessing` loop should
already pick them up. No change needed here — the fix in Change 1 is sufficient.

### Change 3 (Optional): Persist `currentConversationId` across refreshes

As an alternative (or complementary) approach, persist `currentConversationId` in
`sessionStorage` so that after a refresh the web client uses the **same** UUID:

**File:** `server/web/src/store.js`

```javascript
// Replace:
const currentConversationId = ref(crypto.randomUUID());

// With:
const CONV_ID_KEY = 'agentlink-current-conversation-id';
const currentConversationId = ref(
  sessionStorage.getItem(CONV_ID_KEY) || crypto.randomUUID()
);
watch(currentConversationId, (v) => {
  if (v) sessionStorage.setItem(CONV_ID_KEY, v);
});
```

This would make the `active_conversations` matching work on the first pass without
needing the auto-resume fallback. However, Change 1 is still needed as a safety net
(e.g. when `sessionStorage` is cleared, or for the very first load).

## Recommended Approach

**Change 1 + Change 3** together provide the most robust fix:

- **Change 3** is the simplest: preserving the same `conversationId` across refreshes
  means the existing `handleActiveConversations` matching logic works with zero changes.
  The `conversationId` the agent has in its Map will match `currentConversationId` after
  refresh, so `isProcessing` is correctly set to `true`.

- **Change 1** acts as a safety net for edge cases (first ever page load, cleared
  sessionStorage, multiple tabs). It auto-resumes active conversations that can't be
  matched by `conversationId`, ensuring the UI always reflects reality.

With both changes:
- `isProcessing` is correctly restored → typing indicator shows, stop button appears
- `processingConversations` is populated → `isSessionProcessing()` returns `true` →
  sidebar pulsing dot appears
- `resume_conversation` triggers `rebindConversation` on the agent →
  `claude_output` messages arrive with the correct `conversationId` → streaming works

## Testing

1. Start a long Claude turn (e.g. "write a 500-line program").
2. While output is streaming, refresh the page (F5).
3. **Expected**: Chat immediately shows typing indicator / loading state. Sidebar shows
   pulsing dot on the active session.
4. Click on the session — history loads, streaming output appears.
5. Refresh again — same correct behavior (no alternating).
6. Test with multiple parallel conversations active — all should show pulsing dots.
7. Test with no active conversations — refresh should show idle state correctly.
8. Open a second browser tab to the same session URL — both tabs should reflect the
   correct processing state independently.
