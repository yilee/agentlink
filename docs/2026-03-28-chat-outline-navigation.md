# Chat Outline Navigation

**Date:** 2026-03-28
**Status:** Draft

## Overview

Add a right-side outline panel to the chat view that lists all user messages (questions) as a quick-navigation table of contents. Clicking an item scrolls the chat to that message. A scroll-spy highlights the currently visible question.

## Motivation

Long conversations with many turns make it hard to find earlier questions. The outline provides at-a-glance navigation similar to a document's table of contents.

## UI Design

```
┌──────────┬────────────────────────────┬─────────────┐
│ Sidebar  │        Chat Area           │   Outline   │
│ (260px)  │                            │  (~220px)   │
│          │  ┌────────────────────┐    │             │
│          │  │ 👤 First question  │◄───│  Q1: First  │
│          │  │ 🤖 Answer...      │    │  Q2: Second │
│          │  │ 👤 Second question │◄───│ ● Q3: Third │ ← active
│          │  │ 🤖 Answer...      │    │  Q4: Fourth │
│          │  └────────────────────┘    │             │
└──────────┴────────────────────────────┴─────────────┘
```

### Panel Appearance

- **Position:** Right side of `.main-body`, after `.chat-area`, before `PreviewPanel`
- **Width:** 220px default, resizable via drag handle (same pattern as FilePanel/PreviewPanel)
- **Default state:** Closed (opt-in)

### Toggle: Floating Button in Chat Area

Outline 的打开/关闭通过聊天区右下角的悬浮按钮触发，与已有的 scroll-to-bottom 按钮纵向堆叠：

```
          Chat Area                    │
                                       │
    ┌─────────────────────┐            │
    │  Messages...        │        [≡] │ ← outline toggle (上)
    │                     │        [↓] │ ← scroll-to-bottom (下，已有)
    └─────────────────────┘            │
    ┌─────────────────────┐            │
    │  ChatInput          │            │
    └─────────────────────┘            │
```

- **按钮位置:** `.chat-area` 右下角，`position: absolute`，在 scroll-to-bottom 按钮正上方
- **图标:** 列表/大纲图标 (≡ 或类似)
- **状态反馈:** 面板打开时按钮高亮（accent 背景色），关闭时普通样式
- **面板内关闭:** 面板标题栏右侧有 `[×]` 关闭按钮（与悬浮按钮功能一致）
- **快捷键:** `Ctrl+Shift+O` 作为辅助方式

### Outline Item

Each item shows:
- **Index number** (Q1, Q2, ...) — sequential count of user messages
- **Truncated text** — first ~60 characters of the user message, ellipsis if longer
- **Active indicator** — highlighted background + left accent border for the message currently in viewport

```
┌─────────────────────────┐
│ Outline            [×]  │  ← header with close button
├─────────────────────────┤
│  Q1  Fix the login bug  │
│  Q2  Add dark mode to   │
│▌ Q3  How does the auth  │  ← active item (left border accent)
│  Q4  Can you refactor   │
│  Q5  Run the tests and  │
└─────────────────────────┘
```

### Mobile

Panel hidden.悬浮按钮保留，点击后以 modal overlay / bottom sheet 形式弹出 outline 列表。

## Technical Design

### Data Flow

```
messages (ref, full array)
  → filter role === 'user'
  → map to { index, msgId, msgIdx, text (truncated) }
  → render in ChatOutline.vue

Click item → scrollToMessage(msgIdx)
Scroll chat → IntersectionObserver updates activeIndex
```

### Key Insight: All Messages Are In Memory

The chat uses client-side pagination: `messages` ref holds the **complete** array; `visibleMessages` is just `messages.slice(-visibleLimit)`. "Load More" increments `visibleLimit` by 50 — no network request. So the outline can always access all user messages from the full `messages` array, even those not yet rendered.

### New Files

| File | Purpose |
|------|---------|
| `components/ChatOutline.vue` | Outline panel component |
| `css/chat-outline.css` | Panel styles |

### Modified Files

| File | Change |
|------|--------|
| `App.vue` | Add `<ChatOutline />` to `.main-body`, add toggle state |
| `store.js` | Add `outlineOpen` ref, `scrollToMessage()` function, `toggleOutline()` |
| `components/MessageList.vue` | Add `data-msg-id` attribute to message elements for scroll targeting |
| `components/ChatView.vue` | Add outline floating toggle button (positioned above scroll-to-bottom) |
| `css/base.css` | Outline panel layout styles (or in `chat-outline.css`) |
| `public/locales/en.json` | Add `outline.*` i18n keys |

### Implementation Details

#### 1. `scrollToMessage(msgIdx)` in store.js

```javascript
function scrollToMessage(msgIdx) {
  // Ensure the target message is within the rendered range
  const needed = messages.value.length - msgIdx;
  if (needed > visibleLimit.value) {
    visibleLimit.value = needed;
  }

  nextTick(() => {
    const el = document.querySelector(`[data-msg-id="${messages.value[msgIdx].id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Brief highlight flash on the target message
      el.classList.add('outline-highlight');
      setTimeout(() => el.classList.remove('outline-highlight'), 1500);
    }
  });
}
```

Key points:
- Expanding `visibleLimit` is O(1) — Vue just re-computes the slice, renders more DOM nodes
- No network requests needed — all data already in `messages` ref
- After expanding, `visibleLimit` stays at the new value (no re-collapsing)

#### 2. Scroll-Spy via IntersectionObserver

In `ChatOutline.vue`:

```javascript
// Observe all rendered user-message elements
const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      activeId.value = entry.target.dataset.msgId;
    }
  }
}, {
  root: document.querySelector('.message-list'),
  rootMargin: '-10% 0px -70% 0px',  // top 20% of viewport = "active"
});

// Watch visibleMessages for changes, re-observe new user message elements
watch(visibleMessages, () => {
  nextTick(() => {
    observer.disconnect();
    document.querySelectorAll('.message-user[data-msg-id]').forEach(el => {
      observer.observe(el);
    });
  });
});
```

The `rootMargin` bias means the question closest to the top ~20% of the chat viewport is considered "active".

#### 3. MessageList.vue Change

Add `data-msg-id` to each message wrapper:

```vue
<!-- Before -->
<div v-for="(msg, msgIdx) in visibleMessages" :key="msg.id"
     :class="['message', 'message-' + msg.role]">

<!-- After -->
<div v-for="(msg, msgIdx) in visibleMessages" :key="msg.id"
     :class="['message', 'message-' + msg.role]"
     :data-msg-id="msg.id">
```

#### 4. App.vue Layout

```vue
<div class="main-body">
  <Sidebar />
  <FilePanel />
  <GitPanel />
  <div class="chat-area">
    ...
    <!-- Floating toggle button, positioned above scroll-to-bottom -->
    <button class="outline-toggle-btn" @click="toggleOutline">≡</button>
    <ChatInput />
  </div>
  <ChatOutline />       <!-- NEW: between chat-area and PreviewPanel -->
  <PreviewPanel />
</div>
```

The floating button uses `position: absolute` within `.chat-area` (which is `position: relative`). Stacks vertically above the existing scroll-to-bottom button:

```css
.outline-toggle-btn {
  position: absolute;
  right: 1.5rem;
  bottom: 7rem;        /* above scroll-to-bottom (~5rem) and input */
  z-index: 10;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  /* accent background when outline is open */
}
```

The outline panel itself uses the same flexbox pattern as other panels: `flex-shrink: 0`, fixed width, `border-left`.

#### 5. i18n Keys

```json
{
  "outline.title": "Outline",
  "outline.close": "Close outline",
  "outline.toggle": "Toggle outline",
  "outline.empty": "No questions yet"
}
```

### Panel Coexistence

- Outline and PreviewPanel can coexist (both visible simultaneously)
- On narrow screens, chat-area `flex: 1` compresses naturally; below a threshold (~600px chat width), outline auto-hides
- Outline state persists per-session (saved/restored in `switchConversation()`)

### Keyboard Shortcut

`Ctrl+Shift+O` 作为辅助 toggle 方式。Register in `App.vue` via `@keydown` handler on the document.

## Edge Cases

| Case | Handling |
|------|----------|
| Empty conversation | Show "No questions yet" placeholder |
| Single user message | Show outline with one item |
| Very long user message | Truncate to 60 chars + ellipsis |
| Message with only attachments | Show "[Attachment]" as text |
| Rapid scroll | IntersectionObserver debounces naturally |
| Conversation switch | Save/restore `outlineOpen` state per conversation |
| User message with newlines | Replace with spaces before truncating |

## Out of Scope

- Assistant message navigation (only user questions)
- Search/filter within the outline
- Drag-to-reorder or collapsible sections
- Outline for non-chat views (recap, briefing, devops, etc.)
