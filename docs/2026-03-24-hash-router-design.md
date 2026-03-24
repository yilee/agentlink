# Hash Router — URL-Driven Page State

## Problem

When users navigate away from the AgentLink page (e.g., accidentally clicking a link) and return, the app resets to a blank chat. All view state is stored in in-memory Vue refs and lost on refresh. The URL only encodes the session ID (`/s/<sessionId>`), not which view or conversation the user was looking at.

## Goal

Encode the current view state in the URL hash so that:
- Refreshing the page restores the exact view (team dashboard, loop detail, recap chat, etc.)
- Browser back/forward navigates between views
- URLs are shareable — opening a URL jumps directly to the correct view
- New views can register their own URL patterns with minimal boilerplate

## Approach: Hash Router

Use `location.hash` to store view state: `/s/<sessionId>#/team/agent/abc123`

**Why hash, not query params or vue-router:**
- Hash changes don't trigger page refresh or server requests
- Server routes (`/s/:sessionId`, `/ms/:sessionId`) require zero changes
- `hashchange` event gives us browser back/forward for free
- No external dependency (no vue-router)

## URL Schema

```
#/                                          → Chat (default)
#/chat/<claudeSessionId>                    → Resume historical session
#/team                                      → Team dashboard
#/team/agent/<agentId>                      → Agent detail view
#/team/history/<teamId>                     → Historical team view
#/loop                                      → Loop list
#/loop/<loopId>                             → Loop detail + execution history
#/loop/<loopId>/exec/<executionId>          → Execution replay
#/recap                                     → Recap feed
#/recap/<recapId>                           → Recap detail
#/recap/<recapId>/chat                      → New recap chat
#/recap/<recapId>/chat/<claudeSessionId>    → Resume recap chat session
```

Routes not listed here render the default chat view. Unknown routes are silently ignored (no crash, no redirect).

## Architecture

### New file: `server/web/src/modules/router.js`

A lightweight module (~100 lines) that provides:

1. **Route registry** — each module registers its own routes
2. **Hash → state restoration** — on page load or `hashchange`, match the hash against registered routes and call the appropriate handler
3. **State → hash sync** — when view state changes, update the hash (without triggering a restore loop)

```
┌──────────────┐    watch refs    ┌──────────────┐    location.hash
│  Vue State   │ ───────────────→ │   router.js  │ ──────────────→ URL bar
│  (refs)      │ ←─────────────── │              │ ←────────────── browser
└──────────────┘  restore state   └──────────────┘    hashchange
```

### API

```javascript
// router.js exports
export function createRouter() {
  return {
    // Register a route pattern with a handler
    // pattern: string like '/team/agent/:agentId'
    // handler: (params) => void — called to restore state
    addRoute(pattern, handler),

    // Update the hash from current state (called by watchers)
    // Suppresses the next hashchange to avoid restore loop
    push(path),

    // Replace current hash without adding history entry
    replace(path),

    // Start listening to hashchange + restore initial hash
    start(),

    // Stop listening (cleanup)
    stop(),
  };
}
```

### Route pattern matching

Simple colon-prefix params: `/team/agent/:agentId` matches `/team/agent/abc123` and extracts `{ agentId: 'abc123' }`.

No regex, no wildcards, no query strings — just static segments and `:param` segments. This keeps the router tiny and predictable.

### Integration pattern (per module)

Each module registers its own routes during initialization. Example for team.js:

```javascript
// In createTeam(deps):
const { router } = deps;

// Register routes this module owns
router.addRoute('/team', () => {
  viewMode.value = 'team';
  activeAgentView.value = null;
});
router.addRoute('/team/agent/:agentId', ({ agentId }) => {
  viewMode.value = 'team';
  activeAgentView.value = agentId;
});
router.addRoute('/team/history/:teamId', ({ teamId }) => {
  viewMode.value = 'team';
  viewHistoricalTeam(teamId);
});

// Sync state → hash
watch(activeAgentView, (id) => {
  if (viewMode.value !== 'team') return;
  router.push(id ? `/team/agent/${id}` : '/team');
});
```

### Circular-update prevention

When the router restores state from hash, the watchers fire and try to push a new hash. This is prevented by a simple flag:

```javascript
let _restoring = false;

function push(path) {
  if (_restoring) return;  // Ignore pushes triggered by restore
  _suppressNext = true;
  location.hash = '#' + path;
}

function _onHashChange() {
  if (_suppressNext) { _suppressNext = false; return; }
  _restore();
}

function _restore() {
  _restoring = true;
  // ... match route, call handler ...
  nextTick(() => { _restoring = false; });
}
```

## Incremental Implementation Plan

The architecture supports adding routes one module at a time. Each phase is independently shippable.

### Phase 1: Router core + primary navigation (viewMode)

**Files:** `router.js` (new), `store.js`, `team.js`

Create the router module with `addRoute`, `push`, `replace`, `start`, `stop`. Register the four top-level view modes:

| Hash | State |
|------|-------|
| `#/` | `viewMode = 'chat'` |
| `#/team` | `viewMode = 'team'` |
| `#/loop` | `viewMode = 'loop'` |
| `#/recap` | `viewMode = 'feed'`, `currentView = 'recap-feed'` |

Wire up in `store.js`:
- Create router in `createStore()`
- Pass `router` to modules via deps
- Call `router.start()` in `onMounted` after WebSocket connects
- Add `viewMode` watcher that pushes hash

**Result:** Refreshing the page while on the Team dashboard returns to Team dashboard instead of blank chat.

### Phase 2: Chat session resumption

**Files:** `router.js` (routes), `sidebar.js`, `store.js`

Add route: `#/chat/<claudeSessionId>`

On restore:
- Call `sidebar.resumeSession({ sessionId: claudeSessionId })`
- This reuses existing resume infrastructure (sends `resume_conversation`, gets history back)

On state change:
- Watch `currentClaudeSessionId` — push `#/chat/<id>` when set, `#/` when cleared

**Result:** Refreshing during a conversation auto-resumes it. Copying the URL and opening in another tab loads the same conversation.

### Phase 3: Team agent detail + historical teams

**Files:** `team.js`

Add routes:
- `#/team/agent/:agentId` → `viewAgent(agentId)`
- `#/team/history/:teamId` → `viewHistoricalTeam(teamId)`

**Result:** Deep-linking to a specific agent's detail view within the team dashboard.

### Phase 4: Loop detail + execution replay

**Files:** `loop.js`

Add routes:
- `#/loop/:loopId` → `viewLoopDetail(loopId)`
- `#/loop/:loopId/exec/:execId` → `viewExecution(loopId, execId)`

**Result:** Refreshing on a loop execution replay returns to that exact view.

### Phase 5: Recap feed + recap chat

**Files:** `recap.js`

Add routes:
- `#/recap/:recapId` → `selectRecap(recapId)`
- `#/recap/:recapId/chat` → `enterRecapChat(recapId)`
- `#/recap/:recapId/chat/:sessionId` → `enterRecapChatSession(recapId, sessionId)`

**Result:** Full recap navigation preserved across refresh.

### Future phases

New features register their own routes in their module — no changes to router.js core needed. Examples:
- `#/memory/:filePath` — memory file viewer
- `#/git/:ref` — git panel deep link
- `#/extensions/:extId` — extension detail

## Edge Cases

### WebSocket not yet connected

Route restoration may fire before the WebSocket is authenticated. The router should **defer restoration** until after `handleConnected()` completes. Implementation: `router.start()` is called inside the connected handler, not on mount.

### Invalid route parameters

If a `claudeSessionId` or `agentId` in the URL no longer exists, the module's route handler will attempt to load it and get an error or empty result. Each module handles this gracefully (shows "not found" or falls back to list view). The router itself does not validate params.

### Hash present on first load with `/ms/` route

The `/ms/<sessionId>` route enables brain mode. The router must not interfere with this server-side route detection. Since we only read `location.hash` (not `location.pathname`), this is fine — they're orthogonal.

### Multi-conversation (parallel sessions)

`conversationId` is a client-generated UUID for multiplexing parallel sessions. It's **not** included in the URL because:
- It's ephemeral (regenerated each page load)
- The `claudeSessionId` is sufficient to resume the right conversation
- Including `conversationId` would create URLs that break on refresh

## Files Modified

| File | Change |
|------|--------|
| `server/web/src/modules/router.js` | **New.** Route registry, hash sync, pattern matching |
| `server/web/src/store.js` | Create router, pass to modules, call `start()` on connect |
| `server/web/src/modules/team.js` | Register team routes, sync `activeAgentView` to hash |
| `server/web/src/modules/loop.js` | Register loop routes, sync `selectedLoop`/`selectedExecution` |
| `server/web/src/modules/recap.js` | Register recap routes, sync recap state |
| `server/web/src/modules/sidebar.js` | Register `#/chat/:sessionId` route |

Server-side: **zero changes**.

## Testing

- **Unit tests** (`test/web/router.test.js`): Pattern matching, circular-update prevention, push/replace
- **Functional tests** (`test/functional/`): Add a `hash-router` test suite — navigate to URL with hash, verify correct view renders
- **Manual E2E**: Navigate to team view → refresh → verify team view restored; resume session → refresh → verify conversation restored; use back/forward buttons
