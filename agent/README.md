# AgentLink Client

[![npm](https://img.shields.io/npm/v/@agent-link/agent)](https://www.npmjs.com/package/@agent-link/agent)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Local agent CLI for [AgentLink](https://github.com/yilee/agentlink) — use Claude Code from any browser.

AgentLink lets you run Claude Code on your local machine and access it through a web interface. The client runs on your dev machine, connects to a relay server, and gives you a URL to open in any browser.

## Install

```bash
npm install -g @agent-link/agent
```

## Quick Start

```bash
agentlink-client start
```

You'll get a URL like `https://msclaude.ai/s/abc123` and a QR code — open the URL in any browser to start using Claude Code.

## Usage

```bash
# Start agent (foreground)
agentlink-client start

# Start agent (background)
agentlink-client start --daemon

# Custom server / working directory / name
agentlink-client start --server ws://your-server:3456 --dir /path/to/project --name MyAgent

# Password-protected session
agentlink-client start --daemon --password mysecret

# Disable auto-update in daemon mode
agentlink-client start --daemon --no-auto-update

# Stop agent
agentlink-client stop

# Check status
agentlink-client status

# Upgrade to latest version
agentlink-client upgrade

# Auto-start on boot
agentlink-client service install
agentlink-client service uninstall
```

## Configuration

```bash
# Set default server
agentlink-client config set server ws://your-server:3456

# Set working directory
agentlink-client config set dir /path/to/project

# Set password
agentlink-client config set password mysecret

# View all config
agentlink-client config list

# Get a single value
agentlink-client config get server
```

Valid keys: `server`, `dir`, `name`, `autoUpdate`, `password`. Config is stored in `~/.agentlink/config.json`.

## How it works

```
Browser ↔ AgentLink Server ↔ AgentLink Client ↔ Claude Code
  (web)      (relay)            (your machine)     (CLI)
```

The client spawns Claude Code as a subprocess, streams its output through the relay server to your browser, and sends your messages back. All tool execution happens locally on your machine. Messages are encrypted end-to-end with XSalsa20-Poly1305.

## Requirements

- Node.js 18+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

## Related

- **[@agent-link/server](https://www.npmjs.com/package/@agent-link/server)** — Relay server (only needed if self-hosting)
- [GitHub](https://github.com/yilee/agentlink)
