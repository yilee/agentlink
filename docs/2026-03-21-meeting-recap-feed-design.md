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
  → store.isMsRoute = true   (reactive ref used for conditional rendering)
  → viewMode extended: 'chat' | 'feed' | 'team' | 'loop' (Feed only available when isMsRoute)
  → Sidebar renders Chat/Feed segmented control (only when isMsRoute)
  → TopBar renders Feed button (only when isMsRoute)
  → Right panel uses viewMode + currentView for dynamic switching
  → recap module only created when brainMode=true
  → recap WS handlers only registered when brainMode=true
```

**Where `brainMode` / `isMsRoute` appears in code (exhaustive list):**

| Location | Purpose |
|----------|---------|
| `store.js` — init | Set `brainMode` and `isMsRoute` from URL pattern |
| `store.js` — module creation | Conditionally create recap module |
| `connection.js` — handler registration | Conditionally register recap handlers |
| `Sidebar.vue` — template | Show Chat/Feed segmented control; switch sidebar content |
| `TopBar.vue` — template | Conditionally render Feed button in tab bar |

Everywhere else, components exist or don't exist — they never check `brainMode` internally.

### 2.2 Modular File Structure

New feature = new files. Existing files only get minimal wiring (imports + registration).

```
server/web/src/
├── components/
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

> **Note:** `FeedNav.vue` was used in the initial prototype but has been **removed**. Its functionality (Recaps/Briefings buttons, Chats link) is now integrated directly into `Sidebar.vue` as part of the Feed sidebar mode.

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
| `Sidebar.vue` | Add Chat/Feed segmented control; render two sidebar modes (Chat / Feed) |
| `TopBar.vue` | Add Feed button to tab bar (only when `isMsRoute`) |
| `team.js` | Extend `viewMode` to include `'feed'` as fourth value |
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
  meeting_type: string;       // general_sync | strategy | standup | brainstorm | kickoff | post_mortem
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

The UI uses **two levels** of navigation state:

**Level 1: `viewMode`** (top-level mode, controls TopBar + sidebar rendering)

```
viewMode: 'chat' | 'feed' | 'team' | 'loop'
```

- Defined in `modules/team.js` — existing ref, extended with `'feed'`
- Controlled by: TopBar buttons (Chat / Feed / TEAM / LOOP) + Sidebar segmented control (Chat / Feed)
- `'feed'` is only available when `isMsRoute=true`
- When `viewMode` changes, the sidebar mode and right panel both switch

**Level 2: `currentView`** (sub-view within Feed mode, controls right panel content)

```
currentView: 'chat' | 'recap-feed' | 'recap-detail'
```

- Defined in `store.js`
- Only meaningful when `viewMode === 'feed'`
- Controls which component renders in the right panel

**State transitions:**

```
viewMode = 'chat' (default)
  → Sidebar: hostname, working dir, brain home, recent dirs, session list
  → Right panel: ChatView (normal chat)
  → TopBar: Chat button active

viewMode = 'feed'
  → Sidebar: hostname, segmented control, Recaps/Briefings buttons, (future: contextual chat history)
  → Right panel: depends on currentView
  → TopBar: Feed button active

  currentView = 'recap-feed' (default when entering feed mode)
     │
     ├── click a card ──► currentView = 'recap-detail'
     │                         │
     │                         ├── click ← Back ──► currentView = 'recap-feed'
     │                         │
     │                         └── start chatting ──► (stay in 'recap-detail',
     │                              detail collapses to summary bar,
     │                              chat appears below)
     │
     └── switch sidebar segmented control to Chat ──► viewMode = 'chat'

viewMode = 'team'
  → (existing behavior, unchanged)

viewMode = 'loop'
  → (existing behavior, unchanged)
```

**Switching to Feed mode:**

When `viewMode` changes to `'feed'`:
1. Set `currentView = 'recap-feed'`
2. Call `recap.loadFeed()` (send `list_recaps`)
3. Call `recap.startAutoRefresh()`

When `viewMode` changes away from `'feed'`:
1. Call `recap.stopAutoRefresh()`

### 5.2 Sidebar: Two-Mode Architecture

When `isMsRoute=true`, the sidebar has two completely independent modes controlled by a **segmented control** under the hostname. Switching modes replaces the entire sidebar content below the segmented control.

**Sidebar segmented control:**

```
┌─────────────────────┐
│  hostname            │
│  ┌──────┬──────┐    │
│  │ Chat │ Feed │    │   ◄── segmented control (pill-style toggle)
│  └──────┴──────┘    │       sets viewMode = 'chat' | 'feed'
│                     │
│  ... mode content   │
└─────────────────────┘
```

**Chat mode** (`viewMode === 'chat'`): Original sidebar, unchanged.

```
┌─────────────────────┐
│  hostname            │
│  [Chat] [Feed]       │
│─────────────────────│
│  Working Directory   │
│  Brain Home          │
│  Recent Directories  │
│  ─── Sessions ───   │
│  session list ...    │
└─────────────────────┘
```

**Feed mode** (`viewMode === 'feed'`): New sidebar content for Brain feeds.

```
┌─────────────────────┐
│  hostname            │
│  [Chat] [Feed]       │
│─────────────────────│
│  ┌────────────────┐ │
│  │ 📋 Recaps      │ │   ◄── active: highlighted background
│  └────────────────┘ │
│  ┌────────────────┐ │
│  │ 📊 Briefings   │ │   ◄── disabled/grayed (Phase 1: "Coming soon")
│  └────────────────┘ │
│                     │
│  ─── Chat History ──│   ◄── Phase 2+: contextual chat sessions (see §5.8)
│  (empty in Phase 1) │       stored under BrainHome/chat/meeting-recap/
│                     │
└─────────────────────┘
```

- Click "Recaps" → `currentView = 'recap-feed'`, triggers `list_recaps`
- Click "Briefings" → no-op in Phase 1 (grayed out with tooltip "Coming soon")
- "Chat History" section (Phase 2+): lists contextual chat sessions about recaps/briefings — **not** the same as workdir-based sessions in Chat mode

**TopBar Feed button:**

In addition to the sidebar segmented control, a **Feed button** is added to the TopBar's existing tab bar (Chat / TEAM / LOOP), visible only when `isMsRoute`:

```
┌──────────────────────────────────────────────┐
│  [ Chat ]  [ Feed ]  [ TEAM ]  [ LOOP ]     │
└──────────────────────────────────────────────┘
```

Both the TopBar Feed button and the sidebar segmented control are **synchronized** — clicking either one sets `viewMode = 'feed'` and updates both UI elements. This is achieved by both reading/writing the same `viewMode` ref.

**Implementation approach (Scheme A — Feed as 4th viewMode value):**

`viewMode` in `team.js` is extended from `'chat' | 'team' | 'loop'` to `'chat' | 'feed' | 'team' | 'loop'`. This is the simplest approach because:
- `viewMode` already controls TopBar highlighting and main content area switching
- Sidebar already reacts to `viewMode` for team/loop mode
- Adding `'feed'` as a peer value naturally extends both TopBar and sidebar behavior
- No new ref needed — just extend the existing one

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
| Time + badge | Computed from `date_local` + fallback badge map on `meeting_type` (detail view uses `feed.type_badge` instead) |
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

**Type badge display:**

For the **detail view**, use `feed.type_badge` from the sidecar JSON directly (e.g., `"Strategy / Architecture"`). Brain provides a display-ready string — no client-side mapping needed.

For **feed cards** (which only have the index entry, not the full sidecar), use a fallback map from `meeting_type`:

| `meeting_type` value | Fallback badge label | Color |
|---|---|---|
| `general_sync` | General Sync | Blue |
| `strategy` | Strategy | Purple |
| `standup` | Standup | Green |
| `brainstorm` | Brainstorm | Orange |
| `kickoff` | Kickoff | Teal |
| `post_mortem` | Post-Mortem | Red |

> **Note:** The real Brain skill uses `strategy` (not `strategy_architecture` from the earlier sample data). The fallback map should handle both values for forward compatibility, but `strategy` is the canonical value.

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
| Header | `meta.meeting_name`, `meta.occurred_at_local`, `meta.duration`, `feed.type_badge` (display-ready from Brain) |
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

The display title comes from the sidecar's `hook_sections[].title` field (e.g., Brain may use `"Emerging Directions"` instead of `"Decisions"` for Strategy meetings). The UI uses the sidecar title directly and only maps `section_type` to an icon:

| section_type | Icon |
|---|---|
| `decisions` | 📋 |
| `action_items` | 📋 |
| `blockers` | 🔴 |
| `key_themes` | 💡 |
| `context` | 💡 |
| `vision` | 🎯 |
| `root_cause` | 🔍 |
| `preventative_actions` | 🛡️ |

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

### 5.9 Contextual Chat Session Persistence (Phase 2+)

Contextual chat sessions (conversations about specific recaps or briefings) are stored **separately** from existing workdir-based Claude sessions. This is a key architectural distinction:

| | Workdir-based sessions (existing) | Contextual chat sessions (new) |
|---|---|---|
| **Storage** | `~/.claude/projects/<folder>/<sessionId>.jsonl` | `~/BrainHome/chat/meeting-recap/<sessionId>.jsonl` |
| **Shown in** | Sidebar Chat mode → session list | Sidebar Feed mode → "Chat History" section |
| **Scoped to** | Working directory | A specific recap or briefing |
| **Initial context** | User's first message | Recap summary + user's first question |
| **Claude session** | Standalone | May share Claude session with recap context prepended |

**Directory structure:**

```
~/BrainHome/
├── chat/
│   ├── meeting-recap/        # Contextual chats about meeting recaps
│   │   ├── <sessionId>.jsonl
│   │   └── ...
│   └── briefing/             # Contextual chats about briefings (Phase 3)
│       ├── <sessionId>.jsonl
│       └── ...
├── reports/
│   └── meeting-recap/        # Existing recap data (index + sidecars)
│       ├── recap_index.yaml
│       └── <meeting_folder>/
│           └── recap-<date>-<id>.json
```

**Flow:**

1. User opens a recap detail view and types a question
2. Agent creates a new session file under `~/BrainHome/chat/meeting-recap/`
3. Session initial content = recap summary (from sidecar `detail.tldr` + `detail.for_you`) + user's question
4. Agent forwards to Claude with recap + transcript as system context
5. Subsequent messages in the same session continue the conversation about that recap
6. Session persists — user can return to it from the Feed sidebar's "Chat History" list
7. Briefing contextual chats follow the same pattern under `~/BrainHome/chat/briefing/`

**Feed sidebar "Chat History" display:**

In Feed mode, the sidebar shows contextual chat sessions below the Recaps/Briefings buttons. Sessions are listed with:
- Recap/briefing title (from the session metadata)
- First user question (truncated)
- Last modified timestamp

Clicking a session reopens it with full conversation history, similar to how workdir sessions work in Chat mode.

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

### Phase 1a — Read-only Feed + Detail (Target: this sprint) ✅ In progress

- Agent: `recap.ts` — read YAML index + JSON sidecar
- Web: `RecapFeed`, `RecapCard`, `RecapDetail`, `RecapForYou`, `RecapHookSection`
- Web: `modules/recap.js`, `handlers/recap-handler.js`
- Web: `css/recap-feed.css`, `css/recap-detail.css`
- Store + connection wiring with brain mode gate

**Deliverables:** User can open Recaps feed, see cards grouped by date, click into detail view with type-adaptive hook sections, click through to SharePoint.

### Phase 1b — Sidebar Refactor (Immediate next)

- Remove `FeedNav.vue` — merge functionality into `Sidebar.vue`
- Add Chat/Feed segmented control to sidebar (under hostname, only when `isMsRoute`)
- Implement two sidebar modes: Chat mode (existing content) / Feed mode (Recaps, Briefings buttons)
- Extend `viewMode` in `team.js` to include `'feed'` as 4th value
- Add Feed button to `TopBar.vue` tab bar (synchronized with sidebar segmented control)
- Ensure switching between Chat/Feed modes preserves each mode's state

**Deliverables:** Clean navigation separation between Chat and Feed. Sidebar and TopBar synchronized. No interference between existing Claude chat sessions and Brain feed features.

### Phase 2 — Contextual Chat + Session Persistence

- Chat input on detail view sends messages scoped to the selected recap
- Agent prepends recap + transcript as context to Claude
- Detail collapses to `RecapSummaryBar` when chatting
- `RecapSummaryBar.vue` component
- **Session persistence:** Create contextual chat sessions under `~/BrainHome/chat/meeting-recap/`
- Store session metadata (recap title, first question, timestamps)
- Display contextual chat history in Feed sidebar's "Chat History" section
- Allow resuming previous contextual chat sessions

**Deliverables:** User can ask questions about a specific meeting and get contextual answers. Conversations persist and can be resumed from the Feed sidebar.

### Phase 3 — Briefings Feed + Polish

- Briefings schema (from Brain team)
- `BriefingFeed.vue`, `BriefingCard.vue`, `BriefingDetail.vue`
- Enable Briefings button in Feed sidebar mode
- Briefing contextual chats under `~/BrainHome/chat/briefing/`
- Polish: animations, loading skeletons, empty states

## 11. Dependencies

| Package | Where | Purpose |
|---------|-------|---------|
| `js-yaml` | Agent | Parse `recap_index.yaml` |

No new web dependencies — all rendering uses existing Vue 3 + vanilla CSS.

## 12. Real Data Validation (2026-03-22)

Ran the updated `meeting-recap` skill on the "UI Shell vs Brain Strategy" meeting (March 20). Validated real output against the documented schemas.

**Files generated:**
- `~/BrainData/reports/meeting-recap/recap_index.yaml` — 1 entry
- `~/BrainData/reports/meeting-recap/Discussion_UI_Shell_vs._Brain_Server_Integration_Strategy/recap-2026-03-20-meeting_20260320_080240_82728052.json` — full sidecar

**Index entry — schema match: YES**

All 12 fields present and correct. Notable real values:
- `meeting_type: strategy` (not `strategy_architecture` from earlier sample data)
- `project: null` (sample data had it populated — field is optional as expected)
- `sharing_link` populated with SharePoint URL (upload succeeded)

**Sidecar JSON — schema match: YES**

All top-level sections present: `schema_version`, `meta`, `feed`, `detail`, `decisions`, `action_items`, `open_items`.

Key observations from real data:
- `meta.timezone` = `"CST (UTC+8)"` — display string, not IANA zone ID. Fine for UI display.
- `meta.duration` = `"~2 hours"` — free-text, not a number. Display as-is.
- `meta.user_attended` = `true` — correctly detected.
- `feed.type_badge` = `"Strategy / Architecture"` — Brain provides display-ready badge text. UI should use this directly instead of maintaining a separate mapping. Updated design to use `feed.type_badge` for detail view.
- `feed.date_group` = `"This week"` — pre-computed by Brain but gets stale. Client-side computation is correct approach.
- `detail.hook_sections` — Strategy meeting produced `context` + `decisions` sections as expected.
- `detail.hook_sections[].title` = `"Emerging Directions"` (not generic `"Decisions"`). Brain provides context-appropriate titles per meeting. UI uses the sidecar title directly.
- `detail.for_you` — 3 items with `kind` ∈ {`stakeholder_decision`, `action`, `watch_item`}, each with `text` + `reason`. Matches schema.
- `decisions[]` — 5 entries, all `tag: "Leaning"`. Has `championed_by` arrays. `quote` populated on one entry (Chinese text from transcript). Match.
- `action_items[]` — 5 entries with `owner`, `action`, `due` (some null), `carried_over: false`. Match.
- `open_items[]` — 4 entries with `text`, `owner` (some null). Match.

**Design changes from validation:**
1. Updated `meeting_type` enum: `strategy` is canonical (not `strategy_architecture`). Fallback map handles both.
2. Detail view uses `feed.type_badge` for display instead of client-side mapping from `meeting_type`.
3. Hook section titles come from sidecar (`hook_sections[].title`), not hard-coded in UI. Client only maps `section_type` → icon.

## 13. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| YAML parsing adds dependency | Low | `js-yaml` is 50KB, well-maintained, no native deps |
| Brain Home path unknown | Low | Brain Home is `~/BrainData`; reuse existing sidebar button resolution |
| Large index file (hundreds of recaps) | Low | Unlikely near-term; add pagination if needed later |
| Contextual chat scope (Phase 2) | High | Defer to Phase 2; Phase 1 is static read-only |
| Sidebar refactor breaks existing functionality | Med | Two independent modes (Chat/Feed) — Chat mode is untouched, Feed mode is new code. Segmented control + viewMode keep them isolated. Thorough functional test coverage |
| Contextual chat session storage location | Low | `~/BrainHome/chat/` mirrors Brain's existing `~/BrainData/reports/` convention |

## 14. Testing Plan

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
