# Chat Search Feature Design

## Overview

Add search functionality at two levels:
1. **Sidebar session search** — Filter sessions in the Chat History list by title/preview
2. **In-conversation search** — Search within the current conversation's messages, integrated into the existing Outline panel

## 0. Search Module (`modules/search.js`)

All search logic lives in a dedicated module, following the existing factory pattern.

### Factory
```javascript
export function createSearch(deps) {
  // deps: { historySessions, groupedSessions, flatSessionItems, messages, t }
  // returns: { sessionSearchQuery, filteredFlatSessionItems, messageSearchQuery, messageSearchResults }
}
```

### Integration
- **store.js**: `const _search = createSearch({ historySessions, groupedSessions, flatSessionItems, messages, t })`, then `provide('search', store._search)`.
- **SessionList.vue**: `inject('search')` → uses `sessionSearchQuery`, `filteredFlatSessionItems`.
- **ChatOutline.vue**: `inject('search')` → uses `messageSearchQuery`, `messageSearchResults`.

### Session search logic (inside module)
- `sessionSearchQuery` — `ref('')`
- `filteredFlatSessionItems` — `computed()`: when query is empty, returns `flatSessionItems.value` as-is. When non-empty, filters `groupedSessions` entries by `title`/`preview` match (case-insensitive `includes()`), then regenerates flat items (header + sessions) from filtered groups, hiding empty groups.

### Message search logic (inside module)
- `messageSearchQuery` — `ref('')`
- `messageSearchResults` — `computed()`: when query is empty, returns `[]`. When non-empty, iterates `messages.value`, for each message whose `content` matches (case-insensitive `includes()`), extracts a snippet (keyword ± ~30 chars), records `{ role, msgIdx, msgId, snippet, matchStart }`.

## 1. Sidebar Session Search

### Behavior
- Add a search icon button next to the existing refresh button in the "Chat History" header
- Click → header row transforms into a search input (replaces "Chat History" label)
- Real-time filtering via `filteredFlatSessionItems` from search module (case-insensitive `includes()` on `title` + `preview`)
- When searching, date grouping (Today/Yesterday/etc.) is preserved — empty groups hidden
- Close button (×) or Esc → clears search, restores original header

### UI
```
Before click:
┌─────────────────────────────┐
│ CHAT HISTORY    [🔍] [↻] [v]│
└─────────────────────────────┘

After click:
┌─────────────────────────────┐
│ [🔍] Search sessions...  [×]│
└─────────────────────────────┘
```

### Implementation
- **SessionList.vue**: Add `sessionSearchOpen` local ref. Toggle between header and search input. Bind VList to `filteredFlatSessionItems` (from injected search module) instead of `flatSessionItems`.
- **sidebar.css**: Style the inline search input to match header dimensions.

## 2. In-Conversation Search (Outline Panel Enhancement)

### Behavior
- Outline panel gains a search input at the top (between header and body)
- **No input** → panel shows existing Outline view (user questions Q1, Q2, Q3...)
- **Has input** → panel switches to search results view:
  - Searches all messages (user + assistant) by case-insensitive substring match
  - Each result = one line: keyword highlighted (`<mark>`) with ~30 chars context on each side
  - Results show a role badge ("Q" for user, "A" for assistant) like outline's "Q1" index
  - Click result → `scrollToMessage(msgIdx)` + close panel

### UI
```
┌─ Outline ──────────── [×] ─┐
│ [🔍 Search messages...]     │
│─────────────────────────────│
│                             │
│ When no search query:       │
│   Q1  How do I deploy...    │
│   Q2  What about testing... │
│                             │
│ When searching "deploy":    │
│   Q  ...how do I **deploy** │
│   A  ...run npm **deploy**  │
│   A  ...**deploy** to prod  │
│                             │
└─────────────────────────────┘
```

### Implementation
- **ChatOutline.vue**:
  - `inject('search')` → uses `messageSearchQuery`, `messageSearchResults` from search module.
  - Template: add `<input v-model="messageSearchQuery">` between header and body. `v-if="messageSearchQuery"` switches between outline list and search results list.
  - Click handler calls `scrollToMessage(item.msgIdx)`.
  - Highlight rendering: split snippet text around match, wrap match in `<mark>`.

- **chat-outline.css**:
  - `.chat-outline-search`: search input styling (full-width, border-bottom)
  - `.chat-search-result`: result item styling (similar to `.chat-outline-item`)
  - `.chat-search-role`: role badge styling (similar to `.chat-outline-index`)
  - `mark` inside panel: highlight color using `var(--accent)` with low opacity background

### i18n Keys to Add
```json
{
  "outline.searchPlaceholder": "Search messages...",
  "outline.searchNoResults": "No matches found",
  "outline.searchResultCount": "{n} matches"
}
```

## Performance

Both searches operate on in-memory arrays:
- Sidebar: ~5-200 sessions, filtering `title` + `preview` strings → sub-millisecond
- In-conversation: typically ~50-500 messages, `includes()` on `content` strings → sub-millisecond
- No debouncing needed at these scales; filter on every keystroke for instant feedback

## Files Changed

| File | Change |
|------|--------|
| `modules/search.js` | **New** — search factory module with session + message search logic |
| `store.js` | Wire `createSearch(deps)`, expose via `provide('search', ...)` |
| `components/ChatOutline.vue` | Inject search module, add search input + search results template |
| `components/SessionList.vue` | Inject search module, add search icon button + search input |
| `css/chat-outline.css` | Search input, result item, highlight styles |
| `css/sidebar.css` | Inline search input styles |
| `public/locales/en.json` | Add outline search i18n keys |
| `public/locales/zh.json` | Add outline search i18n keys (Chinese) |
