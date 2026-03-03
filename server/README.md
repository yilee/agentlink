# AgentLink Server

[![npm](https://img.shields.io/npm/v/@agent-link/server)](https://www.npmjs.com/package/@agent-link/server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Relay server for [AgentLink](https://github.com/yilee/agentlink) — use Claude Code from any browser.

AgentLink lets you run Claude Code on your local machine and access it through a web interface. The server acts as an encrypted WebSocket relay between your browser and the local agent. No data is stored on the server.

## Install

```bash
npm install -g @agent-link/server
```

## Usage

```bash
# Start server (foreground)
agentlink-server start --port 3456

# Start server (background)
agentlink-server start --daemon --port 3456

# Stop server
agentlink-server stop

# Check status
agentlink-server status

# Upgrade to latest version
agentlink-server upgrade

# Auto-start on boot
agentlink-server service install --port 3456
agentlink-server service uninstall
```

## How it works

```
Browser ↔ AgentLink Server ↔ AgentLink Client ↔ Claude Code
  (web)      (relay)            (your machine)     (CLI)
```

The server is a lightweight Express + WebSocket relay. It serves the web UI, assigns unique session URLs, and forwards encrypted messages between the browser and the agent.

## Related

- **[@agent-link/agent](https://www.npmjs.com/package/@agent-link/agent)** — Local agent CLI (install this on your dev machine)
- [GitHub](https://github.com/yilee/agentlink)
