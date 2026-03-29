# DevOps Board — Design Document

## Context

AgentLink integrates BrainData feeds into the web UI. Phase 1 shipped Meeting Recap, Phase 2 shipped Daily Briefing — both follow the same pattern: agent reads files from `~/BrainData/`, sends data via WebSocket, Vue renders card feed → detail → chat.

**Phase 4: DevOps Board** surfaces 54 Pull Requests and 18 Work Items from `~/BrainData/devops/`. Unlike the Inbox Dashboard (which would just be a worse Outlook), DevOps data has unique value:

1. **Cross-source context** — Each PR/WI shows where it was discussed in Teams/Email (ADO doesn't have this)
2. **Chat with Claude** — Ask questions about any PR/WI in the detail view
3. **Unified view** — PRs + WIs in one place, grouped by role

---

## UI Design

### Feed View — Pull Requests Tab

```
┌─────────────────────────────────────────────────────┐
│  DevOps Board                            🔄 Refresh │
│                                                     │
│  [ Pull Requests ]  [ Work Items ]    ← tab buttons │
│                                                     │
│  ── My PRs (3) ─────────────────────────────────── │
│  ┌─────────────────┐  ┌─────────────────┐          │
│  │ #6503730        │  │ #6517920        │          │
│  │ Eval Pipeline   │  │ EntityId Support│          │
│  │ ✅ Completed    │  │ ✅ Completed    │          │
│  │ AdsAppsService  │  │ AdsAppsService  │          │
│  │ 👤 3/3 approved │  │ 👤 2/3 approved │          │
│  │ 💬 5 mentions   │  │ 💬 12 mentions  │          │
│  └─────────────────┘  └─────────────────┘          │
│                                                     │
│  ── Reviewing (1) ──────────────────────────────── │
│  ┌─────────────────┐                               │
│  │ #6532478        │                               │
│  │ Account Diag    │                               │
│  │ 🔵 Active       │                               │
│  │ AdsAppsMT       │                               │
│  │ 👤 0/2 approved │                               │
│  │ 💬 3 mentions   │                               │
│  └─────────────────┘                               │
│                                                     │
│  ── Other (50) ────────────────────────────────── │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐  │
│  │ ...         │ │ ...         │ │ ...         │  │
│  └─────────────┘ └─────────────┘ └─────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Feed View — Work Items Tab

```
┌─────────────────────────────────────────────────────┐
│  [ Pull Requests ]  [ Work Items ]                  │
│                                                     │
│  ── Active (3) ────────────────────────────────── │
│  ┌─────────────────┐  ┌─────────────────┐          │
│  │ #6493060        │  │ #6493725        │          │
│  │ Refactor        │  │ Map Privacy     │          │
│  │ Slideshow.ts    │  │ Blur Request    │          │
│  │ 🟡 Active       │  │ 🔵 New          │          │
│  │ P2 · Bing_Ads   │  │ P3 · Geospatial │          │
│  │ 💬 2 mentions   │  │ 💬 1 mention    │          │
│  └─────────────────┘  └─────────────────┘          │
│                                                     │
│  ── Closed (15) ───────────────────────────────── │
│  ...                                                │
└─────────────────────────────────────────────────────┘
```

### Card Fields

**PR Card:**

| Field | Source | Display |
|-------|--------|---------|
| PR number | `metadata.yaml → pr_number` | `#6503730` |
| Title | `metadata.yaml → title` or `description.md` H1 | Max 2 lines, ellipsis |
| Status | `description.md` Status table | Badge: Active=blue, Completed=green, Draft=gray |
| Repository | `metadata.yaml → repository` | Small secondary text |
| Reviewer progress | `description.md` Reviewers section | `👤 N/M approved` |
| Mentions | `metadata.yaml → total_mentions` | `💬 N mentions` |

**WI Card:**

| Field | Source | Display |
|-------|--------|---------|
| WI ID | `metadata.yaml → work_item_id` | `#6493060` |
| Title | `description.md` H1 | Max 2 lines, ellipsis |
| State | `description.md` Status table | Badge: New=blue, Active=yellow, Closed=green |
| Priority | `description.md` Status table | `P1`=red, `P2`=orange, `P3`=gray |
| Project | `metadata.yaml → project` | Small secondary text |
| Mentions | `metadata.yaml → total_mentions` | `💬 N mentions` |

### PR Grouping

PRs are grouped by the user's role:
- **My PRs** — `created_by` matches the current user
- **Reviewing** — user appears in the reviewers list but is not the author
- **Other** — everything else

Within each group, sorted by `created_date` descending (newest first).

### WI Grouping

Work Items grouped by state:
- **New** / **Active** / **Resolved** / **Closed**

Within each group, sorted by priority (P1 first), then by `created_date` descending.

### Detail View (PR)

```
┌─────────────────────────────────────────────────────┐
│  ← Back                                             │
│                                                     │
│  ▽ PR #6503730 — Eval Pipeline        ✅ Completed  │
│  ┌─────────────────────────────────────────────────┐│
│  │ Repository: AdsAppsService                      ││
│  │ Branch: user/kailunshi/eval → main              ││
│  │ Created: Mar 20, 2026 by Kailun Shi            ││
│  │ Merge: Succeeded                                ││
│  │                                                 ││
│  │ 👤 Reviewers                                    ││
│  │   ✅ Trupti Kulkarni · Approved                 ││
│  │   ✅ Wei Zhang · Approved                       ││
│  │   ⏸️  Pavan Kumar · No vote                     ││
│  │                                                 ││
│  │ 📋 Description                                  ││
│  │   [rendered markdown from description.md]       ││
│  │                                                 ││
│  │ 💬 Discussed In                                 ││
│  │   [rendered markdown from mentions.md]          ││
│  └──────────────────────── ▓▓ fade ───────────────┘│
│  ═══════════════ resize handle ═════════════════════│
│                                                     │
│  Chat with Claude about this PR                     │
│  > "Summarize the review feedback"                  │
│  > "What files were changed?"                       │
└─────────────────────────────────────────────────────┘
```

### Detail View (WI)

Same split-view layout with:
- Header: state badge, assigned to, priority, severity
- Metadata: Area Path, Iteration Path, Created/Changed dates
- Description (rendered markdown)
- Related Items (linked PRs/commits)
- Comments
- Discussed In (mentions.md)
- Chat area

---

## Data Flow

```
~/BrainData/devops/pull_requests/pr_*/   ──→  agent/src/devops.ts
~/BrainData/devops/work_items/wi_*/      ──→       (parse YAML + MD)
                                                      │
                                              WebSocket messages
                                                      │
                                                      ▼
                                              web modules/devops.js
                                                      │
                                                      ▼
                                        DevOpsFeed.vue / DevOpsDetail.vue
```

---

## WebSocket Protocol

### Web → Agent

| Type | Payload | Purpose |
|------|---------|---------|
| `list_devops` | `{}` | Request all PRs and WIs |
| `get_devops_detail` | `{ entityType: 'pr'\|'wi', entityId: string }` | Request full detail for one item |

### Agent → Web

| Type | Payload | Purpose |
|------|---------|---------|
| `devops_list` | `{ pullRequests: PrEntry[], workItems: WiEntry[], userName: string, error?: string }` | Feed data (includes username for grouping) |
| `devops_detail` | `{ entityType: string, entityId: string, description: string, mentions: string, error?: string }` | Detail markdown content |

---

## Data Structures

```typescript
interface PrEntry {
  pr_number: string;
  title: string | null;
  url: string;
  project: string;
  repository: string;
  source: 'azure_devops' | 'github';
  total_mentions: number;
  // Parsed from description.md:
  status: string;          // 'active' | 'completed' | 'draft' | 'abandoned'
  created_by: string;
  created_date: string;
  source_branch: string;
  target_branch: string;
  merge_status: string;
  reviewers: Array<{ name: string; vote: string }>;
}

interface WiEntry {
  work_item_id: string;
  title: string | null;
  url: string;
  project: string;
  total_mentions: number;
  // Parsed from description.md:
  state: string;           // 'New' | 'Active' | 'Resolved' | 'Closed'
  assigned_to: string;
  priority: string;        // '1' | '2' | '3' | 'N/A'
  severity: string;
  area_path: string;
  created_date: string;
  work_item_type: string;  // 'Task' | 'Bug' | etc.
}
```

---

## BrainData File Format Reference

### PR File Structure (`devops/pull_requests/pr_NNNNNN/`)

**metadata.yaml:**
```yaml
pr_number: '6503730'
title: 'Add servable ads URL sampling script'
url: https://dev.azure.com/...
project: Bing_Ads
repository: AdsAppsService
source: azure_devops
message_ids: ['20260317_000642_a256ce84']
total_mentions: 1
```

**description.md** (sections parsed for feed entry):
```markdown
# Pull Request #6503730: Add servable ads...
**URL:** https://...

## Status
| Field | Value |
|-------|-------|
| Status | completed |
| Created By | Kailun Shi |
| Created Date | 2026-03-20T... |
| Source Branch | user/kailunshi/eval |
| Target Branch | main |
| Merge Status | succeeded |

## Reviewers
- ✅ **Trupti Kulkarni** — Approved
- ⏸️ **Pavan Kumar** — No vote

## Description
...

## Changed Files
...

## Commits
...

## Discussion Threads
...
```

**mentions.md:** Cross-references to Teams/Email messages (rendered as-is in detail view).

### WI File Structure (`devops/work_items/wi_NNNNNN/`)

**metadata.yaml:**
```yaml
work_item_id: '6493060'
url: https://dev.azure.com/...
project: Bing_Ads
message_ids: ['20260317_000642_a256ce84']
total_mentions: 1
```

**description.md** (sections parsed for feed entry):
```markdown
# [Task 6493060] Refactor Slideshow.helper.ts
**URL:** https://...

| Field | Value |
|-------|-------|
| State | Active |
| Assigned To | Kailun Shi |
| Priority | 2 |
| Severity | N/A |
| Area Path | Bing_Ads\... |
| Created Date | 2026-03-15T... |
...
```

---

## Implementation Scope

### New Files

| File | Purpose |
|------|---------|
| `agent/src/devops.ts` | Parse devops directories → `listDevops()` + `getDevopsDetail()` |
| `server/web/src/modules/devops.js` | State module (factory pattern) |
| `server/web/src/modules/handlers/devops-handler.js` | WS message dispatch |
| `server/web/src/components/DevOpsFeed.vue` | Feed with tabs + card grid |
| `server/web/src/components/DevOpsCard.vue` | PR/WI card component |
| `server/web/src/components/DevOpsDetail.vue` | Detail + chat split view |
| `server/web/src/css/devops.css` | Styles |
| `test/agent/devops.test.ts` | Unit tests |

### Modified Files

| File | Change |
|------|--------|
| `agent/src/connection.ts` | Register `list_devops` / `get_devops_detail` handlers |
| `server/web/src/store.js` | Create devops module, expose `_devops`, add `currentView` states |
| `server/web/src/App.vue` | `provide('devops', ...)`, `v-if` for devops views |
| `server/web/src/modules/connection.js` | Import + register devops handler |
| `server/web/src/modules/sidebar.js` | Add DevOps navigation item |
| `server/web/src/main.js` or CSS entry | Import devops.css |
