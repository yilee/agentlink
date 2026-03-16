# Extensions Panel — Design Document

## 1. Overview

Add an Extensions panel to the AgentLink web UI sidebar, allowing users to view the Claude agent's installed plugins, MCP servers, skills, and configuration from the browser.

Currently, users must SSH into the agent's host machine and run `claude plugin list`, `claude mcp list`, etc. to see what extensions are available. This feature surfaces that information directly in the web UI.

### Goals

- View installed plugins with name, version, scope, enabled/disabled status
- View MCP servers with connection status (connected / failed)
- View available skills provided by plugins
- View basic agent configuration (model, permission mode)
- Enable/disable plugins from the web UI
- Uninstall plugins from the web UI
- Add/remove standalone MCP servers from the web UI

### Non-goals

- Installing new plugins from marketplaces (complex interactive flow, better done via CLI)
- Editing plugin source code or skill definitions
- Managing Claude's `settings.json` directly (env vars, permissions, etc.)
- Real-time MCP server health monitoring (refresh-on-open is sufficient)

### Prerequisites

- **i18n system** — All user-facing strings must use `t()` with keys in both `server/web/public/locales/en.json` and `server/web/public/locales/zh.json`.

---

## 2. Data Sources

### 2.1 Plugin List — `claude plugin list --json`

Returns a JSON array of installed plugins. This is the primary data source.

```json
[
  {
    "id": "playwright@claude-plugins-official",
    "version": "d49ad3558669",
    "scope": "user",
    "enabled": true,
    "installPath": "C:\\Users\\...\\playwright\\d49ad3558669",
    "installedAt": "2026-02-03T09:05:52.457Z",
    "lastUpdated": "2026-02-03T09:05:52.457Z",
    "mcpServers": {
      "playwright": { "command": "npx", "args": ["@playwright/mcp@latest"] }
    }
  },
  {
    "id": "codeblend@spark-claude-plugins",
    "version": "1.0.14",
    "scope": "user",
    "enabled": true,
    "installPath": "C:\\Users\\...\\codeblend\\1.0.14",
    "installedAt": "2026-03-03T09:01:49.347Z",
    "lastUpdated": "2026-03-03T09:01:49.347Z"
  }
]
```

Key fields: `id` (plugin@marketplace), `version`, `scope` (user/project/local), `enabled`, `mcpServers` (optional).

### 2.2 Plugin Metadata — `<installPath>/.claude-plugin/plugin.json`

Each installed plugin has a manifest with name, description, and author:

```json
{
  "name": "playwright",
  "description": "Browser automation and end-to-end testing MCP server by Microsoft.",
  "author": { "name": "Microsoft" }
}
```

### 2.3 Plugin Skills — `<installPath>/skills/*/SKILL.md`

Each skill is a directory containing a `SKILL.md` with YAML frontmatter:

```markdown
---
name: codeblend-commit
description: Analyzes staged git changes and creates intelligent commits...
---
```

The agent scans `<installPath>/skills/` for subdirectories to discover skills.

### 2.4 MCP Server List — `claude mcp list`

Returns human-readable text output (no `--json` flag available):

```
Checking MCP server health...

plugin:playwright:playwright: npx @playwright/mcp@latest - ✓ Connected
```

Format per line: `<name>: <command> - ✓ Connected` or `✗ Failed`.

The agent must parse this text output to extract server name and status.

### 2.5 Configuration — `~/.claude/settings.json`

Contains model, enabled plugins, permissions, etc.:

```json
{
  "model": "opus[1m]",
  "enabledPlugins": {
    "playwright@claude-plugins-official": true,
    "codeblend@spark-claude-plugins": true
  }
}
```

### 2.6 Per-Project MCP Config — `~/.claude.json` → `projects.<workDir>.mcpServers`

Per-project MCP server configuration:

```json
{
  "projects": {
    "Q:/src/agentlink": {
      "mcpServers": {},
      "enabledMcpjsonServers": [],
      "disabledMcpjsonServers": []
    }
  }
}
```

---

## 3. UI Design

### 3.1 Entry Point: Working Directory Menu

Add a fifth item to the existing working directory dropdown menu (after "Memory"):

```
┌────────────────────────┐
│ 📂 Browse Files        │
│ 📁 Change Directory    │
│ 📋 Copy Path           │
│ 📄 Memory              │
│ 🧩 Extensions      NEW │
└────────────────────────┘
```

Clicking "Extensions" sets `sidebarView = 'extensions'`, which switches the sidebar to the Extensions panel. This follows the same pattern as the Memory panel.

### 3.2 Extensions Panel Layout

The panel occupies the full sidebar area (replaces the session list). It has a back button to return to `sidebarView = 'sessions'`.

```
┌─────────────────────────────────┐
│ ← Sessions    Extensions     ↻  │  header with back + refresh
├─────────────────────────────────┤
│                                 │
│ PLUGINS                         │  section header
│                                 │
│ ┌─ playwright ─────────────────┐│
│ │ claude-plugins-official       ││  marketplace source
│ │ d49ad355 · user        ● ON  ││  version · scope · toggle
│ │ MCP: playwright          ✓   ││  provided MCP server + status
│ └──────────────────────────────┘│
│                                 │
│ ┌─ codeblend ──────────────────┐│
│ │ spark-claude-plugins          ││
│ │ 1.0.14 · user          ● ON  ││
│ │ Skill: codeblend-commit       ││  provided skill
│ └──────────────────────────────┘│
│                                 │
│ ┌─ playwright-cli ─────────────┐│
│ │ playwright-cli                ││
│ │ 0.0.1 · project       ○ OFF  ││  disabled = dimmed
│ └──────────────────────────────┘│
│                                 │
├─────────────────────────────────┤
│ MCP SERVERS                     │  section header
│                                 │
│  playwright              ✓  🟢 │  name + connected indicator
│  (via plugin:playwright)        │  source label (small text)
│                                 │
│  No standalone MCP servers      │  empty state if none
│                                 │
├─────────────────────────────────┤
│ SKILLS                          │  section header
│                                 │
│  codeblend-commit               │
│  simplify                       │
│  loop                           │
│  claude-api                     │
│                                 │
├─────────────────────────────────┤
│ CONFIG                          │  section header
│                                 │
│  Model       claude-opus-4.6   │
│  Mode        bypassPermissions │
│                                 │
└─────────────────────────────────┘
```

### 3.3 Plugin Card Design

Each plugin is rendered as a card (`.extension-plugin-card`), styled similarly to `.session-item`:

```
┌─ {plugin.name} ──────────────────────┐
│ {marketplace}                         │  0.7rem, secondary color
│ {version} · {scope}           ● ON   │  metadata + toggle
│ MCP: {serverName}               ✓    │  (if plugin provides MCP)
│ Skill: {skillName}                    │  (if plugin provides skills)
└───────────────────────────────────────┘
```

- **Name** — bold, primary color, `font-size: 0.85rem`
- **Marketplace** — secondary color, `font-size: 0.7rem`
- **Version + Scope** — monospace, secondary color, `font-size: 0.72rem`
- **Toggle** — `● ON` in `var(--success)`, `○ OFF` in `var(--text-secondary)`
- **MCP/Skill line** — `font-size: 0.72rem`, only shown if the plugin provides them
- **Disabled state** — entire card at `opacity: 0.6`
- **Hover** — `background: var(--bg-tertiary)` (same as session items)
- **Uninstall** — red `×` button, visibility hidden until card hover (same pattern as session delete)

### 3.4 MCP Server Row

Simple inline row (`.extension-mcp-row`):

```
  {name}                        {status}
  (via {source})
```

- **Name** — primary color, `font-size: 0.82rem`
- **Status indicator** — colored dot: `var(--success)` for Connected, `var(--error)` for Failed
- **Source label** — secondary color, `font-size: 0.68rem`, e.g., "via plugin:playwright"
- **Delete button** — appears on hover for standalone (non-plugin) MCP servers only

### 3.5 Skill Row

Simple list item (`.extension-skill-row`):

```
  {name}
```

- `font-size: 0.82rem`, primary color
- Read-only display, no actions

### 3.6 Config Section

Key-value pairs in a compact grid (`.extension-config`):

```
  Model    claude-opus-4.6
  Mode     bypassPermissions
```

- **Key** — `font-size: 0.72rem`, secondary color, `width: 70px`
- **Value** — `font-size: 0.72rem`, primary color, monospace

### 3.7 Section Headers

Reuse existing sidebar section header styling:

```css
.extension-section-label {
  text-transform: uppercase;
  font-size: 0.7rem;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
  padding: 12px 16px 4px;
}
```

### 3.8 Empty States

- **No plugins:** "No plugins installed"
- **No MCP servers:** "No MCP servers configured"
- **No skills:** "No skills available"

### 3.9 Loading State

While fetching data, show a loading spinner or text (reuse `file-panel-loading` pattern):

```
Loading extensions...
```

---

## 4. WebSocket Protocol

### 4.1 New Message Types

**Web → Agent:**

| Type | Purpose | Key fields |
|------|---------|------------|
| `query_extensions` | Request extensions info | — |
| `plugin_toggle` | Enable/disable plugin | `pluginId`, `enabled` |
| `plugin_uninstall` | Uninstall plugin | `pluginId` |
| `mcp_remove` | Remove MCP server | `name`, `scope?` |
| `mcp_add` | Add MCP server | `name`, `transport`, `command`, `args[]`, `scope?` |

**Agent → Web:**

| Type | Purpose | Key fields |
|------|---------|------------|
| `extensions_info` | Full extensions data | `plugins[]`, `mcpServers[]`, `skills[]`, `config{}` |
| `extension_action_result` | Result of a mutating action | `action`, `success`, `error?` |

### 4.2 Data Structures

```typescript
interface ExtensionsInfo {
  plugins: PluginInfo[];
  mcpServers: McpServerInfo[];
  skills: SkillInfo[];
  config: AgentConfig;
}

interface PluginInfo {
  id: string;           // e.g., "playwright@claude-plugins-official"
  name: string;         // e.g., "playwright"
  marketplace: string;  // e.g., "claude-plugins-official"
  version: string;
  scope: 'user' | 'project' | 'local';
  enabled: boolean;
  description?: string; // from plugin.json
  author?: string;      // from plugin.json
  mcpServers?: string[];  // names of MCP servers this plugin provides
  skills?: string[];      // names of skills this plugin provides
}

interface McpServerInfo {
  name: string;               // e.g., "plugin:playwright:playwright"
  displayName: string;        // e.g., "playwright"
  command: string;            // e.g., "npx @playwright/mcp@latest"
  status: 'connected' | 'failed' | 'unknown';
  source: 'plugin' | 'project' | 'user' | 'local';  // where it's configured
  pluginId?: string;          // if provided by a plugin
}

interface SkillInfo {
  name: string;         // e.g., "codeblend-commit"
  description?: string; // from SKILL.md frontmatter
  pluginId?: string;    // which plugin provides it
}

interface AgentConfig {
  model?: string;       // e.g., "opus[1m]"
  permissionMode?: string;  // e.g., "bypassPermissions"
}
```

### 4.3 Message Flow

```
[1] User clicks "Extensions" menu item
    → sidebarView = 'extensions'
    → Web sends: { type: 'query_extensions' }

[2] Agent receives query_extensions
    → Spawns: claude plugin list --json → parses JSON
    → Spawns: claude mcp list → parses text
    → Reads: <installPath>/.claude-plugin/plugin.json (for each plugin)
    → Scans: <installPath>/skills/*/ (for each plugin)
    → Reads: ~/.claude/settings.json (for config)
    → Sends: { type: 'extensions_info', plugins, mcpServers, skills, config }

[3] Web receives extensions_info → renders panel

[4] User toggles a plugin
    → Web sends: { type: 'plugin_toggle', pluginId: 'codeblend@spark-claude-plugins', enabled: false }

[5] Agent receives plugin_toggle
    → Spawns: claude plugin disable codeblend@spark-claude-plugins
    → Sends: { type: 'extension_action_result', action: 'plugin_toggle', success: true }
    → Immediately follows with a fresh { type: 'extensions_info', ... } to refresh the UI
```

---

## 5. Agent Implementation

### 5.1 New Module: `agent/src/extensions.ts`

```typescript
export async function queryExtensions(workDir: string): Promise<ExtensionsInfo>;
export async function togglePlugin(pluginId: string, enabled: boolean): Promise<ActionResult>;
export async function uninstallPlugin(pluginId: string): Promise<ActionResult>;
export async function addMcpServer(name: string, transport: string, command: string, args: string[], scope?: string): Promise<ActionResult>;
export async function removeMcpServer(name: string, scope?: string): Promise<ActionResult>;
```

### 5.2 queryExtensions Implementation

1. **Get plugins** — `spawn('claude', ['plugin', 'list', '--json'])`, parse stdout as JSON array.
2. **Enrich plugins** — For each plugin, read `<installPath>/.claude-plugin/plugin.json` for description/author, scan `<installPath>/skills/*/SKILL.md` for skills, extract `mcpServers` keys from the plugin list JSON.
3. **Get MCP servers** — `spawn('claude', ['mcp', 'list'])`, parse text output line by line. Extract name, command, and status (`✓ Connected` / `✗ Failed`).
4. **Get config** — Read `~/.claude/settings.json`, extract `model` field. Permission mode from the agent's current runtime state.
5. **Assemble and return** `ExtensionsInfo`.

### 5.3 Mutation Commands

| Action | Claude CLI Command |
|--------|-------------------|
| Enable plugin | `claude plugin enable <pluginId>` |
| Disable plugin | `claude plugin disable <pluginId>` |
| Uninstall plugin | `claude plugin uninstall <pluginId>` |
| Add MCP server | `claude mcp add -s <scope> -t <transport> <name> <command> [args...]` |
| Remove MCP server | `claude mcp remove <name> [-s <scope>]` |

All mutations are fire-and-forget spawns. After completion, a fresh `query_extensions` is executed to send updated state to the web client.

### 5.4 Message Handling in `connection.ts`

Add cases to the agent's WebSocket message handler:

```typescript
case 'query_extensions':
  const info = await queryExtensions(workDir);
  wsSend({ type: 'extensions_info', ...info });
  break;

case 'plugin_toggle':
  const result = await togglePlugin(msg.pluginId, msg.enabled);
  wsSend({ type: 'extension_action_result', action: 'plugin_toggle', ...result });
  // Refresh
  const refreshed = await queryExtensions(workDir);
  wsSend({ type: 'extensions_info', ...refreshed });
  break;

// ... similar for plugin_uninstall, mcp_add, mcp_remove
```

---

## 6. Web Implementation

### 6.1 New Module: `server/web/src/modules/extensions.js`

Factory module following the existing pattern:

```javascript
export function createExtensions({ wsSend, onMessage }) {
  const extensions = ref(null);    // ExtensionsInfo
  const loading = ref(false);
  const actionPending = ref(false);

  function query() { ... }         // sends query_extensions
  function togglePlugin(id, enabled) { ... }  // sends plugin_toggle
  function uninstallPlugin(id) { ... }        // sends plugin_uninstall
  function addMcpServer(...) { ... }          // sends mcp_add
  function removeMcpServer(name) { ... }      // sends mcp_remove

  // Handle incoming extensions_info and extension_action_result
  onMessage('extensions_info', (msg) => { ... });
  onMessage('extension_action_result', (msg) => { ... });

  return { extensions, loading, actionPending, query, togglePlugin, uninstallPlugin, addMcpServer, removeMcpServer };
}
```

### 6.2 New Component: `server/web/src/components/ExtensionsPanel.vue`

Single-file component for the extensions sidebar panel. Injected via `inject('extensions')`.

Renders 4 sections: Plugins, MCP Servers, Skills, Config. Each section uses a `v-for` loop over the respective array.

### 6.3 Store Integration

In `store.js`:
- Import and create `createExtensions(deps)` module
- Provide it via `provide('extensions', store._extensions)`
- Wire `sidebarView` to trigger `query()` when set to `'extensions'`

### 6.4 Sidebar Integration

In `Sidebar.vue`:
- Add `sidebarView === 'extensions'` template branch (alongside `files`, `memory`, `preview`)
- Add "Extensions" menu item to `workdir-menu`

### 6.5 Handler Integration

In `modules/handlers/feature-handler.js` (or a new handler file):
- Handle `extensions_info` and `extension_action_result` messages

### 6.6 CSS

New file: `server/web/src/css/extensions.css`

Import in `main.js` alongside existing CSS files. Reuses CSS variables from `base.css`.

---

## 7. i18n Keys

Add to both `en.json` and `zh.json`:

```json
{
  "sidebar": {
    "extensions": "Extensions"
  },
  "extensions": {
    "title": "Extensions",
    "refresh": "Refresh",
    "loading": "Loading extensions...",
    "plugins": "Plugins",
    "mcpServers": "MCP Servers",
    "skills": "Skills",
    "config": "Config",
    "noPlugins": "No plugins installed",
    "noMcpServers": "No MCP servers configured",
    "noSkills": "No skills available",
    "enabled": "ON",
    "disabled": "OFF",
    "connected": "Connected",
    "failed": "Failed",
    "uninstall": "Uninstall",
    "uninstallConfirm": "Uninstall {name}?",
    "addMcpServer": "Add MCP Server",
    "removeMcpServer": "Remove",
    "scope": {
      "user": "user",
      "project": "project",
      "local": "local"
    },
    "actionSuccess": "Done",
    "actionError": "Failed: {error}",
    "restartNote": "Changes take effect on next conversation"
  }
}
```

---

## 8. Implementation Phases

### Phase 1: Read-Only Display (MVP)

1. Agent: implement `queryExtensions()` in new `extensions.ts` module
2. Agent: handle `query_extensions` message in `connection.ts`
3. Web: implement `createExtensions()` module
4. Web: implement `ExtensionsPanel.vue` component (read-only)
5. Web: add "Extensions" menu item and `sidebarView` branch in `Sidebar.vue`
6. Web: add CSS in `extensions.css`
7. i18n: add translation keys
8. Tests: unit tests for `extensions.ts` parsing logic

### Phase 2: Mutation Actions

1. Agent: implement `togglePlugin()`, `uninstallPlugin()`, `removeMcpServer()`
2. Agent: handle `plugin_toggle`, `plugin_uninstall`, `mcp_remove` messages
3. Web: add toggle switches, uninstall buttons, remove buttons to `ExtensionsPanel.vue`
4. Web: add confirmation dialogs for uninstall/remove
5. Web: add "Changes take effect on next conversation" notice
6. Tests: unit tests for mutation commands

### Phase 3: Add MCP Server (Stretch)

1. Agent: implement `addMcpServer()`
2. Agent: handle `mcp_add` message
3. Web: add "Add MCP Server" form (name, transport, command, args)
4. Web: form validation and error handling
5. Tests: functional tests

---

## 9. Security Considerations

- **Plugin toggle/uninstall** — These modify `~/.claude/settings.json` and `~/.claude/plugins/` on the agent's host machine. Since the web UI already has full agent control (can send arbitrary prompts, change working directory, cancel execution), this is consistent with the existing security model.
- **MCP add** — Adding a new MCP server means specifying a command that will be executed on the host. This has the same trust level as sending a chat message that asks Claude to run a shell command. No additional authentication is needed beyond the existing session auth.
- **No secrets exposure** — The extensions info does not include environment variables, API keys, or other sensitive data from MCP server configurations. Only names, commands, and status are exposed.

---

## 10. Testing

### Unit Tests (`test/agent/extensions.test.ts`)

- Parse `claude plugin list --json` output correctly
- Parse `claude mcp list` text output (connected, failed, various formats)
- Parse `plugin.json` metadata
- Scan skills directories
- Handle missing/malformed files gracefully

### Functional Tests (`test/functional/extensions.test.ts`)

- Mock agent sends `extensions_info` → verify panel renders plugins, MCP servers, skills, config
- Click "Extensions" menu item → verify `query_extensions` message sent
- Click refresh → verify `query_extensions` message sent again
- Toggle plugin → verify `plugin_toggle` message sent with correct fields
- Empty state rendering (no plugins, no MCP servers)

---

## 11. File Changes Summary

### New Files

| File | Purpose |
|------|---------|
| `agent/src/extensions.ts` | Query and mutate extensions via Claude CLI |
| `server/web/src/components/ExtensionsPanel.vue` | Vue SFC for the panel |
| `server/web/src/modules/extensions.js` | Reactive state module |
| `server/web/src/css/extensions.css` | Panel styling |
| `test/agent/extensions.test.ts` | Agent unit tests |
| `test/functional/extensions.test.ts` | Functional tests |

### Modified Files

| File | Change |
|------|--------|
| `agent/src/connection.ts` | Handle new message types |
| `server/web/src/store.js` | Create and provide extensions module |
| `server/web/src/components/Sidebar.vue` | Add menu item + panel branch |
| `server/web/src/main.js` | Import `extensions.css` |
| `server/web/public/locales/en.json` | Add i18n keys |
| `server/web/public/locales/zh.json` | Add i18n keys |
| `server/src/message-relay.ts` | Relay new message types (transparent, no special handling needed) |
