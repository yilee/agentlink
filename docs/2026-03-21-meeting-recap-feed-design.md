# Meeting Recap Feed — Design Document

**Date:** 2026-03-21
**Author:** Kailun Shi
**Status:** Draft

## 1. Overview

Add a **Meeting Recap Feed** to the AgentLink web UI. Brain's `meeting-recap` skill produces structured recap data (JSON sidecar + YAML index) in the Brain Home directory. AgentLink reads these files through the agent and renders them as an interactive feed with detail views and contextual chat.

**Scope (Phase 1):** Recaps feed only. Briefings feed deferred until schema is available.

### Data Flow

```
Brain (background)                    Agent                         Web UI
─────────────────                    ─────                         ──────
meeting-recap skill                     │                             │
  → recap_index.yaml                    │  ◄── list_recaps ────────  │  (user opens Recaps feed)
  → sidecar.json (per meeting)          │  ──► recaps_list ────────► │  (render feed cards)
  → recap.md + SharePoint link          │                             │
                                        │  ◄── get_recap_detail ───  │  (user clicks a card)
                                        │  ──► recap_detail ───────► │  (render detail view)
                                        │                             │
                                        │  ◄── chat (with context) ─ │  (user asks a question)
                                        │  ──► claude_output ──────► │  (contextual answer)
```

## 2. Architecture Constraints

### 2.1 Brain Mode Isolation

Brain features are only available when the URL matches `/ms/:sessionId`. The feature gate is evaluated **once** at initialization and propagated via reactive state — no scattered `if (brainMode)` checks.

**Pattern:**

```
URL /ms/:sessionId
  → store.brainMode = true   (set once at init)
  → Sidebar renders <FeedNav> component (only exists in Brain mode)
  → Right panel uses <component :is="currentView"> dynamic switching
  → recap module only created when brainMode=true
  → recap WS handlers only registered when brainMode=true
```

**Where `brainMode` appears in code (exhaustive list):**

| Location | Purpose |
|----------|---------|
| `store.js` — init | Set `brainMode` from URL pattern |
| `store.js` — module creation | Conditionally create recap module |
| `connection.js` — handler registration | Conditionally register recap handlers |
| `Sidebar.vue` — template | Conditionally render `<FeedNav>` slot |

Everywhere else, components exist or don't exist — they never check `brainMode` internally.

### 2.2 Modular File Structure

New feature = new files. Existing files only get minimal wiring (imports + registration).

```
server/web/src/
├── components/
│   ├── FeedNav.vue              # Feed switch buttons (Recaps / future Briefings)
│   ├── RecapFeed.vue            # Feed grid container with date grouping
│   ├── RecapCard.vue            # Single feed card
│   ├── RecapDetail.vue          # Detail view container
│   ├── RecapForYou.vue          # 📌 For You section
│   ├── RecapHookSection.vue     # Generic hook section renderer (type-adaptive)
│   └── RecapSummaryBar.vue      # Collapsed summary when chatting
├── modules/
│   ├── recap.js                 # Recap state management (feed data, selection, loading)
│   └── handlers/
│       └── recap-handler.js     # WebSocket message handlers for recap messages
├── css/
│   ├── recap-feed.css           # Feed grid and card styles
│   └── recap-detail.css         # Detail view styles
```

**Agent side:**

```
agent/src/
├── recap.ts                     # Read recap_index.yaml + sidecar JSON from Brain Home
```

**Changes to existing files (minimal wiring only):**

| File | Change |
|------|--------|
| `store.js` | Add `brainMode` ref, conditionally create recap module |
| `connection.js` | Conditionally register recap handler |
| `Sidebar.vue` | Add `<FeedNav>` slot above chat history |
| `App.vue` | Add recap module to provide/inject |
| `agent/src/connection.ts` | Route `list_recaps` / `get_recap_detail` to recap module |

## 3. WebSocket Protocol

### 3.1 New Message Types

**Web → Agent:**

| Type | Fields | Purpose |
|------|--------|---------|
| `list_recaps` | `brainHome?: string` | Request recap index |
| `get_recap_detail` | `recapId: string`, `sidecarPath: string` | Request full sidecar JSON |

**Agent → Web:**

| Type | Fields | Purpose |
|------|--------|---------|
| `recaps_list` | `recaps: IndexEntry[]`, `error?: string` | Feed card data |
| `recap_detail` | `recapId: string`, `detail: SidecarJSON`, `error?: string` | Full sidecar for detail view |

### 3.2 Data Types

```typescript
// From recap_index.yaml — used for feed cards
interface IndexEntry {
  recap_id: string;
  meeting_id: string;
  meeting_name: string;
  series_name: string;
  date_utc: string;           // ISO 8601
  date_local: string;         // ISO 8601 with timezone offset
  meeting_type: string;       // general_sync | strategy_architecture | standup | brainstorm | kickoff | post_mortem
  project: string | null;
  for_you_count: number;
  tldr_snippet: string;
  sidecar_path: string;       // relative to brain_home
  recap_path: string;         // relative to brain_home
  sharing_link: string | null;
}

// Full sidecar JSON — used for detail view
// Schema: meeting-recap.v1 (see recap-sidecar-schema.md)
interface SidecarJSON {
  schema_version: string;
  meta: { ... };              // meeting metadata
  feed: { ... };              // feed-level display data
  detail: {
    tldr: string;
    for_you: ForYouItem[];
    hook_sections: HookSection[];
    decisions_count: number;
    action_items_count: number;
    open_items_count: number;
  };
  decisions: Decision[];
  action_items: ActionItem[];
  open_items: OpenItem[];
}
```

## 4. Agent Side Implementation

### 4.1 `agent/src/recap.ts`

New module with two functions:

```typescript
/**
 * Read recap_index.yaml from Brain Home, parse YAML, return entries.
 * Brain Home path: ~/BrainData
 */
export async function listRecaps(brainHome: string): Promise<IndexEntry[]>

/**
 * Read a sidecar JSON file given its path relative to brainHome.
 */
export async function getRecapDetail(brainHome: string, sidecarPath: string): Promise<SidecarJSON>
```

**YAML parsing:** Use `js-yaml` package (lightweight, well-maintained). Add to agent dependencies.

**Path resolution:** `sidecar_path` in the index is relative to `brain_home`. Agent resolves it as:
```
path.join(brainHome, entry.sidecar_path)
```

### 4.2 `agent/src/connection.ts` Changes

Add message routing in the existing message handler switch:

```typescript
case 'list_recaps':
  const recaps = await listRecaps(getBrainHome());
  send({ type: 'recaps_list', recaps });
  break;

case 'get_recap_detail':
  const detail = await getRecapDetail(getBrainHome(), msg.sidecarPath);
  send({ type: 'recap_detail', recapId: msg.recapId, detail });
  break;
```

**Brain Home resolution:** Use the same `brainHome` path that the existing Brain Home sidebar button uses. Expected: `~/BrainData` (i.e., `C:\Users\<user>\BrainData` on Windows).

## 5. Web UI Implementation

### 5.1 Navigation State

The right panel shows one of these views, tracked by `store.currentView`:

```
currentView: 'chat' | 'recap-feed' | 'recap-detail'
```

State transitions:

```
'chat' (default)
   │
   ├── click 📋 Recaps button ──► 'recap-feed'
   │                                    │
   │                                    ├── click a card ──► 'recap-detail'
   │                                    │                         │
   │                                    │                         ├── click ← Back ──► 'recap-feed'
   │                                    │                         │
   │                                    │                         └── start chatting ──► (stay in 'recap-detail',
   │                                    │                              detail collapses to summary bar,
   │                                    │                              chat appears below)
   │                                    │
   │                                    └── click 💬 Chats or a chat entry ──► 'chat'
   │
   └── click any chat entry ──► 'chat'
```

### 5.2 Sidebar: `FeedNav.vue`

Rendered above chat history list, only when `brainMode=true`.

```
┌─────────────────────┐
│  ┌────────┐         │
│  │📋Recaps│         │   ◄── active state: highlighted background
│  └────────┘         │
│  ┌────────┐         │
│  │📊Brief │         │   ◄── disabled/grayed (Phase 1: not available yet)
│  └────────┘         │
│                     │
│  ─── 💬 Chats ───  │
│  session list ...   │
└─────────────────────┘
```

- Click "Recaps" → `store.currentView = 'recap-feed'`, triggers `list_recaps` message
- Click "Briefings" → no-op in Phase 1 (grayed out with tooltip "Coming soon")
- Click any chat session → `store.currentView = 'chat'`, normal conversation switch

### 5.3 Feed View: `RecapFeed.vue`

```
┌───────────────────────────────────────────────────────────────────┐
│  📋 Meeting Recaps                              🔄 Refresh       │
│                                                                   │
│  ── Today ──────────────────────────────────────────────────      │
│                                                                   │
│  ┌─────────────────────────────┐  ┌─────────────────────────────┐│
│  │ Asset Quality V-Team        │  │ UI Shell vs. Brain Server   ││
│  │ 08:01 SGT · General Sync   │  │ Integration Strategy        ││
│  │ 📌 4                        │  │ 16:02 SGT · Strategy        ││
│  │                             │  │ 📌 4                        ││
│  │ Diversity excluded from     │  │                             ││
│  │ MVP pilot but required      │  │ Debated Brain as self-      ││
│  │ for GA. New AB infra        │  │ contained UI vs. skill-     ││
│  │ limitation threatens        │  │ based engine. Leaning       ││
│  │ backfill-first pilot.       │  │ toward skill abstraction.   ││
│  └─────────────────────────────┘  └─────────────────────────────┘│
│                                                                   │
│  ── Yesterday ──────────────────────────────────────────────      │
│  ... more cards ...                                               │
│                                                                   │
│  ── This Week ──────────────────────────────────────────────      │
│  ... more cards ...                                               │
│                                                                   │
│  ── Older ──────────────────────────────────────────────────      │
│  ... more cards ...                                               │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

**Card data mapping** (from `recap_index.yaml` entry):

| Card element | Source field |
|---|---|
| Title | `meeting_name` |
| Time + badge | Computed from `date_local` + `meeting_type` display name |
| 📌 count | `for_you_count` |
| TL;DR snippet | `tldr_snippet` (clamp to 3 lines CSS) |

**Date grouping** — Computed client-side from `date_local`:

```javascript
function getDateGroup(dateLocal) {
  const date = new Date(dateLocal);
  const now = new Date();
  if (isSameDay(date, now)) return 'Today';
  if (isSameDay(date, yesterday(now))) return 'Yesterday';
  if (isSameWeek(date, now)) return 'This Week';
  return 'Older';
}
```

**Grid layout:** CSS Grid, `grid-template-columns: repeat(auto-fill, minmax(320px, 1fr))`, gap 16px. Responsive: 1 column on mobile, 2-3 on desktop.

**Refresh button:** Sends `list_recaps` again. Optional: auto-refresh every 5 minutes (silent, no spinner unless empty).

### 5.4 Recap Card: `RecapCard.vue`

```
┌─────────────────────────────────┐
│  Asset Quality V-Team           │  ◄── meeting_name (bold, truncate 2 lines)
│  08:01 SGT · General Sync      │  ◄── time + type badge (muted text + colored pill)
│  📌 4                           │  ◄── for_you_count (accent color, only if > 0)
│                                 │
│  Diversity excluded from MVP    │  ◄── tldr_snippet (muted, clamp 3 lines)
│  pilot but required for GA.     │
│  New AB infra limitation...     │
└─────────────────────────────────┘
```

**Type badge colors:**

| Meeting type | Badge label | Color |
|---|---|---|
| `general_sync` | General Sync | Blue |
| `strategy_architecture` | Strategy | Purple |
| `standup` | Standup | Green |
| `brainstorm` | Brainstorm | Orange |
| `kickoff` | Kickoff | Teal |
| `post_mortem` | Post-Mortem | Red |

**Hover:** Subtle elevation/shadow. **Click:** Sends `get_recap_detail`, switches to detail view.

### 5.5 Detail View: `RecapDetail.vue`

```
┌───────────────────────────────────────────────────────────────────┐
│  ← Back                                                           │
│                                                                   │
│  📋 [Weekly call] Asset Quality V-Team                            │
│  Mar 20, 08:01 SGT · 55 min · General Sync                       │
│  Ad Strength / Performance Prediction                             │
│  Urooj, Wei Zhang, Judy, Sudhanshu, Bhairavi, Jaana, Qingjun,   │
│  Jason                                                            │
│                                                                   │
│  ┌─── 📌 FOR YOU ──────────────────────────────────────────────┐ │
│  │                                                              │ │
│  │  • AB infra can't hand-pick customers — pilot risk           │ │
│  │    Directly impacts pilot launch timeline and AB             │ │
│  │    experiment design you're tracking                         │ │
│  │                                                              │ │
│  │  • Tied flighting unresolved >1yr — cross-team gap           │ │
│  │    Cross-team coordination gap across your ads algorithm     │ │
│  │    and platform engineering portfolio                        │ │
│  │                                                              │ │
│  │  • Score recalculation needed — no UX plan yet               │ │
│  │    Affects pilot dates and go-to-market readiness            │ │
│  │                                                              │ │
│  │  • Diversity timeline pending — GA blocker                   │ │
│  │    GA blocker for performance prediction score               │ │
│  │                                                              │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  Diversity excluded from MVP pilot but required for GA. New AB    │
│  infra limitation (no hand-picked customers) threatens the        │
│  backfill-first pilot strategy. [full detail.tldr]                │
│                                                                   │
│  ─── 📋 Decisions (4) ────────────────────────────────────────    │
│                                                                   │
│  • [Decided] Pilot without diversity — Urooj Omair               │
│  • [Contested] AB infra vs hand-picked — Bhairavi                │
│  ··· and 2 more                                          [Show ▾] │
│                                                                   │
│  ─── 📋 Action Items (10) ────────────────────────────────────    │
│                                                                   │
│  • Judy Wu — Diversity model estimates — Due: Mar 25             │
│  • Bhairavi — Sync with Chandler on AB infra — Due: TBD         │
│  ··· and 8 more                                          [Show ▾] │
│                                                                   │
│  📎 Read full recap →                                             │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐    │
│  │ Ask about this meeting...                              ⏎  │    │
│  └───────────────────────────────────────────────────────────┘    │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

**Data mapping** (from sidecar JSON):

| Section | Source |
|---|---|
| Header | `meta.meeting_name`, `meta.occurred_at_local`, `meta.duration`, `meta.meeting_type` |
| Project | `meta.project` |
| Participants | `meta.participants` (show first names or truncate if >6) |
| For You | `detail.for_you[]` — show `text` + `reason` (smaller, muted) |
| TL;DR | `detail.tldr` |
| Hook sections | `detail.hook_sections[]` — rendered by `RecapHookSection.vue` |
| Full recap link | `meta.sharing_link` |

### 5.6 Hook Section Rendering: `RecapHookSection.vue`

A single generic component that renders any hook section type. No per-type component needed.

**Props:**

```javascript
props: {
  title: String,         // e.g. "Decisions", "Blockers", "Action Items"
  sectionType: String,   // e.g. "decisions", "blockers", "action_items"
  items: Array,          // [{text: "..."}]
  omittedCount: Number,  // from sidecar
  totalCount: Number     // for display in header
}
```

**Threshold rendering logic:**

```javascript
const THRESHOLD = 3;

const visibleItems = computed(() => {
  if (props.items.length <= THRESHOLD) return props.items;
  return props.items.slice(0, 2);
});

const hiddenCount = computed(() => {
  if (props.items.length <= THRESHOLD) return 0;
  return props.items.length - 2;
});

const expanded = ref(false); // "Show all" toggle
```

**Section icon mapping:**

| section_type | Icon | Display title |
|---|---|---|
| `decisions` | 📋 | Decisions / Emerging Direction |
| `action_items` | 📋 | Action Items |
| `blockers` | 🔴 | Blockers |
| `key_themes` | 💡 | Key Themes |
| `context` | 💡 | Context / Why It Matters |
| `vision` | 🎯 | Vision |
| `root_cause` | 🔍 | Root Cause |
| `preventative_actions` | 🛡️ | Preventative Actions |

### 5.7 Type-Adaptive Detail — Strategy Example

When displaying a **Strategy** meeting, the detail view differs:

```
┌───────────────────────────────────────────────────────────────────┐
│  ← Back                                                           │
│                                                                   │
│  📋 UI Shell vs. Brain Server Integration Strategy                │
│  Mar 20, 16:02 SGT · ~2 hrs · Strategy / Architecture            │
│  Project Brain / AI Tools                                         │
│  Song Li, Wei Ren, Ada Zhang, Kailun Shi, Yafeng Tan             │
│                                                                   │
│  ┌─── 📌 FOR YOU ──────────────────────────────────────────────┐ │
│  │                                                              │ │
│  │  • Skill abstraction emerging as preferred model             │ │
│  │    Directly shapes Brain's architecture and your adoption    │ │
│  │    strategy                                                  │ │
│  │                                                              │ │
│  │  • You: recap UX wireframes by Mar 22                        │ │
│  │    Your direct action item — Ada Zhang will align on Tuesday │ │
│  │                                                              │ │
│  │  • Wei Ren evaluating skill vs. server feasibility           │ │
│  │    Determines whether Brain can drop the custom UI           │ │
│  │                                                              │ │
│  │  • Two UIs coexist short-term — you drove this               │ │
│  │    Allows both teams to iterate independently                │ │
│  │                                                              │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  Debated Brain as self-contained UI vs. skill-based engine.       │
│  Leaning toward skill abstraction; Wei Ren evaluating             │
│  feasibility. No final decision reached.                          │
│                                                                   │
│  ─── 💡 Context / Why It Matters ─────────────────────────────    │
│                                                                   │
│  Brain is at an inflection point — self-contained product vs.     │
│  knowledge engine integrated into existing developer tools.       │
│  Determines investment + scalability.                             │
│                                                                   │
│  ─── 📋 Emerging Direction (5) ───────────────────────────────    │
│                                                                   │
│  • [Leaning] Expose capabilities as skills — Song Li             │
│  • [Contested] Brain needs own server — Wei Ren                  │
│  ··· and 3 more                                          [Show ▾] │
│                                                                   │
│  📎 Read full recap →                                             │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐    │
│  │ Ask about this meeting...                              ⏎  │    │
│  └───────────────────────────────────────────────────────────┘    │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

**Key difference:** The hook sections come from `detail.hook_sections[]` in the sidecar — the UI just iterates and renders them. The meeting type determines which sections Brain produces, not which sections the UI hard-codes. This means the UI is type-agnostic: it renders whatever hook sections the sidecar contains.

### 5.8 Contextual Chat (Phase 2)

When the user types in the chat input on the detail view:

```
┌───────────────────────────────────────────────────────────────────┐
│  ← Back                                                           │
│                                                                   │
│  📋 [Weekly call] Asset Quality V-Team                            │
│  Mar 20, 08:01 SGT · 55 min · General Sync                       │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ 📌 4 items  │  📋 4 decisions  │  📋 10 actions              │ │
│  └──────────────────────────────────────────────────────────────┘ │
│  ↑ collapsed summary bar — click to expand back to full detail    │
│                                                                   │
│  ─── Chat ────────────────────────────────────────────────────    │
│                                                                   │
│  👤  What's the AB infra situation?                               │
│                                                                   │
│  🤖  The new AB experimentation infrastructure only supports      │
│      **percentage-based randomization** — it cannot hand-pick     │
│      specific customers. This breaks the original pilot strategy  │
│      which relied on selecting ~500 hand-picked customers.        │
│                                                                   │
│      Bhairavi Kannan is syncing with Chandler to understand the   │
│      full limitations, and a meeting with Vijay and Urooj is      │
│      set for Monday to discuss alternative experiment designs.    │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐    │
│  │ Ask about this meeting...                              ⏎  │    │
│  └───────────────────────────────────────────────────────────┘    │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

**Implementation (Phase 2):**
- Chat message includes recap context: `{ type: 'chat', prompt: '...', recapContext: { recapId, sidecarPath, transcriptPath } }`
- Agent prepends recap + transcript content to the Claude prompt as system context
- Chat scoped to the selected recap — switching recaps clears chat
- `RecapSummaryBar.vue` shows collapsed counts, clickable to expand back to detail

## 6. Module: `modules/recap.js`

```javascript
export function createRecap({ wsSend, brainHome }) {
  // --- State ---
  const feedEntries = ref([]);      // IndexEntry[] from recap_index.yaml
  const selectedRecapId = ref(null);
  const selectedDetail = ref(null); // Full sidecar JSON
  const loading = ref(false);
  const detailLoading = ref(false);
  const chatMessages = ref([]);     // Phase 2: contextual chat
  const detailExpanded = ref(true); // true = full detail, false = summary bar

  // --- Computed ---
  const groupedEntries = computed(() => {
    // Group feedEntries by date: Today, Yesterday, This Week, Older
    return groupByDate(feedEntries.value);
  });

  // --- Actions ---
  function loadFeed() {
    loading.value = true;
    wsSend({ type: 'list_recaps' });
  }

  function selectRecap(recapId, sidecarPath) {
    selectedRecapId.value = recapId;
    detailLoading.value = true;
    detailExpanded.value = true;
    chatMessages.value = [];
    wsSend({ type: 'get_recap_detail', recapId, sidecarPath });
  }

  function goBackToFeed() {
    selectedRecapId.value = null;
    selectedDetail.value = null;
  }

  // --- Message handlers (called by recap-handler.js) ---
  function handleRecapsList(data) {
    feedEntries.value = data.recaps || [];
    loading.value = false;
  }

  function handleRecapDetail(data) {
    selectedDetail.value = data.detail;
    detailLoading.value = false;
  }

  return {
    // State
    feedEntries, selectedRecapId, selectedDetail, loading, detailLoading,
    groupedEntries, chatMessages, detailExpanded,
    // Actions
    loadFeed, selectRecap, goBackToFeed,
    // Handlers
    handleRecapsList, handleRecapDetail,
  };
}
```

## 7. Handler: `modules/handlers/recap-handler.js`

```javascript
export function createRecapHandlers(deps) {
  return {
    recaps_list: (msg) => {
      deps.recap.handleRecapsList(msg);
    },
    recap_detail: (msg) => {
      deps.recap.handleRecapDetail(msg);
    },
  };
}
```

Registered in `connection.js` only when `brainMode` is true.

## 8. Store Integration

In `store.js`, add minimal wiring:

```javascript
// In createStore():
const brainMode = ref(false); // set from URL pattern
const currentView = ref('chat'); // 'chat' | 'recap-feed' | 'recap-detail'

// Conditionally create recap module
let _recap = null;
if (brainMode.value) {
  _recap = createRecap({ wsSend, brainHome });
}

// Expose in return
return {
  ...existingStuff,
  brainMode,
  currentView,
  _recap,
};
```

In `App.vue`:

```javascript
if (store._recap) {
  provide('recap', store._recap);
}
```

In component templates, the right panel switches:

```vue
<template>
  <component :is="viewComponent" />
</template>

<script setup>
const viewComponent = computed(() => {
  switch (store.currentView) {
    case 'recap-feed': return RecapFeed;
    case 'recap-detail': return RecapDetail;
    default: return ChatView;
  }
});
</script>
```

## 9. Refresh Strategy

- **On feed open:** Auto-load index (send `list_recaps`)
- **Manual refresh:** 🔄 button in feed header
- **Auto-refresh:** Every 5 minutes when feed is visible (silent, no spinner unless feed is empty)
- **On detail open:** Load sidecar once, cache in `selectedDetail` until user navigates away

```javascript
// In recap.js
let refreshInterval = null;

function startAutoRefresh() {
  refreshInterval = setInterval(() => {
    if (!loading.value) loadFeed();
  }, 5 * 60 * 1000);
}

function stopAutoRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}
```

## 10. Phasing

### Phase 1 — Read-only Feed + Detail (Target: this sprint)

- Agent: `recap.ts` — read YAML index + JSON sidecar
- Web: `FeedNav`, `RecapFeed`, `RecapCard`, `RecapDetail`, `RecapForYou`, `RecapHookSection`
- Web: `modules/recap.js`, `handlers/recap-handler.js`
- Web: `css/recap-feed.css`, `css/recap-detail.css`
- Sidebar modification for feed nav
- Store + connection wiring with brain mode gate

**Deliverables:** User can open Recaps feed, see cards grouped by date, click into detail view with type-adaptive hook sections, click through to SharePoint.

### Phase 2 — Contextual Chat

- Chat input on detail view sends messages scoped to the selected recap
- Agent prepends recap + transcript as context to Claude
- Detail collapses to `RecapSummaryBar` when chatting
- `RecapSummaryBar.vue` component

**Deliverables:** User can ask questions about a specific meeting and get contextual answers.

### Phase 3 — Briefings Feed + Polish

- Briefings schema (from Brain team)
- `BriefingFeed.vue`, `BriefingCard.vue`, `BriefingDetail.vue`
- FeedNav tab switching between Recaps and Briefings
- Polish: animations, loading skeletons, empty states

## 11. Dependencies

| Package | Where | Purpose |
|---------|-------|---------|
| `js-yaml` | Agent | Parse `recap_index.yaml` |

No new web dependencies — all rendering uses existing Vue 3 + vanilla CSS.

## 12. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| YAML parsing adds dependency | Low | `js-yaml` is 50KB, well-maintained, no native deps |
| Brain Home path unknown | Low | Brain Home is `~/BrainData`; reuse existing sidebar button resolution |
| Large index file (hundreds of recaps) | Low | Unlikely near-term; add pagination if needed later |
| Contextual chat scope (Phase 2) | High | Defer to Phase 2; Phase 1 is static read-only |
| Sidebar refactor breaks existing functionality | Med | Minimal changes (add slot for FeedNav), thorough functional test coverage |

## 13. Testing Plan

**Unit tests** (`test/web/`):
- Date grouping logic
- Threshold/truncation logic for hook sections
- Meeting type → badge mapping

**Functional tests** (`test/functional/`):
- New test suite: `recap-feed.test.ts`
- Mock agent sends `recaps_list` → verify feed cards render
- Mock agent sends `recap_detail` → verify detail view renders with correct hook sections
- Verify type-adaptive rendering (General Sync vs Strategy show different sections)
- Verify threshold rule (4+ items show "and N more")
- Verify brain mode gate (non-brain-mode URL shows no feed nav)

**Manual E2E:**
- Add test cases to `docs/e2e-test-plan.md` for recap feed with real Brain data
