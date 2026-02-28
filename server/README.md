# AgentLink Server

Relay server for [AgentLink](https://github.com/anthropics/agentlink) — use Claude Code from any browser.

AgentLink lets you run Claude Code on your local machine and access it through a web interface. The server acts as a WebSocket relay between your browser and the local agent.

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

# Auto-start on boot
agentlink-server service install --port 3456
agentlink-server service uninstall
```

## How it works

```
Browser ↔ AgentLink Server ↔ AgentLink Client ↔ Claude Code
  (web)      (relay)            (your machine)     (CLI)
```

The server is a lightweight Express + WebSocket relay. It serves the web UI and forwards messages between the browser and the agent. No data is stored on the server.

## Related

- **[@agent-link/agent](https://www.npmjs.com/package/@agent-link/agent)** — Local agent CLI (install this on your dev machine)
