# AgentLink Client

Local agent CLI for [AgentLink](https://github.com/anthropics/agentlink) — use Claude Code from any browser.

AgentLink lets you run Claude Code on your local machine and access it through a web interface. The client runs on your dev machine, connects to a relay server, and gives you a URL to open in any browser.

## Install

```bash
npm install -g @agent-link/agent
```

## Quick Start

```bash
agentlink-client start
```

That's it. You'll get a URL like `http://your-server:3456/s/abc123` — open it in any browser to start using Claude Code.

## Usage

```bash
# Start agent (foreground)
agentlink-client start

# Start agent (background)
agentlink-client start --daemon

# Custom server
agentlink-client start --server ws://your-server:3456

# Stop agent
agentlink-client stop

# Check status
agentlink-client status

# Auto-start on boot
agentlink-client service install
agentlink-client service uninstall
```

## Configuration

```bash
# Set default server (so you don't need --server every time)
agentlink-client config set server ws://your-server:3456

# Set working directory
agentlink-client config set dir /path/to/project

# View config
agentlink-client config list
```

Config is stored in `~/.agentlink/config.json`.

## How it works

```
Browser ↔ AgentLink Server ↔ AgentLink Client ↔ Claude Code
  (web)      (relay)            (your machine)     (CLI)
```

The client spawns Claude Code as a subprocess, streams its output through the relay server to your browser, and sends your messages back. All tool execution happens locally on your machine.

## Requirements

- Node.js 18+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

## Related

- **[@agent-link/server](https://www.npmjs.com/package/@agent-link/server)** — Relay server (only needed if self-hosting)
