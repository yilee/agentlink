# Plan Mode Design Document

## Overview

Add a Plan Mode toggle to AgentLink, mirroring Claude Code CLI's `--permission-mode plan` feature. In Plan Mode, Claude can analyze and read the codebase but **cannot modify files or execute commands**. This lets users safely explore, plan, and align on an implementation strategy before switching back to Normal Mode for execution.

## Motivation

- **Safety**: Prevent accidental code changes during exploratory phases
- **Quality**: "Explore first, plan, then code" reduces wasted effort
- **Alignment**: Users review Claude's analysis and plan before any code is written

## User Experience

### Mode Toggle Button

Add a Plan Mode toggle button to the **input area bottom-left**, alongside the existing attach and slash buttons:

```
┌─────────────────────────────────────────────┐
│  [textarea]                                 │
├─────────────────────────────────────────────┤
│  📎  /  [⏸ Plan]                   [Send]  │
└─────────────────────────────────────────────┘
```

- **Normal Mode (default)**: Button is subtle/gray, low visual weight
- **Plan Mode active**: Button highlighted with plan mode accent color (e.g. amber/purple), filled background
- **Disabled**: Button grayed out with `cursor: not-allowed` while `isProcessing === true` (Claude is responding)

### Status Banner

When Plan Mode is active, a thin banner appears **above the input card**:

```
┌─ ⏸ Plan Mode — read-only, no file changes ──── [Exit] ─┐
├─────────────────────────────────────────────────────────────┤
│  [textarea]                                                 │
├─────────────────────────────────────────────────────────────┤
│  📎  /  [⏸ Plan]                                  [Send]   │
└─────────────────────────────────────────────────────────────┘
```

- ~28px height, semi-transparent background in plan mode color
- Right-aligned "Exit" link/button for quick exit
- Hidden entirely when Plan Mode is off

### Message Badges

Messages sent/received during Plan Mode display a small badge after the role label:

```
You (Plan)
> How should we refactor the auth module?

Claude (Plan)
> After analyzing the codebase, here's my recommendation...
```

- Badge uses plan mode accent color
- Helps users distinguish plan-phase messages from execution-phase messages when scrolling history

### Interaction Rules

1. **Toggle is disabled while Claude is responding** (`isProcessing === true`). User must wait for `turn_completed` or press Stop first, then toggle.
2. **Toggling mode mid-conversation is allowed.** The conversation context is preserved via `--resume`.
3. **No separate "plan approval" UI.** Users read Claude's output in the chat, then manually exit Plan Mode and instruct Claude to implement.

## Architecture

### Strategy: Process Restart on Mode Switch

`--permission-mode` is a process-level CLI argument. Switching modes requires killing the current `claude` child process and respawning with the new mode. This reuses the existing cleanup → resume flow (same pattern as `cancel_execution` and `change_workdir`).

### Data Flow

```
Web UI                    Server (relay)              Agent
──────                    ──────────────              ─────
User clicks [Plan] ──→  set_plan_mode ──(relay)──→  connection.ts
                          (pass-through)              │
                                                      ├─ Update state.planMode
                                                      ├─ cleanupConversation()
                                                      └─ (next chat message triggers
                                                          startQuery with new mode)

                                                      startQuery() reads
                                                      state.planMode to set
                                                      --permission-mode plan
                                                      or bypassPermissions
```

### Changes by Layer

#### 1. Web UI (`server/web/`)

**`app.js`**:
- Add reactive state: `planMode = ref(false)`
- Add `togglePlanMode()` function:
  - Guard: return early if `isProcessing.value === true`
  - Flip `planMode.value`
  - Call `wsSend({ type: 'set_plan_mode', enabled: planMode.value, conversationId })`
- Add plan mode badge to message rendering (append `(Plan)` to role label when `msg.planMode === true`)
- When sending messages via `sendMessage()`, tag the message object with `planMode: planMode.value` for badge display
- Disable plan toggle button when `isProcessing` is true

**`index.html`**:
- Add plan mode toggle button in `.input-bottom-left` div
- Add plan mode banner element above `.input-card`

**`css/input.css`**:
- Styles for `.plan-mode-btn`, `.plan-mode-btn.active`
- Styles for `.plan-mode-banner` (banner above input)
- Style for `.input-card.plan-mode` (border accent)

**`css/chat.css`**:
- Style for `.plan-badge` on message role labels

**`modules/connection.js`**:
- Handle incoming `plan_mode_changed` message from agent: sync `planMode` ref state (confirmation that mode switch succeeded)

#### 2. Server (`server/src/`)

**No changes needed.** The server is a transparent relay. `set_plan_mode` messages pass through from web to agent, and `plan_mode_changed` messages pass through from agent to web.

#### 3. Agent (`agent/src/`)

**`claude.ts`**:

- Add `permissionMode` field to `ConversationState`:
  ```typescript
  interface ConversationState {
    // ... existing fields ...
    permissionMode: 'bypassPermissions' | 'plan';
  }
  ```
  Default: `'bypassPermissions'`

- In `startQuery()`, replace hardcoded permission mode:
  ```typescript
  // Before:
  '--permission-mode', 'bypassPermissions',
  // After:
  '--permission-mode', state.permissionMode,
  ```

- Add `setPermissionMode()` export:
  ```typescript
  export function setPermissionMode(
    conversationId: string | undefined,
    mode: 'bypassPermissions' | 'plan',
  ): void {
    const convId = conversationId || DEFAULT_CONVERSATION_ID;
    const conv = conversations.get(convId);
    if (conv) {
      conv.permissionMode = mode;
      // Kill current process; next handleChat() will respawn with new mode
      cleanupConversation(convId);
      // Re-create state entry with preserved session ID for resume
      conversations.set(convId, {
        ...createDefaultState(convId, conv.workDir),
        permissionMode: mode,
        lastClaudeSessionId: conv.claudeSessionId || conv.lastClaudeSessionId,
      });
    }
  }
  ```

**`connection.ts`**:

- Add `case 'set_plan_mode'` to the message switch:
  ```typescript
  case 'set_plan_mode': {
    const { enabled, conversationId } = msg as unknown as {
      enabled: boolean;
      conversationId?: string;
    };
    const mode = enabled ? 'plan' : 'bypassPermissions';
    setPermissionMode(conversationId, mode);
    send({ type: 'plan_mode_changed', enabled, conversationId });
    break;
  }
  ```

### WebSocket Protocol Additions

**Web → Agent:**

| Type | Fields | Purpose |
|------|--------|---------|
| `set_plan_mode` | `enabled: boolean`, `conversationId?: string` | Toggle plan mode for a conversation |

**Agent → Web:**

| Type | Fields | Purpose |
|------|--------|---------|
| `plan_mode_changed` | `enabled: boolean`, `conversationId?: string` | Confirm mode switch succeeded |

## Edge Cases

1. **Toggle during processing**: Button is disabled. User must Stop first.
2. **No active conversation**: Mode is stored, applied when next `startQuery()` fires.
3. **Page refresh**: `planMode` UI state resets to false (Normal Mode). This is intentional — safe default. The claude process is killed on disconnect anyway, so next spawn uses whatever mode the UI says.
4. **Multi-conversation**: `permissionMode` is per-conversation in `ConversationState`. Each tab/conversation can independently be in Plan or Normal mode. The web UI tracks a single global `planMode` toggle that applies to the active conversation.
5. **Resume session**: When resuming a historical session, mode resets to Normal (default). User can toggle Plan Mode after resuming if desired.

## CSS Variables

Add to the theme system:

```css
/* Dark theme */
--plan-mode: #d4a24c;         /* reuse --warning amber */
--plan-mode-bg: rgba(212, 162, 76, 0.1);

/* Light theme */
--plan-mode: #d97706;
--plan-mode-bg: rgba(217, 119, 6, 0.08);
```

## Out of Scope

- **Plan approval UI** (structured plan card with approve/reject buttons): Not needed. Users read chat output and manually switch modes.
- **Server-side mode tracking**: Server remains a transparent relay. No mode state stored on server.
- **Persisting mode preference**: Mode resets on page refresh. No localStorage persistence needed for now.
- **ExitPlanMode tool handling**: Claude Code's `ExitPlanMode` tool is part of its internal system prompt in plan permission mode. We don't need to intercept or handle it specially — it works within the claude subprocess.
