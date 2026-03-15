# Multi-Provider Architecture Refactoring

## Overview

AgentLink currently hardcodes Claude CLI as the sole AI backend. This document outlines an incremental refactoring plan to support multiple AI backends (Claude, Codex, and future tools) through a **capability-driven provider abstraction**.

## Design Principles

1. **Capability-driven, not feature-parity** — Each provider declares what it supports. The UI adapts. No provider is forced to implement features it doesn't have (e.g., Codex doesn't need Plan mode or `/btw`).
2. **Chat is the universal core** — Every provider must support basic chat (send prompt, stream response, show tools). Everything else (Plan mode, slash commands, Team, Loop, file attachments) is optional.
3. **Incremental migration** — Each phase is a standalone, shippable milestone. Existing Claude functionality must never break.
4. **UI follows capabilities** — Frontend dynamically shows/hides features based on the active provider's declared capabilities. No hardcoded "if provider === claude" checks.

---

## Research: OpenAI Codex CLI

### What is Codex?

Codex is OpenAI's open-source CLI agent ([github.com/openai/codex](https://github.com/openai/codex)). It's a Rust-based tool that runs locally and uses OpenAI models to perform coding tasks with file/shell access.

### Execution Modes

| Mode | Command | Description |
|------|---------|-------------|
| Interactive TUI | `codex` | Fullscreen terminal UI (Ratatui) |
| Non-interactive | `codex exec "prompt"` | Headless, progress to stderr, result to stdout |
| App server | `codex app-server` | JSON-RPC 2.0 over stdio or WebSocket |
| MCP server | `codex mcp-server` | Exposes Codex as MCP tool for other agents |
| SDK | `@openai/codex-sdk` | TypeScript library |

**Best integration option for AgentLink**: `codex exec --json` (JSONL streaming) for simple cases, or `codex app-server` (JSON-RPC 2.0) for full-featured integration.

### Output Format

With `--json` flag, Codex emits JSONL events:
- `thread.started`, `turn.started`, `turn.completed`, `turn.failed`
- `item.started`, `item.completed`
- `error`

App server provides richer streaming: `item/agentMessage/delta`, `item/commandExecution/outputDelta`, etc.

### Session Persistence

- `codex resume` / `codex resume --last` resumes previous sessions
- `codex exec resume <SESSION_ID> "prompt"` for non-interactive resume
- App server: `thread/resume`, `thread/fork`, `thread/list`, `thread/rollback`, `thread/compact/start`
- `--ephemeral` disables persistence

### Multi-Agent Support

Native multi-agent (experimental, `features.multi_agent = true` in config.toml):
- Spawns sub-agents in parallel, up to `max_threads = 6`
- Built-in roles: `default`, `worker`, `explorer`, `monitor`, plus custom roles
- Each role can have its own model, sandbox, instructions, MCP servers
- `spawn_agents_on_csv` for fan-out processing

### Tool Use & Permissions

- Approval modes: `untrusted` (ask for everything), `on-request` (auto unless model requests), `never`
- Sandbox modes: `read-only`, `workspace-write`, `danger-full-access`
- `--full-auto` = `on-request` + `workspace-write`

### Comparison with Claude CLI

| Capability | Claude CLI | Codex CLI |
|-----------|------------|-----------|
| Process model | Long-running subprocess, stdin/stdout JSON lines | `exec --json` (JSONL) or `app-server` (JSON-RPC 2.0) |
| Streaming format | `stream-json` (assistant/user/system/result messages) | JSONL events (thread/turn/item lifecycle) |
| Session resume | `--resume <sessionId>` | `resume <sessionId>` or `thread/resume` |
| Multi-agent | `--agents <JSON>`, Lead calls `Agent` tool | Config-based roles, built-in orchestration |
| Permissions | `--permission-mode bypassPermissions` + `--permission-prompt-tool stdio` | `--ask-for-approval never` + `--sandbox workspace-write` |
| Interactive tools | `control_request` → `AskUserQuestion` via stdin/stdout | App server approval protocol |
| Session files | `~/.claude/projects/<folder>/<sessionId>.jsonl` | `~/.codex/sessions/` (SQLite-backed) |

---

## Feature Capability Matrix

Not every provider needs every feature. The architecture must flexibly support providers with different capability sets.

| Feature | Claude | Codex | Trigger | UI Gating |
|---------|--------|-------|---------|-----------|
| **Chat (send/receive)** | YES | YES | User types message | Always shown (universal core) |
| **Session history** | YES | YES | Sidebar list | Always shown |
| **Session resume** | YES | YES | Click history item | Always shown |
| **Streaming text** | YES | YES | Agent response | Always shown |
| **Tool use display** | YES | YES | Agent uses tools | Always shown (unknown tools get generic rendering) |
| **Plan mode** | YES | No | Toggle button in input | Hide button if `!capabilities.planMode` |
| **Slash commands** | YES | No | `/` menu in input | Filter commands by `capabilities.slashCommands[]` |
| **/btw side question** | YES | No | `/btw` command | Hide if `!capabilities.btw` |
| **Context compaction** | YES | ? | Agent-initiated + `/compact` | Hide `/compact` if `!capabilities.contextCompaction`; agent messages are harmless if absent |
| **AskUserQuestion** | YES | Partial | Agent sends interactive prompt | Card only renders when message arrives; safe if absent |
| **File attachments** | YES | ? | Paperclip button | Hide button if `!capabilities.fileAttachments` |
| **Usage/cost display** | YES | ? | `turn_completed` payload | Already conditional on data presence |
| **Team** | YES | Possible | Team panel | Hide team UI if `!capabilities.team` |
| **Loop** | YES | Possible | Loop panel | Hide loop UI if `!capabilities.loop` |
| **"Claude" branding** | — | — | Hardcoded text | Replace with `provider.displayName` |

**Key insight:** Most agent-initiated features (AskUserQuestion, context compaction, usage stats) are already "safe" — the UI only activates when the corresponding message arrives. The main work is gating **user-initiated** features (buttons, commands, toggles) behind capability flags.

---

## Claude-Specific UI Touchpoints (Frontend Audit)

### User-Initiated (need button hiding)

| Feature | Files | Gating |
|---------|-------|--------|
| Plan mode toggle | `ChatInput.vue` (button), `store.js` (`togglePlanMode()`) | Hide button |
| Slash command menu | `ChatInput.vue` (button), `useSlashMenu.js` (`SLASH_COMMANDS`) | Filter array by capabilities |
| File attachment | `ChatInput.vue` (paperclip, drag-drop, paste) | Hide button, disable drag-drop |
| `/btw` side question | `ChatInput.vue`, `BtwOverlay.vue` | Hide command entry |
| `/compact` command | `useSlashMenu.js` | Hide command entry |
| Team creation | `Sidebar.vue`, `TeamView.vue` | Hide team section |
| Loop creation | `Sidebar.vue`, `LoopView.vue` | Hide loop section |

### Agent-Initiated (safe if absent, no gating needed)

| Feature | Files | Why it's safe |
|---------|-------|---------------|
| AskUserQuestion card | `AskQuestionCard.vue`, `execution-handler.js` | Card only appears when `ask_user_question` message arrives |
| Context compaction spinner | `ChatView.vue`, `execution-handler.js` | Only renders when `context_compaction` message arrives |
| Usage/cost bar | `ChatInput.vue` | Only renders when `usageStats` is truthy |
| Plan mode divider | `ToolBlock.vue` | Only renders for `EnterPlanMode`/`ExitPlanMode` tool names |
| Context summary collapse | `ChatView.vue`, `messageHelpers.js` | String-match heuristic; harmless for non-Claude |
| Tool icons/summaries | `messageHelpers.js`, `markdown.js` | Unknown tools get generic rendering |

### Hardcoded Branding (cosmetic fixes)

| Location | Current | Fix |
|----------|---------|-----|
| `ChatView.vue` assistant label | `{{ t('chat.claude') }}` | Use `provider.displayName` |
| `en.json` locale keys | `"chat.claude": "Claude"` | Add provider-aware key |
| File browser context menu | `"Ask Claude to read"` | `"Ask {agent} to read"` |
| `appHelpers.js` | Strips `claude-` prefix from model name | Generic model name display |

---

## Refactoring Plan

### Phase 1: Define Provider Interface & Capabilities

**Goal:** Create the type contracts — `AIProvider` interface, `UnifiedEvent` stream, and fine-grained `ProviderCapabilities`.

**What to do:**
- Create `agent/src/providers/types.ts`

**AIProvider interface:**

```typescript
interface AIProvider {
  readonly name: string;          // 'claude' | 'codex' | ...
  readonly displayName: string;   // 'Claude' | 'Codex' | ...

  // === Universal core (every provider MUST implement) ===

  // Chat
  startTurn(opts: TurnOptions): AsyncIterable<UnifiedEvent>;
  cancelTurn(conversationId: string): Promise<void>;

  // Session management
  listSessions(workDir: string): Promise<SessionInfo[]>;
  readSessionHistory(workDir: string, sessionId: string): Promise<HistoryMessage[]>;
  resumeSession(sessionId: string): AsyncIterable<UnifiedEvent>;

  // Lifecycle
  cleanup(): Promise<void>;
  clearSession(): void;

  // Capabilities declaration
  capabilities: ProviderCapabilities;

  // === Optional capabilities (implement if capabilities flag is true) ===

  // Interactive prompts — only if capabilities.askUser
  respondToPrompt?(requestId: string, answers: Record<string, string>): Promise<void>;

  // Plan mode — only if capabilities.planMode
  setPlanMode?(enabled: boolean, conversationId: string, sessionId: string): void;

  // Slash commands — only if capabilities.slashCommands.length > 0
  getSlashCommands?(): SlashCommandDef[];

  // BTW side question — only if capabilities.btw
  startBtwQuestion?(prompt: string, workDir: string): AsyncIterable<UnifiedEvent>;

  // Team — only if capabilities.team
  startTeam?(opts: TeamOptions): AsyncIterable<UnifiedEvent>;
  getTeamObserver?(): TeamOutputObserver;

  // Loop — only if capabilities.loop
  // (Uses startTurn() internally, but provider may need custom setup)
}

interface TurnOptions {
  conversationId: string;
  prompt: string;
  workDir: string;
  resumeSessionId?: string;
  files?: ChatFile[];       // Only used if capabilities.fileAttachments
}
```

**Capabilities — fine-grained, each flag controls a specific UI element:**

```typescript
interface ProviderCapabilities {
  // Session
  resume: boolean;                 // Can resume previous sessions

  // Chat sub-features
  planMode: boolean;               // Plan mode toggle button
  askUser: boolean;                // Interactive AskUserQuestion prompts
  fileAttachments: boolean;        // File upload with messages
  contextCompaction: boolean;      // Context compaction support
  btw: boolean;                    // /btw side question support
  usageStats: boolean;             // Cost/token usage reporting

  // Slash commands — list of available commands (empty = no slash menu)
  slashCommands: string[];         // e.g., ['cost', 'context', 'compact'] for Claude; [] for Codex

  // Extended features
  team: boolean;                   // Multi-agent team orchestration
  loop: boolean;                   // Scheduled recurring tasks
}
```

**Example capability declarations:**

```typescript
// Claude provider
const claudeCapabilities: ProviderCapabilities = {
  resume: true,
  planMode: true,
  askUser: true,
  fileAttachments: true,
  contextCompaction: true,
  btw: true,
  usageStats: true,
  slashCommands: ['cost', 'context', 'compact'],
  team: true,
  loop: true,
};

// Codex provider
const codexCapabilities: ProviderCapabilities = {
  resume: true,
  planMode: false,
  askUser: false,       // Could be true with app-server integration
  fileAttachments: false,
  contextCompaction: false,
  btw: false,
  usageStats: false,
  slashCommands: [],
  team: false,          // Could be true later with multi-agent config
  loop: true,           // Can use codex exec for headless runs
};
```

**UnifiedEvent types:**

```typescript
type UnifiedEvent =
  // --- Universal (all providers) ---
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; tools: ToolInfo[] }
  | { type: 'tool_result'; toolUseId: string; content: any }
  | { type: 'turn_completed'; usage?: UsageStats }
  | { type: 'turn_failed'; error: string }
  | { type: 'session_id'; sessionId: string }
  | { type: 'error'; message: string }

  // --- Optional (only emitted if provider supports the capability) ---
  | { type: 'ask_user'; requestId: string; questions: Question[] }
  | { type: 'context_compaction'; status: 'started' | 'completed' }
  | { type: 'team_agent_spawned'; agentId: string; role: string; task: string }
  | { type: 'team_agent_completed'; agentId: string; result?: any; error?: string }
  | { type: 'team_agent_output'; agentId: string; event: UnifiedEvent }
```

**Files:** `agent/src/providers/types.ts`

**No behavior changes.** Pure type definitions.

---

### Phase 2: Extract Claude Provider

**Goal:** Move all Claude-specific logic into `providers/claude/`, implement `AIProvider`. Wire up the registry.

**What to do:**

1. Create `agent/src/providers/claude/` directory
2. Split and move:
   - `claude.ts` (~1100 lines) → split into:
     - `providers/claude/adapter.ts` — implements `AIProvider`, public API surface
     - `providers/claude/process.ts` — subprocess management, stdin/stdout JSON line parsing, control_request handling
     - `providers/claude/protocol.ts` — Claude-specific message type constants and interfaces
   - `sdk.ts` → `providers/claude/sdk.ts` (executable discovery)
   - `history.ts` → `providers/claude/history.ts` (JSONL session file parsing)
3. Create `agent/src/providers/registry.ts` — provider selection by config, lazy initialization
4. Update `connection.ts` — replace direct `claude.ts` imports with provider registry calls
5. Optionally extract `team.ts`'s `onLeadOutput()` → `providers/claude/team-observer.ts`

**Resulting directory structure:**

```
agent/src/
├── providers/
│   ├── types.ts              # From Phase 1
│   ├── registry.ts           # Provider selection + lifecycle
│   └── claude/
│       ├── adapter.ts        # AIProvider implementation
│       ├── process.ts        # Subprocess + stdio parsing
│       ├── protocol.ts       # Message type constants
│       ├── sdk.ts            # Executable discovery
│       ├── history.ts        # JSONL session parsing
│       └── team-observer.ts  # Team output observer (optional, if Team refactored)
├── connection.ts             # Now calls provider via registry
└── ...
```

**Critical constraint:** All existing tests must still pass. Pure structural refactor — behavior is identical.

---

### Phase 3: Capability-Driven Frontend

**Goal:** Make the web UI dynamically adapt to the active provider's capabilities. No hardcoded "Claude" assumptions.

**What to do:**

**3a. Deliver capabilities to the frontend:**
- When agent connects, include `capabilities` and `displayName` in the registration data
- Server relays this to web clients in the `connected` message payload
- `store.js` stores `providerCapabilities` ref and `providerDisplayName` ref

**3b. Gate user-initiated features:**

```javascript
// ChatInput.vue
const showPlanToggle = computed(() => providerCapabilities.value?.planMode)
const showAttachButton = computed(() => providerCapabilities.value?.fileAttachments)
const showSlashMenu = computed(() => providerCapabilities.value?.slashCommands?.length > 0)

// useSlashMenu.js — filter commands
const availableCommands = SLASH_COMMANDS.filter(cmd =>
  providerCapabilities.value?.slashCommands?.includes(cmd.name)
)

// Sidebar.vue
const showTeamSection = computed(() => providerCapabilities.value?.team)
const showLoopSection = computed(() => providerCapabilities.value?.loop)
```

**3c. Replace hardcoded branding:**
- Assistant label: `{{ t('chat.claude') }}` → `{{ providerDisplayName }}`
- Context menu: `"Ask Claude to read"` → `"Ask {providerDisplayName} to read"`
- Model name formatting: make the `claude-` prefix strip conditional

**3d. Rename handler (cosmetic):**
- `claude-output-handler.js` → `agent-output-handler.js`
- `currentClaudeSessionId` → `currentSessionId` in `store.js`

**Note:** Agent-initiated features (AskUserQuestion, compaction, usage) don't need gating — they're already safe. The UI only activates when the corresponding message arrives from the agent.

---

### Phase 4: Session History Abstraction

**Goal:** Session listing and history reading work through the provider interface.

**What to do:**

1. `AIProvider` already defines `listSessions()` and `readSessionHistory()` (Phase 1)
2. Claude provider implements these using existing JSONL logic (moved in Phase 2)
3. Update `connection.ts`:
   - `list_sessions` → calls `provider.listSessions(workDir)`
   - `resume_conversation` → calls `provider.readSessionHistory()` then `provider.resumeSession()`
4. Add `provider` field to `SessionInfo` for future multi-provider session listing

```typescript
interface SessionInfo {
  id: string;
  title: string;
  lastModified: Date;
  provider: string;       // 'claude' | 'codex'
  messageCount?: number;
}
```

**Stretch:** Show sessions from all installed providers in the sidebar, with a provider icon/badge.

---

### Phase 5: Provider Discovery & Configuration

**Goal:** Auto-detect installed AI backends, let users choose.

**What to do:**

1. `registry.ts` enhanced:
   - On startup, probe for installed backends: `claude --version`, `codex --version`
   - Report available providers to the web UI via `available_providers` message
   - Support provider selection via config (`~/.agentlink/config.json` → `"provider": "claude"`)
   - CLI flag: `agentlink-client start --provider codex`

2. New WebSocket message types:
   - `available_providers` (agent → web): `{ providers: [{ name, displayName, version, capabilities }] }`
   - `switch_provider` (web → agent): `{ provider: 'codex' }`

3. Web UI: Provider selector (dropdown) in top bar or settings panel. Switching provider:
   - Clears current conversation
   - Re-initializes the provider
   - Sends updated `capabilities` to frontend
   - Frontend reactively updates all UI gates

---

### Phase 6: Implement Codex Provider

**Goal:** Add a working Codex backend as proof that the abstraction works.

**What to do:**

1. Create `agent/src/providers/codex/`:

```
providers/codex/
├── adapter.ts        # AIProvider using codex exec --json
├── process.ts        # Subprocess + JSONL event parsing
├── sdk.ts            # Executable discovery (codex --version)
└── history.ts        # Session listing from Codex's store
```

2. Event mapping (codex exec --json → UnifiedEvent):

| Codex JSONL Event | UnifiedEvent |
|-------------------|--------------|
| `item.completed` (message, text content) | `text_delta` |
| `item.completed` (function_call) | `tool_use` |
| `item.completed` (function_call_output) | `tool_result` |
| `turn.completed` | `turn_completed` |
| `turn.failed` | `turn_failed` |
| `error` | `error` |

3. Codex capabilities declaration:

```typescript
capabilities: {
  resume: true,
  planMode: false,
  askUser: false,
  fileAttachments: false,
  contextCompaction: false,
  btw: false,
  usageStats: false,
  slashCommands: [],
  team: false,
  loop: true,
}
```

4. What the UI looks like with Codex:
   - Chat input: just a text box + send button (no plan toggle, no slash menu, no paperclip)
   - Sidebar: sessions list only (no team section, no loop section initially)
   - Assistant label: "Codex" instead of "Claude"
   - Tool blocks: generic rendering for Codex's tool names (file_read, shell, etc.)
   - No BtwOverlay, no compaction indicator

**Alternative integration path:** Start with `codex exec --json` (simpler, stable). Upgrade to `codex app-server` (JSON-RPC 2.0) later for streaming deltas and approval protocol, which would enable `askUser: true`.

---

## Directory Structure (Final State)

```
agent/src/
├── cli.ts
├── config.ts
├── connection.ts             # Provider-agnostic — calls registry
├── daemon.ts
├── encryption.ts
├── stream.ts
├── index.ts
├── auto-update.ts
├── service.ts
│
├── providers/
│   ├── types.ts              # AIProvider, UnifiedEvent, ProviderCapabilities
│   ├── registry.ts           # Discovery, selection, lifecycle
│   │
│   ├── claude/
│   │   ├── adapter.ts        # AIProvider implementation
│   │   ├── process.ts        # Subprocess + stdio parsing
│   │   ├── protocol.ts       # Message type constants
│   │   ├── sdk.ts            # Executable discovery
│   │   ├── history.ts        # JSONL session parsing
│   │   └── team-observer.ts  # Team output observer
│   │
│   └── codex/                # Phase 6
│       ├── adapter.ts
│       ├── process.ts
│       ├── sdk.ts
│       └── history.ts
│
├── team.ts                   # Uses provider.getTeamObserver() if capabilities.team
├── scheduler.ts              # Uses provider.startTurn() if capabilities.loop
└── ...

server/web/src/
├── store.js                  # providerCapabilities ref, providerDisplayName ref
├── components/
│   ├── ChatInput.vue         # v-if gates on capabilities (planMode, fileAttachments, slashCommands)
│   ├── Sidebar.vue           # v-if gates on capabilities (team, loop)
│   ├── ChatView.vue          # providerDisplayName for assistant label
│   └── ...
├── modules/
│   ├── handlers/
│   │   ├── agent-output-handler.js   # Renamed from claude-output-handler.js
│   │   └── ...
│   └── ...
└── ...
```

---

## Migration Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Breaking existing Claude functionality | Each phase maintains all existing tests. Phase 2 is pure structural move. |
| `claude.ts` is ~1100 lines, risky to split | Clear split boundary: adapter (public API: startTurn, cancelTurn, etc.) vs process (internals: spawn, parse, control_request). |
| Capabilities flags become stale or inconsistent | Capabilities are declared once in the provider's adapter, sent to frontend on connect. Single source of truth. |
| Over-engineering the abstraction before a second provider exists | Phase 1-4 are refactoring only (Claude still the only provider). The abstraction is validated in Phase 6 when Codex is added. Keep interfaces minimal. |
| Codex CLI is still evolving, API may change | Start with `codex exec --json` (simpler, more stable). Provider is isolated — breaking changes only affect `providers/codex/`. |

---

## Open Questions

1. **App-server vs exec for Codex?** `codex exec --json` is simpler but lacks streaming deltas and approval protocol. `codex app-server` is more capable but adds JSON-RPC complexity. Recommendation: start with `exec`, upgrade later.
2. **Per-conversation provider switching?** Should users be able to use Claude for one conversation and Codex for another simultaneously? This adds complexity (provider instance per conversation). Defer to post-Phase 6.
3. **Tool name normalization?** Claude uses `Read`, `Edit`, `Bash`; Codex uses `file_read`, `shell`, etc. Options: (a) normalize in provider adapter to canonical names, (b) let through as-is and handle in UI with generic rendering. Recommendation: option (b) — keep it simple, unknown tools get generic rendering.
4. **Capabilities evolution?** When a provider gains a new feature (e.g., Codex adds approval support), just flip the capability flag and implement the optional method. No structural changes needed.
