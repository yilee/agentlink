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

- **TypeScript** instead of JavaScript
- **Commander.js** for CLI instead of custom cli.js
- **Single-agent** model (one local agent per session)
- Cloud relay (`msclaude.ai`) is the server component
- Simplified auth model (session URL is the access token)
- No multi-user, no roles, no invitations

### Current Project Structure

```
agentlink/
├── package.json              # Monorepo root (npm workspaces: server, agent)
├── tsconfig.base.json        # Shared TS config (ES2022, Node16, strict)
├── .gitignore
├── requirements.md           # Product requirements
├── CLAUDE.md                 # This file
├── server/
│   ├── package.json          # Express 4.18 + ws 8.16
│   ├── tsconfig.json         # extends ../tsconfig.base.json
│   └── src/
│       ├── index.ts          # HTTP server + WebSocket routing + static serving
│       ├── context.ts        # Shared state (agents, webClients, sessionToAgent maps)
│       ├── ws-agent.ts       # Agent WebSocket handler (registration, message forwarding)
│       └── ws-client.ts      # Web client WebSocket handler (session binding, forwarding)
├── agent/
│   ├── package.json          # Commander.js 12 + ws 8.16, bin: agentlink
│   ├── tsconfig.json         # extends ../tsconfig.base.json
│   └── src/
│       ├── cli.ts            # CLI entry point (start/stop/status/config)
│       ├── config.ts         # Config load/save/resolve (~/.agentlink/config.json)
│       ├── connection.ts     # WebSocket client (connect, reconnect, message dispatch)
│       └── index.ts          # Agent core (start function, graceful shutdown)
└── web/
    ├── index.html            # Vue 3 SPA shell (CDN, no bundler)
    ├── style.css             # Dark theme + chat UI styles
    └── app.js                # Vue 3 app (connection, chat messages, input)
```

### Config System

Config file: `~/.agentlink/config.json`

Priority: **CLI flags > config file > defaults**

| Key | Default | Description |
|-----|---------|-------------|
| `server` | `wss://msclaude.ai` | Relay server WebSocket URL |
| `dir` | `process.cwd()` | Working directory |
| `name` | `Agent-{platform}-{pid}` | Agent display name |

### Build & Run Commands

```bash
# Install dependencies
npm install

# Build all TypeScript packages
npm run build

# Start server (serves web UI on http://localhost:3456)
npm run start:server

# Dev mode with hot reload
npm run dev:server       # server only
npm run dev:agent        # agent only
npm run dev              # both (concurrently)

# Agent CLI
node agent/dist/cli.js start                        # use config file defaults
node agent/dist/cli.js start --server ws://localhost:3456  # override server
node agent/dist/cli.js config list                   # show config
node agent/dist/cli.js config set server ws://localhost:3456
node agent/dist/cli.js config get server
node agent/dist/cli.js --help
```

### Implementation Status

- [x] Monorepo skeleton (npm workspaces, TypeScript, build pipeline)
- [x] Server: Express + WebSocket + static file serving + health endpoint
- [x] Agent CLI: Commander.js with start/stop/status/config commands
- [x] Agent config: persistent config file with priority resolution
- [x] Web: Vue 3 minimal skeleton (dark theme)
- [x] WebSocket connection layer (agent ↔ server ↔ web client)
- [x] Session registration (unique session URL via base64url IDs)
- [x] Auto-reconnect on connection loss (exponential backoff, 20 attempts)
- [x] Web UI: chat interface (message list, input, send/receive, typing indicator)
- [x] Claude SDK integration (spawn claude CLI, stream-json I/O, turn management)
- [x] Runtime state tracking (`~/.agentlink/agent.json`, `agentlink status`)
- [x] Process management (`agentlink stop`, `agentlink start --daemon`)
- [ ] Message protocol (encrypted relay)
- [ ] Web UI: markdown rendering for assistant messages
- [ ] Web UI: streaming / incremental text display
- [ ] Session resume (persist claudeSessionId, `--resume` on reconnect)
- [ ] Multi-turn conversation management
