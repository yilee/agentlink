# Brain Mode — Design Document

## Overview

Add a "Brain Mode" toggle to AgentLink that enables BrainCore skills and commands for a conversation. Brain Mode is a **per-conversation setting chosen at creation time** — once a conversation starts in Brain or Normal mode, it stays that way.

## Why Per-Conversation

Claude's `--add-dir` flags are set at process spawn time. There's no way to hot-reload them mid-conversation. Restarting the process mid-chat (like Plan Mode does) would work but adds complexity and latency. A cleaner UX: choose the mode when you start the conversation.

## User Experience

### 1. New Conversation — Mode Picker

When the user clicks **"+ New Conversation"** in the sidebar (or the input area is empty in a fresh conversation), show a small toggle/badge next to the new conversation button or in the input area:

```
┌─────────────────────────────────────────────┐
│  [Normal]  [🧠 Brain]                       │
│                                             │
│  Type a message...                     Send │
└─────────────────────────────────────────────┘
```

- Default: **Normal** (current behavior)
- Brain mode: highlighted with a distinct color (e.g., purple/violet `--brain-mode` CSS variable)
- Once the first message is sent, the toggle locks (disabled, non-interactive) for the rest of the conversation
- The mode is shown as a subtle badge/indicator so the user always knows which mode they're in

### 2. Slash Command Menu — Brain Commands

In Brain Mode, the slash menu expands from the current 4 commands to include all Brain skills:

**Normal Mode (unchanged):**
```
/btw       Side question
/cost      Show token usage
/context   Show context info
/compact   Compact context
```

**Brain Mode (adds Brain commands, grouped by category):**
```
── Data ──
/update              Incremental data fetch
/runner-start        Start background data runner
/runner-stop         Stop data runner
/runner-status       Check runner status

── Queries ──
/brain-query         Query messages with filters
/search-brain        Full-text search across all data
/brain-status        Data coverage status

── Reports ──
/daily-briefing      Generate daily activity summary
/daily-update        Update project memory
/meeting-recap       Generate meeting recap

── Communication ──
/teams               Teams chat & meeting operations
/teams-channel       Teams channel posts
/email               Outlook email operations

── Dev Tools ──
/azure-devops        ADO PRs, work items, code search
/sharepoint          SharePoint/OneDrive file access

── Output ──
/ppt-gen             Generate PowerPoint presentations

── System ──
/bootstrap           First-time Brain setup
/troubleshoot        Diagnostics & repair
/bug-report          File Brain system issues
/contribute          Submit code changes
```

The menu supports:
- **Category headers** (non-selectable, styled as group labels)
- **Filtering** — typing `/tea` filters to `/teams`, `/teams-channel`
- All existing keyboard navigation (Arrow keys, Enter, Tab, Escape)

### 3. Visual Indicators

- **Input card**: `.input-card.brain-mode` — colored top border (purple/violet, similar to Plan Mode's gold border)
- **Mode badge**: Small "Brain" label in the input area or top bar showing the active mode
- **Locked toggle**: After the first message, the mode picker becomes a read-only badge

## Data Flow

### Frontend

```
newConversation()
  → switchConversation(newConvId)
  → set brainMode.value = <user's choice>
  → conversationCache stores brainMode per conversation

First message sent:
  → wsSend({ type: 'chat', prompt, brainMode: true, conversationId })
  → modeLocked.value = true (toggle becomes read-only)
```

### Agent (connection.ts → claude.ts)

```
Receive { type: 'chat', brainMode: true }
  → handleChat(convId, prompt, workDir, {
      extraArgs: ['--add-dir', BRAIN_CORE_PATH, '--add-dir', CORE_SKILL_PATH]
    })
  → startQuery() spawns: claude ... --add-dir ~/.brain/BrainCore --add-dir ~/.brain/CoreSkill
```

The agent needs to:
1. Read `brainMode` from the `chat` message
2. Resolve BrainCore/CoreSkill paths (check `~/.brain/BrainCore` and `~/.brain/CoreSkill` exist)
3. Pass `--add-dir` flags via `extraArgs` on the first spawn only (subsequent messages in the same conversation reuse the existing process)

### State Management

Add to `store.js`:
```javascript
const brainMode = ref(false);        // Is this conversation in Brain mode?
const brainModeLocked = ref(false);  // Locked after first message sent?
```

Add to `switchConversation()` save/restore:
```javascript
// Save
conversationCache.value[oldConvId] = {
  ...existing,
  brainMode: brainMode.value,
  brainModeLocked: brainModeLocked.value,
};

// Restore
brainMode.value = cached.brainMode || false;
brainModeLocked.value = cached.brainModeLocked || false;
```

### Slash Menu Changes

In `useSlashMenu.js`:
- Accept a `brainMode` ref as a dependency
- Define `BRAIN_SLASH_COMMANDS` with category grouping
- `filteredSlashCommands` returns merged list when `brainMode.value` is true
- Add a `category` field to command objects for group headers

```javascript
const NORMAL_COMMANDS = [
  { command: '/btw', descKey: 'slash.btw', isPrefix: true },
  { command: '/cost', descKey: 'slash.cost' },
  { command: '/context', descKey: 'slash.context' },
  { command: '/compact', descKey: 'slash.compact' },
];

const BRAIN_COMMANDS = [
  { command: '/update', desc: 'Incremental data fetch', category: 'Data' },
  { command: '/runner-start', desc: 'Start background data runner', category: 'Data' },
  { command: '/runner-stop', desc: 'Stop data runner', category: 'Data' },
  { command: '/runner-status', desc: 'Check runner status', category: 'Data' },
  { command: '/brain-query', desc: 'Query messages with filters', category: 'Queries' },
  { command: '/search-brain', desc: 'Full-text search', category: 'Queries' },
  { command: '/brain-status', desc: 'Data coverage status', category: 'Queries' },
  { command: '/daily-briefing', desc: 'Daily activity summary', category: 'Reports' },
  { command: '/daily-update', desc: 'Update project memory', category: 'Reports' },
  { command: '/meeting-recap', desc: 'Generate meeting recap', category: 'Reports' },
  { command: '/teams', desc: 'Teams chat & meetings', category: 'Communication' },
  { command: '/teams-channel', desc: 'Teams channel posts', category: 'Communication' },
  { command: '/email', desc: 'Outlook email', category: 'Communication' },
  { command: '/azure-devops', desc: 'ADO PRs, work items, code', category: 'Dev Tools' },
  { command: '/sharepoint', desc: 'SharePoint/OneDrive files', category: 'Dev Tools' },
  { command: '/ppt-gen', desc: 'Generate PowerPoint', category: 'Output' },
  { command: '/bootstrap', desc: 'First-time Brain setup', category: 'System' },
  { command: '/troubleshoot', desc: 'Diagnostics & repair', category: 'System' },
  { command: '/bug-report', desc: 'File system issues', category: 'System' },
  { command: '/contribute', desc: 'Submit code changes', category: 'System' },
];
```

## File Changes

| File | Change |
|------|--------|
| `server/web/src/composables/useSlashMenu.js` | Add `brainMode` dep, `BRAIN_COMMANDS`, category grouping |
| `server/web/src/store.js` | Add `brainMode`, `brainModeLocked` refs; save/restore in `switchConversation` |
| `server/web/src/components/ChatInput.vue` | Add Brain Mode toggle (before first message), lock after send, pass `brainMode` to `useSlashMenu` |
| `server/web/src/css/input.css` | `.brain-mode-btn`, `.input-card.brain-mode`, category header styles |
| `server/web/src/css/base.css` | `--brain-mode` CSS variable (purple/violet) |
| `server/web/src/modules/sidebar.js` | `newConversation()` resets `brainMode` to false |
| `agent/src/connection.ts` | Read `brainMode` from `chat` message, pass `extraArgs` |
| `agent/src/claude.ts` | No changes (already supports `extraArgs`) |

## Prerequisites

- BrainCore and CoreSkill must be cloned at `~/.brain/BrainCore` and `~/.brain/CoreSkill`
- If not present, Brain Mode toggle should be hidden or show a "Brain not installed" tooltip

## Open Questions

1. **Auto-detect Brain installation?** Agent could check if `~/.brain/BrainCore` exists on startup and tell the web UI whether Brain is available. If not installed, hide the toggle entirely.
2. **Remember preference?** Should the user's last-used mode be remembered (localStorage) and pre-selected for new conversations?
3. **Slash command descriptions** — use i18n keys (like normal commands) or hardcoded English strings (Brain is internal-only)?
