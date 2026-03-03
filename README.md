# AgentLink

[![CI](https://github.com/yilee/agentlink/actions/workflows/ci.yml/badge.svg)](https://github.com/yilee/agentlink/actions/workflows/ci.yml)
[![npm server](https://img.shields.io/npm/v/@agent-link/server?label=server)](https://www.npmjs.com/package/@agent-link/server)
[![npm agent](https://img.shields.io/npm/v/@agent-link/agent?label=agent)](https://www.npmjs.com/package/@agent-link/agent)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Access your local Claude Code agent from anywhere — through a shareable web URL.

AgentLink runs a lightweight agent on your dev machine, connects it to a cloud relay, and gives you a clean chat interface at `https://msclaude.ai/xxxx`. All code execution happens locally. The relay just forwards encrypted messages.

```
Browser (any device)  ←→  Cloud Relay  ←→  Local Agent  ←→  Your Codebase
```

## Quick Start

```bash
# Install
npm install -g @agent-link/agent

# Start (prints a session URL)
agentlink-client start --daemon

# Open the URL in any browser — done.
```

## Why AgentLink?

- **Access from anywhere.** Phone, tablet, another machine — just open the URL.
- **Everything runs locally.** Your files never leave your machine. The relay only sees encrypted messages.
- **No setup on the browser side.** No extensions, no local server, no port forwarding. One URL.
- **Session history.** Resume previous conversations. Your Claude session files are read directly.
- **Real-time streaming.** Tool calls, markdown, code blocks — all rendered live as Claude works.
- **End-to-end encryption.** All WebSocket traffic is encrypted with XSalsa20-Poly1305 (TweetNaCl).

## Features

- Dark/light theme with localStorage persistence
- File upload (drag-drop, paste, paperclip button)
- Interactive `AskUserQuestion` cards from Claude
- Session history grouped by time (Today / Yesterday / This week / Earlier)
- Working directory history (quick switch between recent directories)
- Change working directory from the browser (folder picker)
- Context compaction status display
- Command output rendering (`/cost`, `/help`, etc.)
- Password protection (`--password` flag)
- Mobile responsive (optimized for phones and tablets)
- Auto-update in daemon mode (`--no-auto-update` to disable)
- Auto-start on boot (`service install` — systemd/launchd/Windows Startup)
- In-place upgrade (`agentlink-client upgrade`)

## How It Works

1. `agentlink-client start` connects to the relay server via WebSocket.
2. The server assigns a unique session URL (96-bit random ID).
3. You open the URL in a browser. The browser connects to the same relay.
4. Messages flow: browser → relay → agent → Claude CLI → agent → relay → browser.
5. Claude runs with `--permission-mode bypassPermissions`, so it can work autonomously.
6. All messages between relay↔agent and relay↔browser are encrypted with per-session keys.

## Commands

```bash
# Agent
agentlink-client start [--daemon] [--server URL] [--name NAME] [--dir PATH] [--password PWD]
agentlink-client stop
agentlink-client status
agentlink-client config list|get|set
agentlink-client service install|uninstall
agentlink-client upgrade

# Self-hosted relay server
agentlink-server start [--daemon] [--port PORT]
agentlink-server stop
agentlink-server status
```

## Self-Hosting

You can run your own relay server instead of using the public one:

```bash
npm install -g @agent-link/server
agentlink-server start --daemon --port 3456

# Then point agents to your server
agentlink-client start --daemon --server ws://your-server:3456
```

## Requirements

- Node.js 18+
- Claude CLI installed and authenticated (`claude` command available)

## Architecture

| Component | Tech |
|-----------|------|
| Agent | TypeScript, Commander.js, `ws` |
| Server | Express, `ws`, static file serving |
| Web UI | Vue 3 (browser ES modules), marked.js, highlight.js |
| Encryption | TweetNaCl (XSalsa20-Poly1305 secretbox) |

## Links

- [npm: @agent-link/agent](https://www.npmjs.com/package/@agent-link/agent)
- [npm: @agent-link/server](https://www.npmjs.com/package/@agent-link/server)
- [GitHub](https://github.com/yilee/agentlink)

## License

MIT
