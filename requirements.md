# AgentLink - Requirements

## Overview

AgentLink is a local agent that proxies a local working directory to a cloud web interface (`https://msclaude.ai/xxxx`), allowing users to interact via a web page. The cloud service (`msclaude.ai`) forwards messages, while all operations execute locally on the user's machine.

## Tech Stack

- **Runtime**: Node.js
- **Language**: TypeScript
- **Package Manager**: npm
- **CLI Framework**: Commander.js (or similar)
- **Communication**: WebSocket (WSS)

## Core Concepts

- **Local Agent**: A CLI tool (`agentlink`) running on the user's machine
- **Cloud Relay**: `msclaude.ai` acts as a message relay/proxy between the web UI and the local agent
- **Web Interface**: Users access `https://msclaude.ai/xxxx` in a browser to interact with the local agent via conversation

## CLI Commands

```bash
agentlink <command> [options]
```

| Command | Description |
|---|---|
| `agentlink start` | Start the local agent, connect to cloud relay, return a unique session URL |
| `agentlink stop` | Stop the running agent |
| `agentlink status` | Show current agent status (running/stopped, session URL, working directory) |
| `agentlink config` | View or update configuration (e.g., relay server address, auth token) |

### `agentlink start`

- Starts the local agent process
- Establishes a WebSocket connection to `msclaude.ai`
- Registers the agent and receives a unique session URL
- Prints the session URL to stdout (e.g., `https://msclaude.ai/abc123xyz`)
- Begins listening for messages from the cloud relay
- Default working directory: current directory (can be overridden with `--dir <path>`)

```bash
$ agentlink start
🔗 AgentLink started
📡 Session URL: https://msclaude.ai/abc123xyz
📂 Working directory: /home/user/project
⏳ Waiting for connections...
```

### `agentlink stop`

- Gracefully stops the running agent
- Closes the WebSocket connection
- Deregisters the session from the cloud relay

### `agentlink status`

- Displays whether the agent is currently running
- Shows the active session URL (if running)
- Shows the working directory

## Functional Requirements

1. **Local Agent**
   - CLI command: `agentlink`
   - Runs as a long-lived process on the user's machine
   - Connects to `msclaude.ai` and registers a unique session URL (e.g., `https://msclaude.ai/xxxx`)
   - Operates within a specified local working directory
   - Executes all operations (file read/write, command execution, etc.) locally

2. **Cloud Relay (`msclaude.ai`)**
   - Provides a web-based chat interface for users
   - Forwards user messages from the web UI to the local agent
   - Forwards agent responses from the local agent back to the web UI
   - Does NOT execute any operations itself; purely a message relay

3. **Web Interface**
   - Users open `https://msclaude.ai/xxxx` in a browser
   - Chat-based conversation UI
   - Messages are sent to the cloud relay, which forwards them to the local agent
   - Responses from the local agent are displayed in the web UI

## Architecture

```
User (Browser)  <-->  msclaude.ai (Relay)  <-->  Local Agent (agentlink)
                                                    |
                                                    v
                                              Local Filesystem
                                              (working directory)
```

## Non-Functional Requirements

- The local agent should maintain a persistent connection to the cloud relay
- Communication should be secure (TLS/WSS)
- The session URL should be unique and hard to guess
- Low latency message forwarding
- Auto-reconnect on connection loss
