# CLAUDE.md - AgentLink Project Reference

## Project Overview

AgentLink is a local CLI agent that proxies a local working directory to a cloud web interface (`https://msclaude.ai/xxxx`). It is derived from the `claude-web-chat` project (`Q:\src\claude-web-chat`), reusing its architecture, message protocol, and web UI patterns.

## Reference Codebase: claude-web-chat

Path: `Q:\src\claude-web-chat`

### Architecture (Hub & Spoke)

```
Browser (Vue 3 SPA)
    ↕ (Encrypted WebSocket)
Server (Express + ws, port 3456)
    ↕ (Encrypted WebSocket)
Agent(s) (Claude CLI subprocess on worker machines)
    ↕
Local Filesystem
```

### Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Node.js 18+, Express 4.18, ws 8.16 |
| Database | SQLite 3 (better-sqlite3), WAL mode |
| Frontend | Vue 3 (browser ES modules), Pinia, CodeMirror 5 |
| Encryption | TweetNaCl (XSalsa20-Poly1305 secretbox), zlib compression |
| Auth | JWT, bcrypt, speakeasy (TOTP), nodemailer (optional email) |
| Terminal | xterm.js (browser), node-pty (agent, optional) |
| Build | esbuild (frontend), vitest (testing) |
| Service Mgmt | pm2 (Windows), systemd (Linux), launchd (macOS) |

### Project Structure

```
claude-web-chat/
├── server/               # Central WebSocket server (Express + ws)
│   ├── index.js          # Express app init, WebSocket upgrade
│   ├── ws-agent.js       # Agent message handling & routing (873 lines)
│   ├── ws-client.js      # Client message handling & routing (800+ lines)
│   ├── ws-utils.js       # Shared utilities, ownership, encryption (335 lines)
│   ├── auth.js           # JWT, TOTP, email verification
│   ├── database.js       # SQLite schema, CRUD
│   ├── config.js         # Environment var configuration
│   ├── encryption.js     # TweetNaCl wrapper + compression
│   └── microsoft-auth.js # Azure Entra ID auth
├── agent/                # Distributed agent (runs on worker machines)
│   ├── index.js          # Startup, config loading, Claude CLI detection
│   ├── connection.js     # WebSocket connection, auth, message dispatch
│   ├── claude.js         # Claude SDK query, tool execution, output streaming
│   ├── conversation.js   # Session creation/resumption, message handling
│   ├── terminal.js       # PTY terminal (node-pty, optional)
│   ├── workbench.js      # File I/O, git operations, file search
│   ├── history.js        # Load session from JSONL, title resolution
│   ├── proxy.js          # Port forwarding (HTTP + WebSocket)
│   ├── service.js        # System service management (pm2/systemd/launchd)
│   ├── cli.js            # CLI entry point
│   └── sdk/              # Claude SDK wrapper
│       ├── query.js      # Spawn Claude subprocess, manage lifecycle
│       ├── stream.js     # Stream-JSON parser for output
│       ├── types.js      # Message type definitions
│       └── utils.js      # Utility helpers
├── web/                  # Vue 3 frontend SPA
│   ├── main.js           # App entry point
│   ├── stores/
│   │   ├── chat.js       # Pinia store (core state, 300+ lines)
│   │   └── helpers/      # Store action implementations
│   │       ├── websocket.js     # connect(), sendWsMessage(), heartbeat
│   │       ├── messages.js      # addMessage, appendToAssistant, loadHistory
│   │       ├── claudeOutput.js  # Parse tool output, track execution status
│   │       ├── conversation.js  # create/resume/select, send message
│   │       ├── session.js       # localStorage persistence, recovery
│   │       ├── messageHandler.js # Route incoming WebSocket messages
│   │       └── watchdog.js      # Monitor stalled conversations
│   ├── components/       # Vue components (50+ files)
│   │   ├── ChatPage.js   # Main 3-column layout
│   │   ├── ChatHeader.js
│   │   ├── MessageList.js
│   │   ├── ChatInput.js
│   │   ├── WorkbenchPanel.js  # Terminal, Files, Git, Proxy tabs
│   │   └── ...
│   ├── utils/
│   │   └── encryption.js # Client-side encryption
│   └── i18n/             # en.js, zh-CN.js
├── data/                 # SQLite database (runtime)
└── test/                 # Vitest tests
```

### WebSocket Message Protocol

#### Encryption Envelope

```javascript
// Encrypted message format (over WebSocket)
{
  n: "base64-nonce-24-bytes",
  c: "base64-ciphertext",
  z?: true  // optional: data was gzipped before encryption
}

// After decryption → actual message
{
  type: "message_type",
  conversationId: "uuid",
  ...payload
}
```

#### Key Message Types

**Client → Server:**

| Type | Purpose |
|------|---------|
| `select_agent` | User selects an agent |
| `create_conversation` | Create new session |
| `resume_conversation` | Resume from history |
| `execute` / `chat` | Send user prompt to agent |
| `terminal_create/input/resize/close` | Terminal operations |
| `read_file`, `write_file`, `list_directory` | File operations |
| `git_status`, `git_diff`, etc. | Git operations |
| `proxy_update_ports` | Port forwarding control |

**Server → Agent (forwarded):**

Same as above, plus:
| Type | Purpose |
|------|---------|
| `transfer_files` | Forward uploaded files to agent |

**Agent → Server → Client:**

| Type | Purpose |
|------|---------|
| `conversation_created` | New session created |
| `conversation_resumed` | Session resumed with history |
| `claude_output` | Streaming model output / tool results |
| `turn_completed` | Turn finished, ready for next |
| `conversation_closed` | Claude process exited |
| `terminal_output` | PTY output |
| `file_content`, `directory_listing` | File operation results |
| `git_status_result`, `git_diff_result` | Git results |

**Agent Registration Flow:**

1. Agent connects: `ws://server?type=agent&id=...&name=...`
2. Agent sends `auth` message with `{ secret }` (production)
3. Server validates secret, generates session key
4. Server sends `registered` message with session key
5. All subsequent messages encrypted with session key

**Client Registration Flow:**

1. Client connects: `ws://server?type=web&token=JWT`
2. Server validates JWT, generates session key
3. Server sends `auth_result` with session key

### Connection & Reconnection

- Agent heartbeat: ping/pong every 30s
- Client reconnect: exponential backoff, max 10 attempts
- Agent disconnect: server clears conversations, notifies clients
- Message buffering: agent buffers critical messages during disconnection, flushes on reconnect

### Turn-Based Execution Model

```
IDLE → (execute message) → PROCESSING → (Claude reply) → TURN_COMPLETED → IDLE
                                                              ↓
                                              (dequeue next message if queued)
```

- `processing` flag per conversation prevents concurrent execution
- Server-side `serverMessageQueues` Map holds queued messages when agent is busy
- On `turn_completed` or `conversation_closed`, next message dequeued

### Session & Conversation Management

**Server-side (SQLite):**
```sql
sessions(id, agent_id, agent_name, claude_session_id, work_dir, title, user_id, created_at, updated_at, is_active)
messages(id, session_id, role, content, message_type, tool_name, tool_input, created_at)
users(id, username, display_name, password_hash, email, role, totp_secret, totp_enabled, agent_secret, ...)
invitations(id, created_by, used_by, expires_at, role)
```

**Agent-side (in-memory):**
```javascript
conversations.set(conversationId, {
  id, workDir, claudeSessionId, createdAt, processing, userId, username
})
```

**History:** Agent reads from `~/.claude/projects/<folder>/<sessionId>.jsonl`

### Claude SDK Integration (agent/sdk/)

- Spawns Claude CLI as subprocess
- Input: AsyncIterable for bidirectional communication
- Output: stream-json parser, one JSON object per line
- Tool calling: SDK yields `tool_use` → agent executes → returns `tool_result`
- Options: `cwd`, `permissionMode: 'bypassPermissions'`, `disallowedTools`, `abort` signal
- Lazy initialization: Claude process spawns on first user input

### Web UI Architecture

**3-Column Layout (ChatPage.js):**
1. Left Sidebar: Agent list, conversation list, settings, theme toggle
2. Middle: Chat messages (Markdown via marked.js + highlight.js), chat input (text + file upload)
3. Right: Workbench panel (Terminal, Files, Git, Port Proxy tabs)

**State Management (Pinia `chat.js` store):**
```javascript
{
  ws: WebSocket,
  authenticated: boolean,
  agents: [],
  currentAgent: agentId,
  conversations: [],
  currentConversation: conversationId,
  messages: [],
  processingConversations: Map,    // per-conversation busy state
  executionStatusMap: Map,         // tool execution tracking
  messageQueues: Map,              // per-conversation queues
  theme: 'dark' | 'light',
  locale: 'en' | 'zh-CN'
}
```

**Tool Execution Tracking:**
- Real-time display of tool name + input/output
- `executionStatus`: `{ currentTool, toolHistory, lastActivity }`
- Updated on each `tool_use` / `tool_result` block from `claude_output`

**Terminal:** xterm.js integration, PTY via node-pty on agent
**Files:** CodeMirror 5 editor, binary file preview (base64)
**i18n:** English + Simplified Chinese

### Security

- **Encryption**: TweetNaCl mandatory in production, optional in dev
- **Agent auth**: per-user `agent_secret` (DB) or global `AGENT_SECRET` (env)
- **Ownership checks**: `verifyConversationOwnership()`, `verifyAgentOwnership()` on all operations
- **Rate limiting**: 10 login attempts per IP per 15 min
- **Path validation**: `resolveAndValidatePath()` prevents directory traversal
- **Shell injection protection**: path validation for git commands

### Configuration (Environment Variables)

**Server:**
| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | 3456 | Server port |
| `AUTH_MODE` | microsoft | Auth backend: microsoft, local, skip |
| `JWT_SECRET` | (required) | JWT signing key |
| `AGENT_SECRET` | agent-shared-secret | Global agent secret |
| `SMTP_HOST/USER/PASS` | (empty) | Email verification |
| `TOTP_ENABLED` | true | 2FA |

**Agent:**
| Variable | Default | Source |
|----------|---------|--------|
| `SERVER_URL` | ws://localhost:3456 | env > config file |
| `AGENT_NAME` | Worker-{platform}-{pid} | env > config |
| `WORK_DIR` | process.cwd() | env > config |
| `AGENT_SECRET` | agent-shared-secret | env only |
| `DISALLOWED_TOOLS` | mcp__* | env > config |

### Testing

- Framework: Vitest
- Run: `npm test`, `npm run test:watch`, `npm run test:coverage`
- Coverage: auth, database, encryption, REST API, WebSocket handlers, agent connection

### Key Patterns to Reuse for AgentLink

1. **WebSocket message router**: centralized `handleMessage()` → type switch → handler
2. **Encryption layer**: TweetNaCl secretbox with session keys
3. **Turn-based execution**: processing flag + message queue
4. **Lazy initialization**: spawn subprocess on first message
5. **Message buffering**: buffer during disconnection, flush on reconnect
6. **Frontend Pinia store helpers**: split store actions into focused modules
7. **Vue 3 browser ES modules**: no bundler needed for dev mode
8. **3-column chat layout**: reusable component structure

## AgentLink Project

### Differences from claude-web-chat

- **TypeScript** instead of JavaScript (server + agent)
- **Commander.js** for CLI instead of custom cli.js
- **Single-agent** model (one local agent per session)
- Cloud relay (`msclaude.ai`) is the server component
- Simplified auth model (session URL is the access token)
- No multi-user, no roles, no invitations
- No database (stateless server, agent reads Claude's JSONL files directly)

### Current Project Structure

```
agentlink/
├── package.json              # Monorepo root (npm workspaces: server, agent)
├── tsconfig.base.json        # Shared TS config (ES2022, Node16, strict)
├── vitest.config.ts          # Vitest test runner config
├── .gitignore
├── requirements.md           # Product requirements
├── CLAUDE.md                 # This file
├── server/
│   ├── package.json          # Express 4.18 + ws 8.16 + Commander.js 12, bin: agentlink-server
│   ├── tsconfig.json         # extends ../tsconfig.base.json
│   └── src/
│       ├── cli.ts            # Server CLI entry point (start/stop/status)
│       ├── config.ts         # Server runtime state (~/.agentlink/server.json)
│       ├── index.ts          # HTTP server + WebSocket routing + static serving
│       ├── context.ts        # Shared state (agents, webClients, sessionToAgent maps)
│       ├── ws-agent.ts       # Agent WebSocket handler (registration, message forwarding)
│       ├── encryption.ts      # TweetNaCl encryption (XSalsa20-Poly1305 secretbox)
│       └── ws-client.ts      # Web client WebSocket handler (session binding, forwarding)
│   └── web/                  # Vue 3 SPA (static assets served by Express)
│       ├── index.html        # Vue 3 SPA shell (CDN: Vue 3, marked.js, highlight.js)
│       ├── style.css         # Dark/light theme + responsive mobile CSS
│       ├── encryption.js     # Browser-side TweetNaCl encryption (CDN globals)
│       ├── app.js            # Vue 3 coordinator (state, wiring, template; ~606 lines)
│       └── modules/          # Extracted ES modules (imported by app.js)
│           ├── markdown.js       # marked.js setup, renderMarkdown, tool icons (~82 lines)
│           ├── messageHelpers.js # Message formatting, tool display, diff rendering (~185 lines)
│           ├── fileAttachments.js # File upload, drag-drop, paste, base64 encoding (~125 lines)
│           ├── askQuestion.js    # AskUserQuestion option selection & submission (~63 lines)
│           ├── streaming.js      # Progressive text reveal (5 chars/16ms) (~93 lines)
│           ├── sidebar.js        # Session list, folder picker, navigation (~186 lines)
│           └── connection.js     # WebSocket connect/reconnect, message routing (~342 lines)
├── agent/
│   ├── package.json          # Commander.js 12 + ws 8.16, bin: agentlink-client
│   ├── tsconfig.json         # extends ../tsconfig.base.json
│   └── src/
│       ├── cli.ts            # Client CLI entry point (start/stop/status/config/service)
│       ├── config.ts         # Config load/save/resolve (~/.agentlink/config.json)
│       ├── connection.ts     # WebSocket client (connect, reconnect, message dispatch)
│       ├── claude.ts         # Claude CLI subprocess (spawn, stream-json I/O, turn mgmt)
│       ├── sdk.ts            # Claude command resolution + environment helpers
│       ├── stream.ts         # AsyncIterable stream for bidirectional IPC
│       ├── history.ts        # Read Claude session JSONL files (list + message history)
│       ├── daemon.ts         # Daemon mode (detached process spawning)
│       ├── encryption.ts     # TweetNaCl encryption (XSalsa20-Poly1305 secretbox)
│       ├── service.ts        # OS auto-start service (systemd/launchd/Startup folder)
│       └── index.ts          # Agent core (start function, graceful shutdown)
├── test/                     # Vitest unit tests
│   ├── server/
│   │   ├── encryption.test.ts
│   │   └── context.test.ts
│   └── agent/
│       ├── encryption.test.ts
│       ├── stream.test.ts
│       ├── history.test.ts
│       └── config.test.ts
```

### Agent Source Files Reference

| File | Purpose | Key exports |
|------|---------|-------------|
| `cli.ts` | Commander.js CLI entry point | `start`, `stop`, `status`, `config`, `service` subcommands |
| `config.ts` | Persistent config (`~/.agentlink/config.json`) | `loadConfig()`, `saveConfig()`, `resolveConfig()`, `killProcess()`, `isProcessAlive()` |
| `connection.ts` | WebSocket client to server | `connect()`, `disconnect()`, `send()` + message router |
| `claude.ts` | Claude CLI subprocess lifecycle | `handleChat()`, `abort()`, `cancelExecution()`, `setSendFn()`, `handleUserAnswer()` |
| `sdk.ts` | Resolves `claude` command location | `resolveClaudeCommand()`, `getCleanEnv()`, `streamToStdin()` |
| `stream.ts` | AsyncIterable\<T\> with enqueue/done | `Stream` class (used for stdin/stdout piping) |
| `history.ts` | Reads `~/.claude/projects/` JSONL files | `listSessions()`, `readSessionMessages()` |
| `daemon.ts` | Background process management | Spawns/kills detached agent process |
| `service.ts` | OS auto-start service management | `serviceInstall()`, `serviceUninstall()` (systemd/launchd/Startup folder) |
| `encryption.ts` | TweetNaCl encryption | `encrypt()`, `decrypt()`, `parseMessage()`, `encryptAndSend()` |
| `index.ts` | Agent startup orchestration | `start()` (connects, writes runtime state, handles shutdown) |

### Claude CLI Integration (agent/claude.ts)

**Lifecycle:**
1. First user message → `startQuery()` spawns `claude` subprocess
2. Claude runs with `--output-format stream-json --input-format stream-json --verbose --permission-mode bypassPermissions --permission-prompt-tool stdio`
3. User messages enqueued into `Stream<ClaudeMessage>` → piped to stdin
4. Stdout parsed as JSON lines by `readline` → forwarded to web client
5. On `result` message → turn complete, process stays alive for next turn
6. On `--resume <sessionId>` → resumes previous Claude session

**Permission & control_request protocol:**
- `--permission-mode bypassPermissions` auto-approves all regular tool calls
- `--permission-prompt-tool stdio` routes interactive tool permission checks (like `AskUserQuestion`) through stdout/stdin instead of auto-denying them
- Claude emits `control_request` with `subtype: 'can_use_tool'` on stdout
- Agent's `handleControlRequest()` intercepts these:
  - `AskUserQuestion`: stored in `pendingControlRequests` Map, forwarded to web UI as `ask_user_question` message
  - All other tools: auto-approved by sending `control_response` with `{ behavior: 'allow' }` back to stdin
- When web UI submits an answer, agent receives `ask_user_answer`, resolves the pending request by writing `control_response` to Claude's stdin with `updatedInput` containing the user's answers
- `AskUserQuestion` tool_use blocks are filtered out of regular `claude_output` forwarding (they're handled via the control_request path)

**Output processing:**
- `assistant` messages: extracts text deltas (incremental) + tool_use blocks (excluding `AskUserQuestion`)
- `control_request` messages: intercepted for permission handling
- `control_cancel_request`: cleans up pending requests
- `user` messages: tool_result forwarding
- `system` messages: session ID capture, logged only
- `result` message: turn complete signal

**State:**
```typescript
interface ConversationState {
  child: ChildProcess | null;
  inputStream: Stream<ClaudeMessage> | null;
  abortController: AbortController | null;
  claudeSessionId: string | null;
  workDir: string;
  turnActive: boolean;
  turnResultReceived: boolean;
}
```

### Session History (agent/history.ts)

**JSONL file location:** `~/.claude/projects/<folder>/<sessionId>.jsonl`

**Path conversion:** `Q:\src\agentlink` → `Q--src-agentlink` (colons → `-`, slashes → `-`, spaces → `-`)

**`listSessions(workDir)`** — Scans JSONL files, extracts metadata:
- Title: `custom-title` > `summary` > first user message (truncated to 100 chars)
- Skips internal command messages (`/compact`, etc.) via `isInternalCommand()` tag detection
- Returns `SessionInfo[]` sorted by lastModified descending

**`readSessionMessages(workDir, sessionId)`** — Parses full message history:
- User messages: extracts text from `message.content` (handles string + array formats)
- Filters out internal CLI commands (messages containing `<local-command-caveat>`, `<command-name>`, `<local-command-stdout>` tags)
- Assistant messages: iterates content blocks → separate entries for text + tool_use
- Returns `HistoryMessage[]` (flat list of user/assistant/tool entries)

### WebSocket Message Protocol (AgentLink)

**Server acts as a transparent relay** — all messages from web clients are forwarded to the bound agent, and vice versa. Server intercepts `workdir_changed` to keep its agent state in sync.

**Registration flow:**
1. Agent connects: `ws://server/?type=agent&id=NAME&name=NAME&workDir=PATH`
2. Server generates 32-byte session key, sends `{ type: 'registered', sessionId, sessionKey }` (plain text, key in base64)
3. Agent decodes sessionKey; all subsequent messages are encrypted with XSalsa20-Poly1305 secretbox
4. Web client connects: `ws://server/?type=web&sessionId=SID`
5. Server generates separate session key for client, sends `{ type: 'connected', sessionKey, agent: { name, workDir } }` (plain text)
6. Web client decodes sessionKey; all subsequent messages are encrypted
7. Encrypted message envelope: `{ n: "base64-nonce-24B", c: "base64-ciphertext", z?: true }` (z = gzip compressed)

**Message types (Web → Agent):**

| Type | Purpose | Key fields |
|------|---------|------------|
| `chat` | Send user prompt | `prompt`, `resumeSessionId?`, `files?: ChatFile[]` |
| `cancel_execution` | Stop current Claude turn | — |
| `list_sessions` | Request session history list | — |
| `resume_conversation` | Resume a historical session | `claudeSessionId` |
| `list_directory` | Browse host filesystem | `dirPath` |
| `change_workdir` | Switch working directory | `workDir` |
| `ask_user_answer` | User's answer to AskUserQuestion | `requestId`, `answers: { questionText: selectedLabel }` |

**Message types (Agent → Web):**

| Type | Purpose | Key fields |
|------|---------|------------|
| `claude_output` | Streaming output | `data: { type, delta?, tools? }` |
| `turn_completed` | Claude turn finished | — |
| `execution_cancelled` | Execution was stopped | — |
| `sessions_list` | Historical sessions | `sessions[], workDir` |
| `conversation_resumed` | Session resumed with history | `claudeSessionId, history[]` |
| `directory_listing` | Filesystem directory contents | `dirPath, entries[], error?` |
| `workdir_changed` | Working directory updated | `workDir` |
| `ask_user_question` | Interactive question from Claude | `requestId`, `questions[]` (with header, question, options, multiSelect) |

**claude_output subtypes:**

| data.type | Purpose |
|-----------|---------|
| `content_block_delta` | Incremental text (`data.delta`) |
| `tool_use` | Tool invocations (`data.tools[]`) |
| `user` / `tool_use_result` | Tool results (forwarded from Claude stdout) |
| `result` | Turn complete (triggers `turn_completed`) |

### Web UI Architecture

**Module structure:** The web frontend uses Vue 3 Composition API with browser ES modules (no bundler). The monolithic `app.js` was split into focused modules under `modules/`.

**Module pattern:**
- **Stateful modules** use a factory function pattern: `createFoo(deps)` receives Vue reactive refs, returns methods. Encapsulates mutable state internally.
- **Stateless modules** export pure functions that take explicit parameters.
- **Circular dependency** between sidebar (needs `wsSend`) and connection (needs `sidebar.requestSessionList`) is resolved with a forwarding function in `app.js`.

**Web UI Source Files Reference:**

| File | Pattern | Key exports |
|------|---------|-------------|
| `app.js` | Coordinator | Declares all reactive state, creates module instances, wires dependencies, contains template |
| `modules/markdown.js` | Pure exports | `renderMarkdown(text)`, `getToolIcon(toolName)` |
| `modules/messageHelpers.js` | Pure exports | `isPrevAssistant(msgs, idx)`, `getRenderedContent(msg)`, `formatTimestamp(ts)`, `copyMessage(msg)`, `toggleTool(msg)`, `getToolSummary(msg)`, `getEditDiffHtml(msg)` |
| `modules/fileAttachments.js` | Factory | `createFileAttachments(attachments, fileInputRef, dragOver)` → `{addFiles, removeFile, triggerFileInput, onFileInputChange, onDragOver, onDragLeave, onDrop, onPaste, prepareFilesForSend}` |
| `modules/askQuestion.js` | Pure exports | `selectQuestionOption(msg, qi, opt)`, `submitQuestionAnswer(msg, wsSend)`, `hasQuestionAnswer(q)`, `getQuestionResponseSummary(q)` |
| `modules/streaming.js` | Factory | `createStreaming({messages, scrollToBottom})` → `{startReveal, flushReveal, appendPending, reset, cleanup, nextId, ...}` |
| `modules/sidebar.js` | Factory | `createSidebar(deps)` → `{requestSessionList, resumeSession, newConversation, toggleSidebar, openFolderPicker, confirmFolderPicker, groupedSessions, ...}` |
| `modules/connection.js` | Factory | `createConnection(deps)` → `{connect, wsSend, closeWs}` |

**Layout:** Top bar (with theme toggle) + main body (sidebar + chat area)

**Top bar:**
- Sidebar toggle button, "AgentLink" title
- Status badge, agent name, light/dark theme toggle (sun/moon icon)
- Theme persisted to `localStorage('agentlink-theme')`, applied before first paint via inline script

**Sidebar (left, 260px, toggleable):**
- Working directory display with change-directory button (opens folder picker modal)
- "New conversation" button
- Session history list grouped by time (Today / Yesterday / This week / Earlier)
- `groupedSessions` computed property handles grouping
- Click session → `resume_conversation` → loads history messages into chat
- Mobile (≤768px): sidebar defaults to hidden, opens as fixed overlay with backdrop, auto-closes on session select or new conversation

**Chat area:**
- Centered `message-list-inner` container (max-width: 768px)
- Unified left-aligned message layout with role labels ("YOU" / "CLAUDE")
- User messages: `bg-tertiary` rounded box; Assistant messages: transparent, no border
- `isPrevAssistant()` suppresses repeated "Claude" label for consecutive assistant/tool messages
- Markdown rendering: marked.js + highlight.js, code block copy buttons
- Streaming text: progressive reveal (3 chars/tick, 12ms interval)
- Tool display: icon + name + summary line, expandable input/output
- AskUserQuestion: interactive card with selectable options, custom text input, submit button
- Stop button during processing

**Input area:**
- Floating card (`input-card`) with 16px border-radius, shadow, accent focus ring
- Textarea + embedded icon send button inside the card
- Gradient fade at bottom of message list (`input-area::before`)

**Folder picker modal:**
- Triggered by folder icon button in sidebar next to "Working Directory"
- Browses agent host filesystem (Windows: drive letters C-Z; Unix: root `/`)
- Single-click to select, double-click to navigate into directory
- Up button for parent navigation (platform-aware for Windows drive roots)
- Filters hidden files and `node_modules`, shows directories only
- On confirm: kills Claude process, updates workDir, clears chat, refreshes session history

**Theme system:**
- CSS variables in `:root` (dark default) and `[data-theme="light"]`
- highlight.js stylesheet switches between `github-dark` and `github` themes
- Inline `<script>` in index.html prevents flash on load

**CDN dependencies:** Vue 3, marked.js 12, highlight.js 11.9 (github-dark / github themes)

**Mobile responsive (style.css media queries):**
- `@media (max-width: 768px)`: sidebar as fixed overlay (280px, z-index 100) with `.sidebar-backdrop`, `overflow-x: hidden` on html/body/layout to prevent horizontal scroll, message bubbles constrained with `overflow: hidden` + `word-break: break-word`, code blocks scroll within their container, reduced padding throughout
- `@media (max-width: 480px)`: further reduced padding for extra-small screens
- `sidebarOpen` defaults to `window.innerWidth > 768`

**Key reactive state:**
```javascript
{
  status, agentName, workDir, sessionId, error,
  messages, inputText, isProcessing, theme,
  sidebarOpen, historySessions, currentClaudeSessionId, loadingSessions,
  folderPickerOpen, folderPickerPath, folderPickerEntries, folderPickerLoading, folderPickerSelected,
}
```

### Config System

Config file: `~/.agentlink/config.json`

Priority: **CLI flags > config file > defaults**

| Key | Default | Description |
|-----|---------|-------------|
| `server` | `wss://msclaude.ai` | Relay server WebSocket URL |
| `dir` | `process.cwd()` | Working directory |
| `name` | `Agent-{platform}-{pid}` | Agent display name |

**Runtime & data files (`~/.agentlink/`):**

| File / Dir | Written by | Contains |
|------------|-----------|----------|
| `agent.json` | Agent process | PID, sessionId, sessionUrl, server, name, dir, startedAt |
| `server.json` | Server process | PID, port, startedAt |
| `logs/` | Agent / Server | stdout/stderr log files for daemon processes |
| `tmp-attachments/` | Agent (claude.ts) | Uploaded files saved to disk for Claude (timestamped names) |

Used by `agentlink stop`, `agentlink server stop`, and `agentlink status` to find and manage running processes. On Windows, `taskkill /pid /f /t` is used for reliable termination; on Unix, `SIGTERM`.

### Build & Run Commands

```bash
# Install dependencies
npm install

# Build all TypeScript packages
npm run build

# Dev mode with hot reload
npm run dev:server       # server only
npm run dev:agent        # agent only
npm run dev              # both (concurrently)

# Tests
npm test                 # run all tests (vitest)
npm run test:watch       # watch mode
npm run test:coverage    # with v8 coverage report

# Server management (agentlink-server CLI)
agentlink-server start                         # start server in foreground (port 3456)
agentlink-server start --daemon                # start server in background
agentlink-server start --port 8080             # custom port
agentlink-server stop                          # stop the server
agentlink-server status                        # show server status

# Client / Agent management (agentlink-client CLI)
agentlink-client start                                # foreground mode, use config defaults
agentlink-client start --server ws://localhost:3456    # override server
agentlink-client start --daemon                       # background mode
agentlink-client stop                                 # stop the agent
agentlink-client status                               # show agent status

# Config
agentlink-client config list                          # show config
agentlink-client config set server ws://localhost:3456
agentlink-client config get server

# Service management (auto-start on boot)
agentlink-client service install                       # register + start now
agentlink-client service install --name MyAgent        # with custom config
agentlink-client service uninstall                     # remove + stop

agentlink-client --help
```

**Local dev build** (run from source instead of npm-installed global):
```bash
# Server (local build)
node Q:/src/agentlink/server/dist/cli.js start --daemon
node Q:/src/agentlink/server/dist/cli.js stop
node Q:/src/agentlink/server/dist/cli.js status

# Agent (local build, pointing to local server)
node Q:/src/agentlink/agent/dist/cli.js start --daemon --server ws://localhost:3456
node Q:/src/agentlink/agent/dist/cli.js stop
node Q:/src/agentlink/agent/dist/cli.js status
```

> **Note:** Both npm-global and local-dev commands share the same `~/.agentlink/` runtime state files (`server.json`, `agent.json`). Only run one set at a time — not both simultaneously. The `agentlink-server`/`agentlink-client` commands use the npm-installed version; the `node .../dist/cli.js` commands use the local build.

### Publishing to npm

**Prerequisites:**
- npm org `agent-link` must exist on npmjs.com (for `@agent-link/*` scoped packages)
- Logged in with `npm login` or have a granular access token with publish permissions
- Token must have "Bypass 2FA for automation" enabled, or pass `--otp=<code>`

**Set auth token (if using granular token):**
```bash
npm config set //registry.npmjs.org/:_authToken <YOUR_TOKEN>
```

**Publish both packages:**
```bash
# Publish server (includes web/ static assets)
npm publish --workspace server --access public

# Publish agent (client CLI only)
npm publish --workspace agent --access public
```

**Version bump before re-publish:**
```bash
# Bump patch version (0.1.0 → 0.1.1)
npm version patch --workspace server --no-git-tag-version
npm version patch --workspace agent --no-git-tag-version

# Or bump minor (0.1.0 → 0.2.0)
npm version minor --workspace server --no-git-tag-version
npm version minor --workspace agent --no-git-tag-version

# Then publish
npm publish --workspace server --access public
npm publish --workspace agent --access public
```

**Verify before publish (dry run):**
```bash
npm publish --dry-run --workspace server
npm publish --dry-run --workspace agent
```

**Install from npm (end users):**
```bash
# Server (on relay machine)
npm install -g @agent-link/server
agentlink-server start --daemon --port 3456

# Client (on dev machine)
npm install -g @agent-link/agent
agentlink-client start --daemon
```

### Implementation Status

- [x] Monorepo skeleton (npm workspaces, TypeScript, build pipeline)
- [x] Server: Express + WebSocket + static file serving + health endpoint
- [x] Server: transparent message relay (web ↔ agent)
- [x] Server: runtime state file (`server.json`) for CLI management
- [x] Agent CLI: Commander.js with start/stop/status/config commands (`agentlink-client`)
- [x] Server CLI: Commander.js with start/stop/status commands (`agentlink-server`)
- [x] Agent CLI: cross-platform process kill (taskkill on Windows, SIGTERM on Unix)
- [x] Agent config: persistent config file with priority resolution
- [x] WebSocket connection layer (agent ↔ server ↔ web client)
- [x] Session registration (unique session URL via base64url IDs)
- [x] Auto-reconnect on connection loss (exponential backoff, 20 attempts)
- [x] Claude SDK integration (spawn claude CLI, stream-json I/O, turn management)
- [x] Claude: control_request/control_response protocol (`--permission-prompt-tool stdio`)
- [x] Claude: AskUserQuestion interception (forward to web UI, collect answer, reply to stdin)
- [x] Runtime state tracking (`~/.agentlink/agent.json`, `~/.agentlink/server.json`)
- [x] Process management (`agentlink stop`, `agentlink start --daemon`, `agentlink server start/stop`)
- [x] Web UI: chat interface (message list, input, send/receive, typing indicator)
- [x] Web UI: markdown rendering (marked.js + highlight.js, code block copy)
- [x] Web UI: streaming text display (progressive character reveal)
- [x] Web UI: tool use display (collapsible blocks with icon, name, input/output)
- [x] Web UI: AskUserQuestion interactive card (options, custom input, submit)
- [x] Web UI: stop/cancel button during processing
- [x] Web UI: sidebar with working directory display
- [x] Web UI: session history list (reads Claude's JSONL files)
- [x] Session resume (load history from JSONL, `--resume` flag to Claude CLI)
- [x] Multi-turn conversation management (persistent Claude process across turns)
- [x] Web UI: unified left-aligned layout with role labels + centered max-width container
- [x] Web UI: floating input card with embedded send button
- [x] Web UI: sidebar session history grouped by time (Today/Yesterday/This week/Earlier)
- [x] Web UI: light/dark theme toggle with localStorage persistence
- [x] Web UI: change working directory (folder picker modal, filesystem browsing)
- [x] Message protocol (encrypted relay — TweetNaCl XSalsa20-Poly1305)
- [x] Web UI: file upload (paperclip button, drag-drop, paste; base64 over WebSocket; images inline, non-images saved to `~/.agentlink/tmp-attachments/`)
- [x] Auto-start service (`service install/uninstall` — systemd on Linux, launchd on macOS, Startup folder on Windows)
- [x] Web UI: mobile responsive (sidebar overlay, constrained overflow, reduced padding at 768px/480px breakpoints)
- [x] CLI: dynamic version from package.json (`createRequire` in cli.ts)
- [x] History: filter internal CLI commands (`/compact`, etc.) from session list and message history
- [x] Web UI: modularized frontend (app.js split into 7 ES modules under `modules/`)
- [x] Unit tests: vitest (encryption, stream, history, config, context — 60 tests)
- [ ] Web UI: workbench panel (terminal, files, git)
- [ ] Agent: terminal (PTY) support
- [ ] Agent: file/git operations
- [ ] Agent: port forwarding / proxy

### Development Workflow

- **Commit after each milestone** — every completed feature, bug fix, or logical unit of work should be committed immediately. Do not batch unrelated changes into a single commit.
