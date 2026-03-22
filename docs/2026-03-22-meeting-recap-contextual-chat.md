# Meeting Recap Contextual Chat

> **Date:** 2026-03-22
> **Status:** Draft
> **Depends on:** Meeting Recap Feed (2026-03-21), Multi-Session Parallel, Session Metadata

## Overview

Add an "Ask about this meeting" chat feature to the RecapDetail page. Users can have a conversation about the meeting content (ask questions, summarize, drill into topics, etc.) while viewing the meeting recap.

### Core Requirements

1. RecapDetail page has two sections: detail content on top + chat area below
2. Clicking "Ask about this meeting" starts a new chat; the first message injects meeting context
3. Full chat capabilities: message rendering, tool calls, streaming output, cancel, etc. — identical to the regular chat window
4. Session persistence: exiting and re-entering the same recap restores the chat history
5. Maximize reuse of existing chat components (message rendering, input box, etc.)
6. Show all recap chat history in the Feed sidebar (future)

---

## Architecture

### Design Principle: Recap Chat = Regular Conversation + Meeting Context

Core idea: each recap chat is an independent conversation (exactly like regular multi-session parallel), the only difference being the first message includes meeting context. No new WebSocket message types are introduced, and the agent's main message handling logic is not modified.

```
┌─────────────────────────────────────────────────────┐
│  RecapDetail (recap-detail view)                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  Detail Content (collapsible)                 │  │
│  │  - Header, For You, TL;DR, Hook Sections      │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │  ─── Ask about this meeting ────────────────  │  │  ← divider
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │  Chat Message List (reuses message rendering) │  │  ← reuses ChatView message rendering
│  │  - user, assistant, tool, system roles         │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │  Chat Input (reuses ChatInput pattern)        │  │  ← reuses input box
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Data Flow

```
User types question in RecapDetail
  → recap.sendRecapChat(text)
    → builds payload { type: 'chat', conversationId: 'recap-chat-{recapId}', prompt, brainMode: true }
    → first message: prompt = meetingContext + "\n---\n" + userQuestion
    → wsSend(payload)
  → Agent receives chat with conversationId
    → handleChat() starts new Claude process (or reuses existing)
    → Claude streams output → claude_output with matching conversationId
  → Web receives claude_output
    → routes to correct conversation via conversationId
    → updates recap chat messages array
    → RecapDetail re-renders chat section
```

---

## Implementation Plan

### Phase 1: Session Metadata Extension

**File:** `agent/src/session-metadata.ts`

Extend the `SessionMetadata` interface with a new `recapId` field:

```typescript
export interface SessionMetadata {
  brainMode?: boolean;
  recapId?: string;       // Associated recap ID for persistent mapping
}
```

**Write timing:** When the recap chat's Claude session starts (on `session_started`), the agent calls `saveSessionMetadata(claudeSessionId, { recapId, brainMode: true })`.

**Read timing:** `handleListSessions()` already merges all metadata via `loadAllSessionMetadata()`, so the web client can directly access the `recapId` field.

Change scope:
| File | Change |
|------|--------|
| `agent/src/session-metadata.ts` | Add `recapId?: string` to `SessionMetadata` |
| `agent/src/connection.ts` | Chat handler: if payload includes `recapId`, save to metadata on session_started |

### Phase 2: Web-side recap.js Chat State Extension

**File:** `server/web/src/modules/recap.js`

The existing `chatMessages` ref was reserved but unused. Extend `createRecap()` to add chat management:

```javascript
export function createRecap({ wsSend, switchConversation, conversationCache, messages,
                              isProcessing, currentConversationId, streaming }) {
  // ... existing state ...

  // ── Recap Chat State ──
  const recapChatSessionMap = ref({});   // { [recapId]: claudeSessionId } — built from sessions_list
  const recapChatActive = ref(false);    // whether the current recap has an active chat

  // Switch to the recap chat conversation
  function enterRecapChat(recapId) {
    const convId = `recap-chat-${recapId}`;
    switchConversation(convId);
    recapChatActive.value = true;
  }

  // Exit recap chat, restore the previous conversation
  function exitRecapChat(previousConvId) {
    switchConversation(previousConvId);
    recapChatActive.value = false;
  }

  // Send a recap chat message
  function sendRecapChat(text, recapId, detail) {
    const convId = `recap-chat-${recapId}`;
    const isFirstMessage = !conversationCache.value[convId]
      || conversationCache.value[convId].messages.length === 0;

    let prompt = text;
    if (isFirstMessage) {
      prompt = buildMeetingContext(detail) + '\n---\n' + text;
    }

    wsSend({
      type: 'chat',
      conversationId: convId,
      prompt,
      brainMode: true,
      recapId,                // agent uses this for session metadata association
    });
  }

  // Extract recap chat sessions from sessions_list
  function updateRecapChatSessions(sessions) {
    const map = {};
    for (const s of sessions) {
      if (s.recapId) {
        map[s.recapId] = s.sessionId;
      }
    }
    recapChatSessionMap.value = map;
  }

  return {
    // ... existing returns ...
    recapChatActive, recapChatSessionMap,
    enterRecapChat, exitRecapChat, sendRecapChat,
    updateRecapChatSessions,
  };
}
```

**Change scope:**
| File | Change |
|------|--------|
| `server/web/src/modules/recap.js` | Add chat state management, context builder, session map |

### Phase 3: Meeting Context Builder

**File:** `server/web/src/modules/recap.js`

When the first message is sent, meeting context is automatically prepended so Claude understands the meeting background:

```javascript
function buildMeetingContext(sidecarDetail) {
  const { meta, detail } = sidecarDetail;
  const lines = [];

  lines.push('[Meeting Context — You are answering questions about this meeting recap]');
  lines.push('');
  lines.push(`Meeting: ${meta?.meeting_name || 'Unknown'}`);
  if (meta?.occurred_at_local) lines.push(`Date: ${meta.occurred_at_local}`);
  if (meta?.duration) lines.push(`Duration: ${meta.duration}`);
  if (meta?.meeting_type) lines.push(`Type: ${meta.meeting_type}`);
  if (meta?.project) lines.push(`Project: ${meta.project}`);
  if (meta?.participants?.length) {
    lines.push(`Participants: ${meta.participants.join(', ')}`);
  }

  if (detail?.tldr) {
    lines.push('');
    lines.push(`## TL;DR`);
    lines.push(detail.tldr);
  }

  if (detail?.for_you?.length) {
    lines.push('');
    lines.push(`## Key Takeaways for You`);
    for (const item of detail.for_you) {
      lines.push(`- ${item.text} (${item.reason})`);
    }
  }

  if (detail?.hook_sections?.length) {
    for (const section of detail.hook_sections) {
      lines.push('');
      lines.push(`## ${section.title}`);
      for (const item of section.items) {
        lines.push(`- ${item.text}`);
      }
      if (section.omitted_count > 0) {
        lines.push(`  (${section.omitted_count} more items omitted)`);
      }
    }
  }

  return lines.join('\n');
}
```

This way Claude receives the full meeting summary + the user's actual question in the first message, with no need to read additional files.

### Phase 4: Component Refactor — Extract MessageList

**Problem:** The message rendering logic in `ChatView.vue` is tied to `v-if="viewMode === 'chat' && currentView === 'chat'"`, making it impossible to reuse in RecapDetail.

**Solution:** Extract a `MessageList.vue` component that encapsulates message list rendering logic.

#### 4a. Create `MessageList.vue`

**File:** `server/web/src/components/MessageList.vue`

Extract the message loop rendering from `ChatView.vue` (original lines 39-151) into a reusable component:

```vue
<script setup>
import { inject } from 'vue';
import ToolBlock from './ToolBlock.vue';
import AskQuestionCard from './AskQuestionCard.vue';

// Props control data source (instead of hardcoding store)
const props = defineProps({
  messages: { type: Array, required: true },
  visibleMessages: { type: Array, required: true },
  hasMoreMessages: { type: Boolean, default: false },
  isProcessing: { type: Boolean, default: false },
  hasStreamingMessage: { type: Boolean, default: false },
  loadingHistory: { type: Boolean, default: false },
  showEmptyState: { type: Boolean, default: true },
  emptyStateText: { type: String, default: '' },
  compact: { type: Boolean, default: false },  // compact mode for recap chat
});

const emit = defineEmits(['scroll', 'load-more']);

// Rendering helpers are still injected from store (they are pure functions, independent of data source)
const store = inject('store');
const {
  t, getRenderedContent, getToolSummary, isPrevAssistant,
  toggleContextSummary, pendingPlanMode, formatTimestamp,
  copyMessage, toggleTool, agentName, workDir,
} = store;
</script>

<template>
  <div :class="['message-list', { compact }]" @scroll="emit('scroll', $event)">
    <div class="message-list-inner">
      <!-- Empty state (optional) -->
      <slot name="empty" v-if="messages.length === 0 && showEmptyState">
        <div class="empty-state">
          <!-- default or custom empty state -->
        </div>
      </slot>

      <!-- Loading history -->
      <div v-if="loadingHistory" class="history-loading">...</div>

      <!-- Load more -->
      <div v-if="hasMoreMessages" class="load-more-wrapper">
        <button class="load-more-btn" @click="emit('load-more')">{{ t('chat.loadEarlier') }}</button>
      </div>

      <!-- Message loop (identical to current ChatView rendering) -->
      <div v-for="(msg, msgIdx) in visibleMessages" :key="msg.id"
           :class="['message', 'message-' + msg.role]">
        <!-- ... all message role rendering templates, identical to current ChatView ... -->
      </div>

      <!-- Typing indicator -->
      <div v-if="isProcessing && !hasStreamingMessage" class="typing-indicator">
        <span></span><span></span><span></span>
      </div>
    </div>
  </div>
</template>
```

#### 4b. Refactor `ChatView.vue`

`ChatView.vue` becomes a thin wrapper using `MessageList`:

```vue
<template>
  <template v-if="viewMode === 'chat' && currentView === 'chat'">
    <MessageList
      :messages="messages"
      :visible-messages="visibleMessages"
      :has-more-messages="hasMoreMessages"
      :is-processing="isProcessing"
      :has-streaming-message="hasStreamingMessage"
      :loading-history="loadingHistory"
      @scroll="onMessageListScroll"
      @load-more="loadMoreMessages"
    />
  </template>
</template>
```

#### 4c. Use `MessageList` in RecapDetail

RecapDetail uses the same `MessageList` to render recap chat messages, passing in the recap conversation's message array.

**Change scope:**
| File | Change |
|------|--------|
| `server/web/src/components/MessageList.vue` | **New**, extracted from ChatView for message rendering |
| `server/web/src/components/ChatView.vue` | Refactored to a thin wrapper around MessageList |

### Phase 5: RecapDetail Chat Integration

**File:** `server/web/src/components/RecapDetail.vue`

#### 5a. Layout Redesign

```
┌──────────────────────────────────────┐
│  [← Back]                            │
│                                      │
│  Detail Content                      │   ← collapsible
│  (header, for-you, tldr, sections)   │
│                                      │
│  ──── Ask about this meeting ─────   │   ← divider/button
│                                      │
│  Chat Messages (MessageList)         │   ← reuses MessageList
│  ...                                 │
│                                      │
│  ┌──────────────────────────────┐    │
│  │  Input Box                    │    │   ← simplified ChatInput
│  └──────────────────────────────┘    │
└──────────────────────────────────────┘
```

#### 5b. Conversation Switching Strategy

When entering RecapDetail:
1. Save the current `currentConversationId` to a temporary variable
2. Call `switchConversation('recap-chat-{recapId}')` to switch into the recap conversation
3. At this point, the store's `messages`, `isProcessing`, etc. all point to the recap chat's state
4. `MessageList` and the input box directly use the store's data

When exiting RecapDetail (clicking Back):
1. Call `switchConversation(savedConversationId)` to switch back to the main conversation

This achieves **zero data source redirection** — the store's reactive state IS the current recap chat's state.

#### 5c. Input Box

Options:
- **Option A: Reuse ChatInput.vue** — Modify its `v-if` condition to `currentView === 'chat' || currentView === 'recap-detail'`. Pros: full reuse including attachments, slash commands. Cons: recap chat may not need plan mode / brain mode toggles.
- **Option B: Simplified input box** — Inline a simple textarea + send button within RecapDetail. Pros: clean, no extra buttons. Cons: can't reuse attachments, etc.

**Recommended: Option A** — just modify the `v-if`; unnecessary buttons can be hidden via prop or `currentView` condition.

#### 5d. First Chat Onboarding

When the recap chat has no message history, show a guidance state:

```
  ─── Ask about this meeting ───

  💬 Ask anything about this meeting recap
     e.g., "What were the main blockers discussed?"

  [input box]
```

**Change scope:**
| File | Change |
|------|--------|
| `server/web/src/components/RecapDetail.vue` | Layout redesign: detail + divider + chat + input, conversation switching |
| `server/web/src/components/ChatInput.vue` | Extend `v-if` condition, hide plan/brain buttons in recap-detail mode |
| `server/web/src/css/recap-feed.css` | Split layout and chat section styles |

### Phase 6: Agent-side — recapId Passing and Persistence

**File:** `agent/src/connection.ts`

Extend the chat handler: if the payload includes `recapId`, persist the mapping when `session_started` is received.

```typescript
case 'chat': {
  const chatConvId = msg.conversationId;
  const recapId = msg.recapId;      // ← new
  // ... existing logic ...
  claudeHandleChat(chatConvId, prompt, workDir, chatOptions, files);

  // Store recapId, write to metadata when session_started fires
  if (recapId && chatConvId) {
    pendingRecapIds.set(chatConvId, recapId);
  }
  break;
}
```

In `claude.ts`'s session_started handler:

```typescript
// Existing: save brainMode
if (state.brainMode) {
  saveSessionMetadata(state.claudeSessionId, { brainMode: true });
}
// New: save recapId if pending
const recapId = pendingRecapIds.get(convId);
if (recapId) {
  saveSessionMetadata(state.claudeSessionId, { recapId });
  pendingRecapIds.delete(convId);
}
```

**Change scope:**
| File | Change |
|------|--------|
| `agent/src/connection.ts` | Extract `recapId` from chat payload, store in pending map |
| `agent/src/claude.ts` | Write `recapId` to metadata on session_started |

### Phase 7: Session Restore (Persistent Read)

When the user refreshes the page and re-enters the same recap detail:

1. On sidebar or Feed page load, `sessions_list` already includes each session's `recapId` (because `handleListSessions()` already merges `loadAllSessionMetadata()`)
2. Web client extracts sessions with `recapId` from `sessions_list`, building `recapChatSessionMap: { [recapId]: claudeSessionId }`
3. On entering RecapDetail, check `recapChatSessionMap[recapId]`:
   - **Has value:** First `switchConversation('recap-chat-{recapId}')`, then send `resume_conversation` to restore history
   - **No value:** Empty chat, show guidance state

```javascript
function enterRecapChat(recapId) {
  const convId = `recap-chat-${recapId}`;
  switchConversation(convId);

  // If conversationCache is empty (after refresh), try to restore from persistence
  if (messages.value.length === 0 && recapChatSessionMap.value[recapId]) {
    const claudeSessionId = recapChatSessionMap.value[recapId];
    wsSend({
      type: 'resume_conversation',
      claudeSessionId,
      conversationId: convId,
    });
  }
}
```

**Change scope:**
| File | Change |
|------|--------|
| `server/web/src/modules/recap.js` | Add restore logic to `enterRecapChat` |
| `server/web/src/modules/handlers/session-handler.js` | Call `recap.updateRecapChatSessions()` in `sessions_list` handler |

### Phase 8: Feed Sidebar — Chat History List

Show a list of user chat sessions with Recaps (and future Briefings) in the Feed mode sidebar, supporting click-to-navigate, delete, and rename.

#### 8a. Data Source

**No new WebSocket message types needed.** All data already exists in the `sessions_list` response:

```
sessions_list (agent → web)
  → historySessions: [ { sessionId, title, lastModified, recapId?, brainMode?, ... }, ... ]
  → filter: recapChatSessions = historySessions.filter(s => s.recapId)
  → cross-ref feedEntries: match by recapId → get meeting_name, date, meeting_type for display
```

**Session title strategy:**
- Priority: custom-title (user-renamed title)
- Fallback: cross-ref `feedEntries` by `recapId` to get `meeting_name`
- Last resort: session.title (auto-generated from first message)

```javascript
// New computed in recap.js
const recapChatSessions = computed(() => {
  const feedMap = {};
  for (const entry of feedEntries.value) {
    feedMap[entry.recap_id] = entry;
  }

  return historySessions.value
    .filter(s => s.recapId)
    .map(s => {
      const feedEntry = feedMap[s.recapId];
      return {
        ...s,
        displayTitle: s.customTitle || feedEntry?.meeting_name || s.title,
        meetingDate: feedEntry?.date_local,
        meetingType: feedEntry?.meeting_type,
        sidecarPath: feedEntry?.sidecar_path,   // used to load detail when clicked
      };
    })
    .sort((a, b) => b.lastModified - a.lastModified);
});
```

**Briefing extension reserved:** Future Briefing chats will use the same pattern — session metadata with `briefingId`, `sessions_list` returns the field similarly. Sidebar groups by type.

#### 8b. UI Component Design

**New `RecapChatHistory.vue`** (does not reuse SessionList.vue — it is deeply coupled with the main chat and has a different display format)

```
Feed Sidebar layout:
┌──────────────────────────┐
│  [Recaps] [Briefings]    │  ← existing nav buttons
├──────────────────────────┤
│  Chat History            │  ← section title
│                          │
│  ┌────────────────────┐  │
│  │ 🧠 Sprint Planning  │  │  ← chat session item
│  │ Mar 21 · Recap      │  │     meeting_name + date + type badge
│  │           [✏️] [🗑]  │  │     rename + delete buttons (shown on hover)
│  └────────────────────┘  │
│  ┌────────────────────┐  │
│  │ 🧠 Design Review    │  │
│  │ Mar 20 · Recap      │  │
│  │           [✏️] [🗑]  │  │
│  └────────────────────┘  │
│                          │
│  (No briefing chats yet) │  ← briefing placeholder
└──────────────────────────┘
```

Each session item displays:
- **Title row:** Brain icon + displayTitle (meeting_name or custom title)
- **Subtitle row:** date + type badge (Recap / Briefing)
- **Action buttons:** rename + delete (shown on hover, delete hidden for active session)
- **Active highlight:** currently viewed recap chat item is highlighted

#### 8c. Interaction Behavior

**Click session item → navigate to recap detail + restore chat:**

```javascript
function navigateToRecapChat(session) {
  // 1. Find feedEntry by recapId to get sidecarPath
  // 2. selectRecap(recapId, sidecarPath) — load detail
  // 3. currentView → 'recap-detail'
  // 4. enterRecapChat(recapId) — called directly (not relying on onMounted)
  //    → switchConversation('recap-chat-{recapId}')
  //    → detects existing claudeSessionId → resume_conversation to restore history
}
```

**Delete session:**

```javascript
function deleteRecapChatSession(session) {
  // Uses useConfirmDialog (follows project confirm dialog pattern)
  showConfirm({
    title: 'Delete Chat History',
    message: `Delete chat history for this meeting?`,
    itemName: session.displayTitle,
    warning: 'Chat history will be permanently deleted.',
    confirmText: 'Delete',
    onConfirm: () => {
      // 1. If currently viewing this recap chat → go back to feed first
      // 2. wsSend({ type: 'delete_session', sessionId: session.sessionId })
      // 3. delete recapChatSessionMap[session.recapId]
      // 4. Clear conversationCache['recap-chat-{recapId}']
    },
  });
}
```

Guard checks (reuses sidebar.js logic):
- Prevent deleting a session that is currently processing (check conversationCache's isProcessing state)
- After deletion, the `session_deleted` message automatically removes the entry from `historySessions`

**Rename session:**

```javascript
function renameRecapChatSession(session, newTitle) {
  // 1. wsSend({ type: 'rename_session', sessionId: session.sessionId, newTitle })
  // 2. session_renamed handler updates historySession's title
  // 3. recapChatSessions computed auto-recalculates (customTitle takes priority over meeting_name)
}
```

Inline edit mode: clicking the rename button turns the session item into an input field (similar to SessionList.vue's rename interaction).

#### 8d. Data Dependencies and Timing

```
Page load / Feed mode activation
  → loadFeed() — load feedEntries (recap list)
  → wsSend({ type: 'list_sessions' }) — trigger session list refresh
  → sessions_list handler:
      → historySessions.value = sessions
      → updateRecapChatSessions(sessions) — update recapChatSessionMap
  → recapChatSessions computed auto-calculates (cross-ref feedEntries + historySessions)
  → RecapChatHistory.vue renders the list
```

**Key point:** `list_sessions` and `list_recaps` are two independent requests. Both must complete for correct cross-referencing. In practice, no strict ordering is needed — `recapChatSessions` is a computed property, and any data source update triggers recalculation.

#### 8e. Sidebar.vue Integration

```vue
<!-- Replace existing feed-sidebar area -->
<div v-if="viewMode === 'feed'" class="feed-sidebar">
  <div class="feed-sidebar-nav">
    <button class="feed-sidebar-btn" :class="{ active: ... }">Recaps</button>
    <button class="feed-sidebar-btn disabled" disabled>Briefings</button>
  </div>
  <RecapChatHistory />   <!-- New: chat history list -->
</div>
```

#### 8f. Change Scope

| File | Change | Risk |
|------|--------|------|
| `server/web/src/components/RecapChatHistory.vue` | **New**, chat history list component for Feed sidebar | Low: new component |
| `server/web/src/modules/recap.js` | Add `recapChatSessions` computed, `navigateToRecapChat()`, `deleteRecapChatSession()`, `renameRecapChatSession()` | Medium: new logic |
| `server/web/src/components/Sidebar.vue` | Add `RecapChatHistory` to feed-sidebar area | Low: template change |
| `server/web/src/css/sidebar.css` or `recap-feed.css` | Chat history list styles | Low: pure styling |

**Files that do NOT need changes:**
- `agent/src/` — Agent already has full delete/rename/session-metadata capabilities
- `server/src/` — Server is a transparent relay
- `SessionList.vue` — Main chat session list is unaffected
- `session-handler.js` — `session_deleted` / `session_renamed` handlers are already generic

---

## Change Summary

### New Files

| File | Description |
|------|-------------|
| `server/web/src/components/MessageList.vue` | Reusable message list rendering component, extracted from ChatView |

### Modified Files

| File | Change Description | Risk |
|------|-------------------|------|
| `agent/src/session-metadata.ts` | Add `recapId` field to `SessionMetadata` | Low: pure addition, backward compatible |
| `agent/src/connection.ts` | Chat handler extracts `recapId`, stores in pending map | Low: new field, doesn't affect existing logic |
| `agent/src/claude.ts` | Write `recapId` to metadata on session_started | Low: conditional write, only triggered by recap chat |
| `server/web/src/modules/recap.js` | Add chat state, context builder, session map, enter/exit | Medium: core new logic |
| `server/web/src/components/RecapDetail.vue` | Layout redesign: detail + divider + chat + input | Medium: template refactor |
| `server/web/src/components/ChatView.vue` | Refactored to thin wrapper around MessageList | Medium: must ensure no regression in existing chat |
| `server/web/src/components/ChatInput.vue` | Extend `v-if` condition, hide plan/brain buttons in recap-detail mode | Low: condition change |
| `server/web/src/modules/handlers/session-handler.js` | Call `updateRecapChatSessions()` in `sessions_list` handler | Low: pure addition |
| `server/web/src/css/recap-feed.css` | Split layout and chat section styles | Low: pure styling |

### Files That Do NOT Need Changes

| File | Reason |
|------|--------|
| `server/src/` (server) | Transparent relay, no need to be aware of recap chat |
| `agent/src/history.ts` | Session history reading is already generic |
| `modules/streaming.js` | Conversation-agnostic, directly reusable |
| `modules/handlers/claude-output-handler.js` | conversationId routing is already generic |
| `modules/connection.js` | Already has `recap` getter in handlerDeps |

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Extracting MessageList from ChatView may introduce regressions | Medium | Run unit + functional tests immediately after extraction; MessageList fully preserves original rendering logic |
| switchConversation toggling in recap detail may lose main conversation state | Medium | Save `previousConvId` before entering, restore on exit; add defensive checks |
| First message context too long | Low | Context builder applies length limits, omits overly long sections |
| recap chat conversationId format conflicts | Low | Uses `recap-chat-` prefix, does not conflict with UUID-format regular conversations |
| Multiple tabs opening the same recap's chat | Low | No special handling; each tab sends messages independently, agent routes by conversationId |

---

## Implementation Order

1. **Phase 1** — Session metadata extension (agent-side, minimal changes)
2. **Phase 6** — Agent-side recapId passing and persistence
3. **Phase 3** — Context builder (pure function, independently testable)
4. **Phase 4** — Extract MessageList + refactor ChatView
5. **Phase 2** — recap.js chat state extension
6. **Phase 5** — RecapDetail chat integration
7. **Phase 7** — Session restore
8. **Phase 8** — Feed sidebar chat history list (new RecapChatHistory.vue + integrate Sidebar.vue)

Run tests after each phase to ensure no regressions. Phase 4 (component refactor) carries the highest risk — all functional tests must pass before proceeding.
