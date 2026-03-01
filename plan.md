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
