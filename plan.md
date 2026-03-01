# AgentLink Roadmap

## Planned Features

### Context / Usage Display
- [ ] Extract token usage from Claude CLI `result` message (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `total_cost_usd`)
- [ ] Accumulate usage per session in agent (`ConversationState.usage`)
- [ ] Send usage data to web UI (via `turn_completed` or new `usage_update` message)
- [ ] Display cumulative token usage and cost in UI (top bar or sidebar)
- [ ] Approximate context window progress bar (estimated % used, reset on compaction)

### Terminal Panel
- [ ] Agent: integrate node-pty for PTY subprocess management
- [ ] Agent: terminal create/input/resize/close message handlers
- [ ] Web UI: xterm.js terminal component in workbench panel
- [ ] WebSocket message types: `terminal_create`, `terminal_input`, `terminal_output`, `terminal_resize`, `terminal_close`

### File Panel
- [ ] Agent: `read_file` / `write_file` / `list_directory` handlers for workbench
- [ ] Web UI: file browser tree in workbench panel
- [ ] Web UI: file viewer/editor (CodeMirror integration)
- [ ] Web UI: binary file preview (images, etc.)

### Git Panel
- [ ] Agent: git operations (`git_status`, `git_diff`, `git_log`, etc.)
- [ ] Web UI: git status/diff/log display in workbench panel

### Port Forwarding / Proxy
- [ ] Agent: HTTP + WebSocket port forwarding
- [ ] Web UI: proxy port management UI

---

## Optimization & Bug Fixes

### P0 — Critical Bugs

#### Heartbeat Loop Early Exit (`server/src/index.ts`)
- [ ] Fix heartbeat callback using `return` instead of `continue` — only the first dead connection per type gets cleaned up per interval, causing memory leaks and stale state

#### `toolMsgMap` Memory Leak (`server/web/modules/connection.js`)
- [ ] Clear `toolMsgMap` on `turn_completed` — currently only cleared on `conversation_resumed` and `workdir_changed`, grows indefinitely in long sessions

### P1 — Important

#### Synchronous I/O in History (`agent/src/history.ts`)
- [ ] Convert `listSessions()` to use async fs APIs (`readdir`, `stat`, `readFile`)
- [ ] Convert `readSessionMessages()` to use async fs APIs
- [ ] Avoid blocking the event loop when session files are numerous

#### Temp Attachment Cleanup (`agent/src/claude.ts`)
- [ ] Add periodic cleanup of `~/.agentlink/tmp-attachments/` (e.g. delete files older than 24 hours)
- [ ] Run cleanup on agent startup and on a timer interval

#### WebSocket Rate Limiting (`server/src/index.ts`)
- [ ] Add per-IP connection rate limiting for WebSocket upgrades
- [ ] Reject rapid connect/disconnect abuse

#### Silent Encryption Failures (`server/src/encryption.ts`, `agent/src/encryption.ts`)
- [ ] Log a warning on decryption failure (currently returns `null` silently)
- [ ] Include enough context to diagnose key mismatches without leaking secrets

### P2 — Code Quality

#### Deduplicate Encryption Code
- [ ] Extract shared encryption logic from `server/src/encryption.ts` and `agent/src/encryption.ts` into a shared package or common file
- [ ] Keep `server/web/encryption.js` separate (browser-only, uses CDN globals) but ensure algorithm parity

#### Shared Message Type Definitions
- [ ] Define a discriminated union type for all WebSocket message types (shared between server and agent)
- [ ] Replace `as unknown as X` casts in `agent/src/connection.ts` with proper typed message handling
- [ ] Replace magic string literals (`'chat'`, `'turn_completed'`, etc.) with constants or enum

#### Encapsulate `claude.ts` State
- [ ] Refactor module-level mutable state (`conversation`, `lastClaudeSessionId`, `sendFn`, `pendingControlRequests`) into a class or factory
- [ ] Improve testability by eliminating global singletons

#### Consistent Error Handling
- [ ] Create a shared `getErrorMessage(err: unknown): string` utility
- [ ] Replace inconsistent patterns (`(err as Error).message`, `String(err)`, etc.) across codebase

#### Test Coverage Expansion
- [ ] Add unit tests for `agent/src/claude.ts` (subprocess lifecycle, control_request handling, turn management)
- [ ] Add unit tests for `agent/src/connection.ts` (reconnection logic, message routing)
- [ ] Add unit tests for `server/src/ws-agent.ts` (agent registration, message forwarding)
- [ ] Add unit tests for `server/src/ws-client.ts` (web client handling)
- [ ] Add negative/error-path test cases for malformed inputs

### P3 — UX Improvements

#### Session History Search
- [ ] Add a search/filter input in the sidebar for session history
- [ ] Filter sessions by title text match

#### Disconnect/Reconnect Notification
- [ ] Show a toast or inline banner when agent disconnects and reconnects
- [ ] Distinguish between brief blips and sustained outages

#### Daemon Reconnect Strategy (`agent/src/connection.ts`)
- [ ] In daemon mode, use infinite retries with exponential backoff (capped) instead of `process.exit(1)` after max attempts
- [ ] Preserve session URL across restarts so bookmarks remain valid

#### Tool Execution Elapsed Time
- [ ] Track start time of each tool invocation
- [ ] Display elapsed seconds in the tool execution indicator (e.g. "Running... 12s")

#### Vue Error Boundary (`server/web/app.js`)
- [ ] Add `app.config.errorHandler` to catch rendering errors gracefully
- [ ] Display a recoverable error message instead of crashing the UI

#### Mobile Keyboard Layout
- [ ] Audit `100vh`/`100dvh` behavior on mobile when keyboard is open
- [ ] Ensure input area stays visible and accessible

### P4 — Future Considerations

#### Optional Session Authentication
- [ ] Support optional password or token on session URLs for security-sensitive deployments

#### Conversation Export
- [ ] Allow exporting a conversation as Markdown or JSON from the web UI

#### Multi-Tab Synchronization
- [ ] Detect multiple browser tabs on the same session and synchronize input/processing state

#### Express 5 Upgrade
- [ ] Upgrade from Express 4.x to 5.x for native async error handling

#### Web UI TypeScript Migration
- [ ] Incrementally migrate `server/web/` modules to TypeScript (or add JSDoc type annotations)

#### Windows UNC Path Validation (`agent/src/connection.ts`)
- [ ] Reject UNC paths (`\\server\share`) in directory listing and workdir change to prevent network path traversal