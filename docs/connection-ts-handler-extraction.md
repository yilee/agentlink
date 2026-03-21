# Design: Extract Message Handlers from connection.ts

## Motivation

`agent/src/connection.ts` is 748 lines with a 438-line `handleServerMessage()` switch statement (lines 266–703) mixing 30+ message types across 5 domains. The switch is the single biggest function in the agent codebase.

## Strategy

Extract **Team** and **Loop** handler blocks into dedicated files. These are the two largest, purest groups — each is self-contained glue code that delegates to an existing module (`team.js` / `scheduler.js`).

More complex cases (`resume_conversation`, `set_plan_mode`, `query_active_conversations`) stay in `connection.ts` for now — they access multiple modules and module-level state, making extraction riskier with less payoff.

## What Moves

### New file: `agent/src/team-handlers.ts` (~96 lines → ~70 lines of logic)

7 cases from the switch:

| Case | Lines | What it does |
|------|-------|--------------|
| `create_team` | 422–435 | Call `createTeam()`, send `loop_created` or error |
| `dissolve_team` | 436–438 | Call `dissolveTeam()` |
| `list_teams` | 439–440 | `listTeams()` → send `teams_list` |
| `get_team` | 441–456 | Load active or persisted team → send `team_detail` |
| `get_team_agent_history` | 457–488 | Load agent messages from active or persisted team |
| `delete_team` | 489–502 | Guard active, call `deleteTeam()` |
| `rename_team` | 503–518 | Rename active + persisted, send `team_renamed` |

**Dependencies:** `team.js` functions + `send` + `state.workDir`. Zero access to claude.js or other modules.

### New file: `agent/src/loop-handlers.ts` (~107 lines → ~80 lines of logic)

11 cases from the switch:

| Case | Lines | What it does |
|------|-------|--------------|
| `create_loop` | 520–543 | Call `createLoop()` |
| `update_loop` | 544–568 | Call `updateLoop()` |
| `delete_loop` | 569–579 | Call `deleteLoop()` |
| `list_loops` | 580–581 | `listLoops()` → send `loops_list` |
| `get_loop` | 582–591 | `getLoop()` → send `loop_detail` |
| `run_loop` | 592–600 | `runLoopNow()` |
| `cancel_loop_execution` | 601–605 | `cancelLoopExecution()` |
| `list_loop_executions` | 606–611 | `listLoopExecutions()` |
| `get_loop_execution_messages` | 612–617 | `getLoopExecutionMessages()` |
| `query_loop_status` | 618–626 | Collect running executions → send `loop_status` |

**Dependencies:** `scheduler.js` functions + `send` + `state.workDir`. Zero access to claude.js or other modules.

## What Stays in connection.ts

Everything else stays: connection lifecycle (`connect`, `doConnect`, `disconnect`, `scheduleReconnect`), module state, `send()`, and the following switch cases:

- `chat`, `cancel_execution` — core claude.js interaction
- `resume_conversation` — complex multi-module logic (55 lines)
- `set_plan_mode` — complex logic with `setPermissionMode` + conditional re-spawn
- `query_active_conversations` — reads from claude.js + team.js + scheduler.js
- `list_sessions`, `delete_session`, `rename_session` — uses local helper functions
- `new_conversation`, `ask_user_answer`, `btw_question`, `ping` — 1-3 line delegates
- File/directory/git/memory cases — already delegated to handler files (1-line calls)

## Handler Function Signature

Follow the established pattern from `directory-handlers.ts` and `git-handlers.ts`:

```typescript
type SendFn = (msg: Record<string, unknown>) => void;

// Each handler takes the typed message, workDir, and send callback
export function handleCreateTeam(
  msg: { instruction: string; template?: string; ... },
  workDir: string,
  send: SendFn,
): void;
```

The switch in `connection.ts` becomes a 1-line call per case, matching the existing file/git pattern:

```typescript
case 'create_team':
  handleCreateTeam(msg as unknown as { ... }, state.workDir, send);
  break;
```

## Changes

### New file: `agent/src/team-handlers.ts`

```typescript
import { createTeam, dissolveTeam, getActiveTeam, loadTeam, listTeams,
         deleteTeam, renameTeam, serializeTeam, type TeamConfig } from './team.js';

type SendFn = (msg: Record<string, unknown>) => void;

export function handleCreateTeam(...) { ... }
export function handleDissolveTeam(...) { ... }
export function handleListTeams(...) { ... }
export function handleGetTeam(...) { ... }
export function handleGetTeamAgentHistory(...) { ... }
export function handleDeleteTeam(...) { ... }
export function handleRenameTeam(...) { ... }
```

### New file: `agent/src/loop-handlers.ts`

```typescript
import { createLoop, updateLoop, deleteLoop, listLoops, getLoop,
         runLoopNow, cancelLoopExecution, listLoopExecutions,
         getLoopExecutionMessages, getRunningExecutions } from './scheduler.js';

type SendFn = (msg: Record<string, unknown>) => void;

export function handleCreateLoop(...) { ... }
export function handleUpdateLoop(...) { ... }
export function handleDeleteLoop(...) { ... }
export function handleListLoops(...) { ... }
export function handleGetLoop(...) { ... }
export function handleRunLoop(...) { ... }
export function handleCancelLoopExecution(...) { ... }
export function handleListLoopExecutions(...) { ... }
export function handleGetLoopExecutionMessages(...) { ... }
export function handleQueryLoopStatus(...) { ... }
```

### Modified: `agent/src/connection.ts`

1. Add imports from `./team-handlers.js` and `./loop-handlers.js`
2. Remove team.js imports that are only used in the extracted handlers (`createTeam`, `dissolveTeam`, `getActiveTeam`, `loadTeam`, `listTeams`, `deleteTeam`, `renameTeam`, `serializeTeam`, `type TeamConfig`)
3. Remove scheduler.js imports that are only used in extracted handlers (`createLoop`, `updateLoop`, `deleteLoop`, `listLoops`, `getLoop`, `runLoopNow`, `cancelLoopExecution`, `listLoopExecutions`, `getLoopExecutionMessages`) — keep `initScheduler`, `shutdownScheduler`, `getRunningExecutions` (used in `connect()` and `query_active_conversations`)
4. Replace 18 switch cases with 1-line handler calls

**Net reduction:** ~200 lines removed from `connection.ts` (748 → ~548)

## Risk Assessment

- **Zero runtime behavior change** — same logic, different file
- **Zero API change** — `handleServerMessage` is private, no exports affected
- **Low coupling** — team/loop handlers only depend on their respective modules + `send` + `workDir`
- **Follows established pattern** — identical to existing `directory-handlers.ts` / `git-handlers.ts`
- **Easy to verify** — build + existing functional tests cover all message types

## Verification

```bash
npm run build    # TypeScript compilation
npm test         # Unit tests
npm run test:functional   # Functional tests (cover team + loop message handling)
```
