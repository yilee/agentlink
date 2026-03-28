# Project Knowledge Base — Design Document

## Overview

Add a **Project Knowledge Base** view to AgentLink's Brain Feed, displaying project documentation from `~/BrainData/projects/`. Users can browse projects, view structured knowledge (overview, team, workstreams, decisions, blockers), and chat about any project with full context injection.

### Current Data

Two projects exist, 37 files total (~63 KB):

| Project | Files | Content |
|---------|-------|---------|
| `entityid-support` | 22 | Full: config, overview, team, timeline, decisions, 3 workstreams, cross-cutting, code_paths, missing_info, gap-analysis, schema, validation_report |
| `aigc-infra` | 15 | No config.yaml; overview, team, timeline, 6 workstreams, cross-cutting |

---

## Data Structure

### Project-level files (`projects/<name>/`)

| File | Content | Display Purpose |
|------|---------|-----------------|
| `config.yaml` | Owner, team members, monitored channels/PRs/repos | Metadata sidebar |
| `.memory_digest.yaml` | Recent entity changes delta | Activity indicator |
| `README.md` | Short project description | Card snippet |

### Knowledge tree (`projects/<name>/project/`)

| File | Content | Display Purpose |
|------|---------|-----------------|
| `overview.md` | Mission, strategy, constraints, success metrics, current phase | Project header/summary |
| `team.md` | Roster: name, role, activity level, focus areas | Team section |
| `timeline.md` | Chronological events with PR/decision references | Timeline section |
| `decisions.md` | Numbered decisions with rationale + rejected alternatives | Decisions section |
| `code_paths.md` | Repository structure, code references | Developer reference |
| `missing_info.md` | Information gaps, priority, suggested actions | Gap analysis section |
| `schema.md` | Data observation scope, what Brain can/cannot see | Metadata |
| `validation_report.md` | Reference integrity checks | Metadata |
| `gap-analysis.md` | Capability matrix (strategic/technical/operational) | Gap analysis |

### Workstreams (`projects/<name>/project/workstreams/`)

Per-workstream markdown files containing:
- Status: COMPLETED / IN PROGRESS / WAITING / READY
- Tasks and sub-tasks
- Related PRs and decisions
- Blockers
- Artifact chains (decision → PR → deployment)

Examples: `plugin_campaignid_migration.md`, `eval_pipeline.md`, `security_remediation.md`

### Cross-cutting issues (`projects/<name>/project/cross_cutting/`)

| File | Content |
|------|---------|
| `blockers.md` | Active blockers with owner and status |
| `pending_decisions.md` | Decisions awaiting resolution + who's blocking |
| `stale_items.md` | Outdated items needing follow-up |

---

## UI Design

### Feed View (`ProjectFeed.vue`, currentView: `'project-feed'`)

Project card grid, one card per project. Follows existing feed pattern (auto-fill grid, 320px min-width).

**Card content (`ProjectCard.vue`):**
- Project name (from directory name or README title)
- Short description (from README.md, 2-line clamp)
- Stats row: workstream count, active blocker count, pending decision count
- Left border accent: `var(--text-secondary)` (same as DevOps — no extra colors)

**No tabs needed** — just a flat project list (only 2 projects currently, will grow slowly).

**No date grouping** — projects are persistent entities, not time-series. Sort by most recent `.memory_digest.yaml` timestamp or alphabetically.

### Detail View (`ProjectDetail.vue`, currentView: `'project-detail'`)

Split pane: collapsible detail content (top) + chat area (bottom), with resize handle. Same pattern as BriefingDetail/DevOpsDetail/RecapDetail.

**Detail content layout:**

Render all project markdown files in a single scrollable view with collapsible sections:

```
┌─────────────────────────────────────────────┐
│ ← Back to Projects    Project Name    [New] │  ← collapse header + reset chat btn
├─────────────────────────────────────────────┤
│ ▼ Overview                                  │  ← collapsible section
│   [rendered overview.md]                    │
│                                             │
│ ▼ Workstreams (3)                           │
│   ┌──────────────────────────────────┐      │
│   │ Plugin CampaignId Migration      │      │
│   │ Status: IN PROGRESS              │      │
│   │ [rendered content]               │      │
│   └──────────────────────────────────┘      │
│   ┌──────────────────────────────────┐      │
│   │ QU Agent Entity Handling         │      │
│   │ Status: COMPLETED                │      │
│   └──────────────────────────────────┘      │
│   ...                                       │
│                                             │
│ ▼ Decisions (4)                             │
│   [rendered decisions.md]                   │
│                                             │
│ ▼ Timeline                                  │
│   [rendered timeline.md]                    │
│                                             │
│ ▼ Team (9)                                  │
│   [rendered team.md]                        │
│                                             │
│ ▼ Risks & Issues                            │
│   Blockers: [rendered blockers.md]          │
│   Pending Decisions: [rendered ...]         │
│   Stale Items: [rendered ...]               │
│                                             │
│ ▼ References                                │
│   Code Paths: [rendered code_paths.md]      │
│   Missing Info: [rendered missing_info.md]  │
│   Gap Analysis: [rendered gap-analysis.md]  │
├─────────────────────────────────────────────┤
│ ═══ resize handle ═══                       │
├─────────────────────────────────────────────┤
│ Chat area (MessageList)                     │
│                                             │
│ "Ask anything about this project"           │
│ e.g. "What's blocking progress?"            │
├─────────────────────────────────────────────┤
│ [input box — from ChatInput.vue]            │
└─────────────────────────────────────────────┘
```

**Section collapse:** Each section header is clickable to expand/collapse content. Default state: Overview expanded, all others collapsed. Store collapsed state in `localStorage` per project.

**Rendering:** All `.md` files rendered as markdown via `marked` (same as briefing detail). No need to parse into structured JSON — raw markdown rendering is sufficient and matches existing pattern.

---

## Critical Implementation Details

### 1. Input Box Visibility (MUST DO)

**ChatInput.vue line 61** — Add `'project-detail'` to the v-if condition:

```javascript
// Before:
v-if="(viewMode === 'chat' && currentView === 'chat') || currentView === 'recap-detail' || currentView === 'briefing-detail' || currentView === 'devops-detail'"

// After:
v-if="(viewMode === 'chat' && currentView === 'chat') || currentView === 'recap-detail' || currentView === 'briefing-detail' || currentView === 'devops-detail' || currentView === 'project-detail'"
```

### 2. Context Injection + Collapsing (MUST DO)

**Context builder** (`modules/project.js`):

```javascript
export function buildProjectContext(projectName, allContent) {
  if (!allContent) return '';
  let ctx = `[Project Context — You are answering questions about the "${projectName}" project]\n\n`;
  ctx += allContent + '\n';
  ctx += '\n## Source Files (relative to working directory ~/BrainData/)\n';
  ctx += `- Project directory: projects/${projectName}/project/\n`;
  ctx += `- Overview: projects/${projectName}/project/overview.md\n`;
  ctx += `- Team: projects/${projectName}/project/team.md\n`;
  ctx += `- Timeline: projects/${projectName}/project/timeline.md\n`;
  ctx += `- Decisions: projects/${projectName}/project/decisions.md\n`;
  ctx += `- Workstreams: projects/${projectName}/project/workstreams/\n`;
  ctx += `- Cross-cutting: projects/${projectName}/project/cross_cutting/\n\n`;
  ctx += 'You can Read these files for more detail if needed.\n';
  ctx += '\n</brain-context>\n';
  return ctx;
}
```

**Context detection** — add prefix to `messageHelpers.js`:

```javascript
const PROJECT_CONTEXT_PREFIX = '[Project Context';
```

Add to `parseMeetingContext()`:
```javascript
else if (trimmed.startsWith(PROJECT_CONTEXT_PREFIX)) type = 'project';
```

**Context role** — add to `backgroundRouting.js` line 37:
```javascript
const contextRole = parsed.type === 'briefing' ? 'briefing-context'
  : parsed.type === 'devops' ? 'devops-context'
  : parsed.type === 'project' ? 'project-context'
  : 'meeting-context';
```

**MessageList.vue** — add `project-context` rendering block (copy from devops-context pattern):
```vue
<div v-else-if="msg.role === 'project-context'" class="context-summary-wrapper meeting-context-wrapper">
  <div class="context-summary-bar meeting-context-bar" @click="toggleContextSummary(msg)">
    <svg ...book icon...></svg>
    <span class="context-summary-label">{{ t('chat.projectContextInjected') }}</span>
    <span class="context-summary-toggle">{{ msg.contextExpanded ? t('chat.hide') : t('chat.show') }}</span>
  </div>
  <div v-if="msg.contextExpanded" class="context-summary-body">
    <div class="markdown-body" v-html="getRenderedContent({ role: 'assistant', content: msg.content })"></div>
  </div>
</div>
```

### 3. Sidebar Chat History (MUST DO)

**`ProjectChatHistory.vue`** — follows exact same pattern as `DevOpsChatHistory.vue`:
- Inject `project` module
- Show `groupedProjectChatSessions` (grouped by project name)
- Resume: `navigateToProjectChat(session)` → `selectProject()` → `currentView = 'project-detail'` → `enterProjectChatSession()`
- Rename/delete with `useConfirmDialog`

**`Sidebar.vue`** — add in feed sidebar nav (after DevOps button):
```vue
<button :class="{ active: currentView === 'project-feed' || currentView === 'project-detail' }"
        @click="store.requireVersion('0.1.XXX', 'Project Knowledge Base') && (currentView = 'project-feed')">
  <span class="feed-sidebar-icon">&#x1F4DA;</span>
  Projects
</button>

<ProjectChatHistory v-if="currentView === 'project-feed' || currentView === 'project-detail'" />
```

### 4. Detail Lifecycle (MUST DO — prevents input box bug)

```javascript
// ProjectDetail.vue
onMounted(() => {
  if (selectedProject.value && !projectChatActive.value) {
    project.enterProjectChat(selectedProject.value);
  }
});

onUnmounted(() => {
  if (projectChatActive.value) {
    project.exitProjectChat();
  }
});
```

This ensures `projectChatActive` is set to `true` when the detail mounts, which satisfies the ChatInput.vue v-if condition.

### 5. Store Message Routing (MUST DO)

**`store.js`** — add routing block after devops routing (before generic send):

```javascript
// Project KB chat — route through project module when in project detail view
if (project && project.projectChatActive.value && currentView.value === 'project-detail') {
  const name = project.selectedProject.value;
  const content = project.selectedContent.value;  // all concatenated markdown
  inputText.value = '';
  if (inputRef.value) inputRef.value.style.height = 'auto';
  const userMsg = {
    id: streaming.nextId(), role: 'user',
    content: text, timestamp: new Date(), status: 'sent',
  };
  messages.value.push(userMsg);
  isProcessing.value = true;
  if (currentConversationId.value) {
    processingConversations.value[currentConversationId.value] = true;
  }
  project.sendProjectChat(text, name, content);
  scrollToBottom(true);
  return;
}
```

---

## Agent Side

### New file: `agent/src/project.ts`

```typescript
interface ProjectEntry {
  name: string;           // directory name (e.g. 'entityid-support')
  title: string;          // from README.md first heading or name
  description: string;    // from README.md (truncated)
  workstreamCount: number;
  blockerCount: number;
  pendingDecisionCount: number;
  staleItemCount: number;
  lastModified?: string;  // from .memory_digest.yaml or filesystem
}

interface ProjectDetail {
  name: string;
  overview: string;       // raw markdown
  team: string;
  timeline: string;
  decisions: string;
  codePaths: string;
  missingInfo: string;
  gapAnalysis: string;
  schema: string;
  workstreams: Array<{ name: string; filename: string; content: string }>;
  blockers: string;
  pendingDecisions: string;
  staleItems: string;
}
```

**`listProjects(brainDataDir)`:**
1. Scan `projects/` directory for subdirectories
2. For each project:
   - Read `README.md` → extract title + first paragraph for description
   - Count files in `project/workstreams/` (excluding README.md)
   - Parse `project/cross_cutting/blockers.md` → count non-zero blockers
   - Parse `project/cross_cutting/pending_decisions.md` → count items
   - Parse `project/cross_cutting/stale_items.md` → count items
3. Return `ProjectEntry[]`

**`getProjectDetail(brainDataDir, projectName)`:**
1. Read all markdown files from `project/` directory
2. Read all files from `project/workstreams/` (excluding README.md)
3. Read all files from `project/cross_cutting/`
4. Return `ProjectDetail` with raw markdown content

### Connection handler (`agent/src/connection.ts`)

Add two new cases:

```typescript
case 'list_projects':
  handleListProjects();
  break;
case 'get_project_detail':
  handleGetProjectDetailMsg(msg as { projectName: string });
  break;
```

### Web handler (`modules/handlers/project-handler.js`)

```javascript
export function createProjectHandlers(deps) {
  return {
    projects_list: (msg) => {
      if (deps.project) deps.project.handleProjectsList(msg);
    },
    project_detail: (msg) => {
      if (deps.project) deps.project.handleProjectDetail(msg);
    },
  };
}
```

---

## Protocol Messages

### Web → Agent

| Type | Fields | Description |
|------|--------|-------------|
| `list_projects` | — | Request project list |
| `get_project_detail` | `projectName: string` | Request full project detail |

### Agent → Web

| Type | Fields | Description |
|------|--------|-------------|
| `projects_list` | `projects: ProjectEntry[]` | Project list for feed |
| `project_detail` | `name, overview, team, timeline, decisions, codePaths, missingInfo, gapAnalysis, schema, workstreams[], blockers, pendingDecisions, staleItems` | Full project content |

---

## File Changes Summary

### New files (9)

| File | Purpose |
|------|---------|
| `agent/src/project.ts` | Read `~/BrainData/projects/`, parse project data |
| `server/web/src/modules/project.js` | Project module: state, chat, session management |
| `server/web/src/modules/handlers/project-handler.js` | WebSocket dispatch for project messages |
| `server/web/src/components/ProjectFeed.vue` | Project list view |
| `server/web/src/components/ProjectCard.vue` | Project card component |
| `server/web/src/components/ProjectDetail.vue` | Project detail + chat split pane |
| `server/web/src/components/ProjectChatHistory.vue` | Sidebar chat history for projects |
| `server/web/src/css/project.css` | Project-specific styles (prefix: `.project-`) |
| `locales/en.json` (partial) | i18n keys: `chat.projectContextInjected`, etc. |

### Modified files (8)

| File | Change |
|------|--------|
| `agent/src/connection.ts` | Add `list_projects` / `get_project_detail` handlers |
| `server/web/src/store.js` | Create project module, provide it, add sendMessage routing |
| `server/web/src/App.vue` | Import + render ProjectFeed/ProjectDetail, provide project module |
| `server/web/src/components/ChatInput.vue` | Add `'project-detail'` to input-area v-if |
| `server/web/src/components/Sidebar.vue` | Add Projects button + ProjectChatHistory |
| `server/web/src/components/MessageList.vue` | Add `project-context` collapsible block |
| `server/web/src/modules/messageHelpers.js` | Add `PROJECT_CONTEXT_PREFIX` + parse logic |
| `server/web/src/modules/backgroundRouting.js` | Add `'project'` type → `'project-context'` role mapping |
| `server/web/src/modules/connection.js` | Import + wire project-handler |

---

## What's NOT included (keep simple)

- No structured JSON parsing of workstream status — just raw markdown rendering
- No timeline visualization — just rendered timeline.md
- No team responsibility matrix — just rendered team.md
- No cross-linking to DevOps Board PRs — future enhancement
- No search within project files — just browse + chat
- No editing project files — read-only display
