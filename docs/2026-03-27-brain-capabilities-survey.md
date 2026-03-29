# Brain Capabilities Survey — Full Integration Plan

## Overview

Survey of all BrainCore capabilities and `~/BrainData` file structure, with the goal of integrating them into AgentLink's web UI. Capabilities are divided into two categories:

1. **Display-only** — Read pre-generated files from `~/BrainData` and render in the UI (no Claude session needed)
2. **Live-action** — Invoke Brain Skills via a Brain Mode Claude session in real-time

### Current State

Only **Meeting Recap** is integrated (Phase 1). Brain Mode toggle, slash commands, and session metadata are in place but no other data is surfaced in the UI.

---

## Category 1: Display-Only (Read `~/BrainData` Files)

Data pre-processed by Brain Runner, stored as files. Agent reads them and sends to web UI via WebSocket. No Claude session required.

### 1.1 Daily Briefing ⭐ Highest Priority

| Property | Value |
|----------|-------|
| Path | `reports/daily/YYYY-MM-DD.md` |
| Format | Markdown (12–20 KB per file) |
| Count | ~9 files currently |
| Content | TL;DR, Action Required (priority-coded), FYI items, PR status, meeting summaries |

**Why highest priority:** Users open the app every morning — a daily briefing is the most natural "home screen" content. Implementation mirrors the existing Recap pattern (agent reads file → WS relay → Vue renders).

### 1.2 Meeting Recap ✅ Already Integrated

| Property | Value |
|----------|-------|
| Index | `reports/meeting-recap/recap_index.yaml` |
| Detail | `reports/meeting-recap/<series>/*.json` sidecar |
| Format | YAML index + JSON sidecar (with `meta`, `feed`, `detail` sections) |

### 1.3 Teams Chat List & Messages

| Property | Value |
|----------|-------|
| Chat registry | `teams/chat_registry.yaml` — 65 chats (1:1, group, meeting) with participant lists, message counts |
| Messages | `teams/by_chat/<ChatName>/*.json` — per-message JSON (sender, body HTML, mentions, work_items) |
| Also available | `teams/2026/MM/DD/` — same data organized by date |

Potential UI: sidebar or panel showing recent chats, click to expand messages. Unread count derivable from timestamps.

### 1.4 Email Inbox

| Property | Value |
|----------|-------|
| Inbox folder | `emails/by_folder/inbox/*.json` — per-email JSON (sender, subject, body, importance, is_read, thread_id) |
| By thread | `emails/by_thread/<hash>/` — grouped by conversation thread with `_index.md` |
| Master index | `metadata/email_index.yaml` (1.7 MB, 3,330 emails) |

Potential UI: inbox list view with sender, subject, importance badge, read/unread state. Click to expand body. Thread grouping available.

### 1.5 Meeting Transcripts

| Property | Value |
|----------|-------|
| By meeting | `meetings/by_meeting/<MeetingName>/*.md` — full transcript with speaker attribution |
| By date | `meetings/2026/MM/DD/` — date-organized copies |

Potential UI: meeting list with transcript viewer. Could embed alongside Recap detail as a "View Transcript" tab.

### 1.6 PR Tracker

| Property | Value |
|----------|-------|
| Path | `devops/pull_requests/pr_<N>/` — 53 PRs |
| Files | `metadata.yaml` (number, title, URL, project, repo, source, mentions), `description.md`, `mentions.md` |

Potential UI: PR board/list showing status, linked messages and discussions.

### 1.7 Work Items

| Property | Value |
|----------|-------|
| Path | `devops/work_items/wi_<N>/` — 18 work items |
| Files | `metadata.yaml` (id, URL, project, mentions), `description.md`, `mentions.md` |

Potential UI: work item list with context from related messages.

### 1.8 Project Knowledge Base

| Property | Value |
|----------|-------|
| Path | `projects/<name>/project/` |
| Files | `overview.md`, `team.md`, `timeline.md`, `decisions.md`, `schema.md`, `code_paths.md`, `missing_info.md` |
| Cross-cutting | `project/cross_cutting/blockers.md`, `pending_decisions.md`, `stale_items.md` |
| Workstreams | `project/workstreams/` — per-workstream breakdown |
| Digest | `.memory_digest.yaml` — delta digest of changes since last update |

Potential UI: project wiki/knowledge tree. Useful for onboarding and project overview.

### 1.9 Document References

| Property | Value |
|----------|-------|
| Path | `documents/by_doc/<filename>/` — 40 documents |
| Files | `metadata.yaml` (filename, URL, direct_url, type, source, mentions), `content.md`, `mentions.md` |

Potential UI: document list with links and mention context.

### 1.10 Entity Cross-References

| Property | Value |
|----------|-------|
| Path | `metadata/entities_by_type/` |
| Files | `pull_requests.yaml`, `work_items.yaml`, `documents.yaml`, `web_links.yaml` |
| Purpose | Maps which messages mention which entities (PR ↔ Teams message, Work Item ↔ email, etc.) |

### 1.11 Search Index

| Property | Value |
|----------|-------|
| Path | `.search_index/` |
| Files | `teams.json` (1,929 entries), `emails.json` (1,831), `meetings.json` (43), `pull_requests.json`, `work_items.json`, `documents.json` |
| Meta | `_meta.json` with generation timestamps and counts |

Potential UI: unified search bar across all Brain data — client-side search using pre-built indexes, no Claude needed.

### 1.12 SQLite Full-Text Search

| Property | Value |
|----------|-------|
| Path | `inbox_v4.db` (1.4 MB) |
| Tables | `provenance` (source records), `provenance_content`, `entity_refs`, `source_configs`, `coverage_windows` |
| FTS | `provenance_fts`, `content_fts` (FTS5 virtual tables) |

Alternative to JSON search indexes — agent can run SQL queries for richer search and filtering.

---

## Category 2: Live-Action (Brain Mode Claude Session)

These require an active Brain Mode conversation. User triggers a slash command → Claude executes Brain Skill Python scripts → calls Microsoft Graph API / ADO API / etc.

### 2.1 Communication

| Skill | Slash Command | Capabilities |
|-------|--------------|-------------|
| **email** | `/email` | Read latest emails, compose, reply, forward, search by sender/subject |
| **teams** | `/teams` | Send/read Teams chat messages, browse recent conversations |
| **teams-channel** | `/teams-channel` | Post to and read Teams channel threads |

### 2.2 DevOps

| Skill | Slash Command | Capabilities |
|-------|--------------|-------------|
| **azure-devops** | `/azure-devops` | Query PRs, create/update work items, code search |
| **sharepoint** | `/sharepoint` | Read SharePoint/OneDrive files, search documents |

### 2.3 Data Management

| Skill | Slash Command | Capabilities |
|-------|--------------|-------------|
| **update** | `/update` | Incremental data fetch (pull latest Teams/Email/Meeting data into BrainData) |
| **runner-start** | `/runner-start` | Start background data polling runner |
| **runner-stop** | `/runner-stop` | Stop the runner |
| **runner-status** | `/runner-status` | Check runner health, coverage, last fetch times |

### 2.4 Query & Search

| Skill | Slash Command | Capabilities |
|-------|--------------|-------------|
| **brain-query** | `/brain-query` | Structured query with filters: date range, source type, sender, keywords |
| **search-brain** | `/search-brain` | Full-text search across all data sources |
| **brain-status** | `/brain-status` | Data coverage dashboard, gap detection, source health |

### 2.5 Report Generation

| Skill | Slash Command | Capabilities |
|-------|--------------|-------------|
| **daily-briefing** | `/daily-briefing` | Generate today's briefing (writes to `reports/daily/`) |
| **daily-update** | `/daily-update` | Update project memory from recent data |
| **meeting-recap** | `/meeting-recap` | Generate recap for a specific meeting |
| **ppt-gen** | `/ppt-gen` | Generate PowerPoint presentations |

### 2.6 System

| Skill | Slash Command | Capabilities |
|-------|--------------|-------------|
| **bootstrap** | `/bootstrap` | First-time Brain setup (3-phase) |
| **troubleshoot** | `/troubleshoot` | Diagnose and repair Brain issues |
| **bug-report** | `/bug-report` | File Brain system issues |
| **contribute** | `/contribute` | Submit code changes to BrainCore |

---

## Suggested Integration Phases

### Phase 2: Daily Briefing Feed

**Scope:** Display daily briefings in the Feed page alongside Meeting Recaps.

**Implementation (mirrors Phase 1 Recap pattern):**
- Agent: `briefing.ts` — read `reports/daily/` directory, parse markdown structure
- Protocol: `list_briefings` → `briefings_list`, `get_briefing_detail` → `briefing_detail`
- Web: `BriefingCard.vue`, `BriefingDetail.vue` — render sections (TL;DR, Actions, FYI, PRs, Meetings)
- Feed page: tab or unified timeline mixing Briefings + Recaps by date

**Key questions:**
- Parse markdown into structured JSON on agent side? Or send raw markdown and render with `marked`?
- Unified feed (interleaved by date) vs. separate tabs?

### Phase 3: Inbox Dashboard

**Scope:** Email inbox + Teams chat overview as a new Feed tab or panel.

**Implementation:**
- Agent: `inbox.ts` — read `emails/by_folder/inbox/*.json` (list), `emails/by_thread/` (detail). `chats.ts` — read `teams/chat_registry.yaml` (list), `teams/by_chat/` (messages).
- Protocol: `list_emails` / `email_detail` / `list_chats` / `chat_messages`
- Web: `InboxPanel.vue`, `EmailCard.vue`, `EmailDetail.vue`, `ChatList.vue`, `ChatMessages.vue`
- Consider: paginated loading for large inboxes (3,330 emails)

**Key questions:**
- Read/unread state from JSON `is_read` field — but this is a snapshot, not live. Acceptable?
- Should clicking an email open a Brain Mode chat to reply? Or just display?

### Phase 4: DevOps Board

**Scope:** PR and Work Item tracker.

**Implementation:**
- Agent: `devops.ts` — read `devops/pull_requests/` and `devops/work_items/`
- Web: `PrBoard.vue`, `WorkItemList.vue` — kanban or list view
- Cross-reference: link to related messages via `metadata.yaml` mention IDs

### Phase 5: Unified Search

**Scope:** Search bar across all Brain data.

**Implementation options:**
- Option A: Agent loads `.search_index/*.json` in memory, performs client-side search
- Option B: Agent queries `inbox_v4.db` FTS5 tables via `better-sqlite3`
- Web: `SearchBar.vue` with results grouped by source type

### Phase 6: Quick Actions Panel

**Scope:** One-click buttons for common Brain Mode operations.

- "Send email" → opens Brain Mode conversation with `/email compose` pre-filled
- "Check PRs" → opens Brain Mode conversation with `/azure-devops list-prs`
- "Update data" → triggers `/update` in background
- "Generate briefing" → triggers `/daily-briefing`

---

## BrainData Directory Reference

```
~/BrainData/
├── brain.yaml                          # Master config (last_fetch, coverage, projects)
├── inbox_v4.db                         # SQLite (FTS5) — unified search DB
├── reports/
│   ├── daily/YYYY-MM-DD.md             # Daily briefings (12-20 KB each)
│   └── meeting-recap/
│       ├── recap_index.yaml            # Master recap index
│       └── <series>/<recap>.json/.md   # Per-meeting sidecar + markdown
├── teams/
│   ├── chat_registry.yaml              # 65 chats with metadata
│   ├── by_chat/<name>/*.json/.md       # Per-message files
│   └── 2026/MM/DD/*.json/.md           # Date-organized
├── emails/
│   ├── by_folder/inbox/*.json/.md      # Inbox emails
│   ├── by_thread/<hash>/*.json/.md     # Thread-grouped
│   └── 2026/MM/DD/*.json/.md           # Date-organized
├── meetings/
│   ├── by_meeting/<name>/*.md/.json    # Transcripts + metadata
│   └── 2026/MM/DD/*.md/.json           # Date-organized
├── projects/<name>/
│   ├── config.yaml                     # Project definition
│   ├── .memory_digest.yaml             # Change delta
│   └── project/                        # Knowledge tree (overview, team, decisions, etc.)
├── devops/
│   ├── pull_requests/pr_<N>/           # metadata.yaml + description.md + mentions.md
│   └── work_items/wi_<N>/             # Same structure
├── documents/by_doc/<name>/            # metadata.yaml + content.md + mentions.md
├── metadata/
│   ├── email_index.yaml                # 3,330 emails master index
│   ├── meeting_index.yaml              # Meeting master index
│   ├── entities_detected.yaml          # Latest entity extraction
│   └── entities_by_type/               # PR, WI, document, link cross-refs
├── links/web_links.yaml                # Detected web links
├── .search_index/                      # Pre-built JSON search indexes
│   ├── teams.json (1,929 entries)
│   ├── emails.json (1,831 entries)
│   ├── meetings.json (43 entries)
│   ├── pull_requests.json, work_items.json, documents.json
│   └── _meta.json                      # Generation timestamps
└── data/                               # Raw pipeline layers (internal, not for direct UI)
    ├── layer1/                         # Immutable API response cache
    ├── layer2/                         # Organized messages (time + entity)
    └── layer3/                         # Consolidated project knowledge
```

## Brain Skills Reference (18 Total)

| Category | Skill | Slash Command | Type |
|----------|-------|--------------|------|
| Data | brain-inbox-v3 | — | Core data pipeline |
| Communication | teams | `/teams` | Live |
| Communication | teams-channel | `/teams-channel` | Live |
| Communication | email-tools | `/email` | Live |
| Communication | meeting-recap | `/meeting-recap` | Live + Display |
| DevOps | azure-devops | `/azure-devops` | Live |
| DevOps | sharepoint | `/sharepoint` | Live |
| Reports | daily-briefing | `/daily-briefing` | Live + Display |
| Reports | daily-update | `/daily-update` | Live |
| Output | ppt-gen | `/ppt-gen` | Live |
| Operational | runner-start | `/runner-start` | Live |
| Operational | runner-stop | `/runner-stop` | Live |
| Operational | runner-status | `/runner-status` | Live |
| Operational | update | `/update` | Live |
| System | bootstrap | `/bootstrap` | Live |
| System | troubleshoot | `/troubleshoot` | Live |
| System | bug-report | `/bug-report` | Live |
| System | contribute | `/contribute` | Live |
