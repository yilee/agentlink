# BrainCore — Comprehensive Code Summary

## 1. What Is BrainCore?

BrainCore is an internal Microsoft tool that transforms scattered Teams messages, meeting transcripts, and emails into structured, searchable project documentation. Every fact is traced back to its source. It runs on Windows Devboxes and is powered by Claude Code.

BrainCore is the **configuration and skills layer** in a 3-repo architecture:

| Repo | Purpose |
|------|---------|
| **BrainCore** | Skills, agents, data pipeline, installer, launcher, project context |
| **CoreSkill** | Shared API clients (Teams, Email, ADO, SharePoint, Graph) |
| **BrainServer** | Web UI (SessionManagerv3), REST API, WebSocket relay |

All three repos are cloned into `~/.brain/` during installation.

---

## 2. Installation & Setup Flow

### Entry Points

- **`Setup-Brain.ps1`** (511 lines) — One-click installer for Windows Devboxes. Installs prerequisites via winget (Git, GitHub CLI, Node.js, Python 3.12, Azure CLI, VS Code), installs Agent Maestro extension, Claude Code via npm, authenticates GitHub, clones all 3 repos, runs `install.ps1`, starts BrainServer, creates OneDrive BrainData folder, and triggers Azure CLI login.

- **`install.ps1`** (262 lines) — Core installer. Clones/updates BrainCore + CoreSkill, creates `brain.cmd` launcher in `~/.brain/bin/`, adds it to User PATH, creates OneDrive BrainData folder, registers a `BrainRunner` scheduled task (runs at logon), and writes an `install.json` receipt.

- **`install.cmd`** (6 lines) — Simple batch wrapper that calls `install.ps1` via PowerShell.

### Update Mechanism

- **`Update-Brain.ps1`** (291 lines) — Pulls latest BrainCore + CoreSkill, clones/pulls BrainServer, updates pip dependencies, starts/restarts BrainServer, upgrades Claude Code if below minimum version (2.1.71), refreshes the launcher, and ensures the OneDrive folder. Has a self-update mechanism: detects if the script itself changed during `git pull` and re-executes with `--no-self-update`.

- **`update_launcher.ps1`** (70 lines) — Regenerates `brain.cmd` from the latest template without running the full installer. Also runs `generate_claude_md.py` to refresh project context.

### The `brain` Command

The `brain.cmd` launcher:
1. Handles `--update` (calls `Update-Brain.ps1`)
2. Handles `server stop|restart|status` subcommands
3. Sets `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`
4. Runs a runner health check (`brain_runner_check.py`)
5. Launches `claude --add-dir BrainCore --add-dir CoreSkill`

---

## 3. Data Model — Three Layers

### Layer 1: Raw Cache (Immutable)
Raw API responses stored exactly as received. Each fetch gets a unique run ID (`run_YYYYMMDD_HHMMSS_uuid8`). Data is never modified after write — full history is preserved.

**Location:** `data/layer1/{source}/`

### Layer 2: Organized Messages & Entities
Messages normalized into a standard format with dual organization:
- **Time-based:** `teams/YYYY/MM/DD/` directories
- **Entity-based:** `teams/by_chat/{name}/` directories

Entity IDs are deterministic: `YYYYMMDD_HHMMSS_hash8` (MD5 of chat_id + sender + timestamp + preview).

**Location:** `data/layer2/`

### Layer 3: Project Knowledge
Structured project documentation generated from Layer 2 data. Contains workstream files (1500-3000 words each), project READMEs, team rosters, timelines, decision logs, and cross-cutting analyses.

**Location:** `data/layer3/`

---

## 4. Data Pipeline — Four Steps

The pipeline processes 7 data sources through 4 steps:

### Data Sources

| Source | Step 1 (Fetch) | Step 2 (Organize) |
|--------|----------------|-------------------|
| Teams messages | `step1_teams.py` | `step2_teams.py` |
| Meeting transcripts | `step1_meetings.py` | `step2_meetings.py` |
| Emails | `step1_email.py` | `step2_email.py` |
| AML jobs | `step1_aml_jobs.py` | `step2_aml_jobs.py` |
| Cosmos jobs | `step1_cosmos_jobs.py` | `step2_cosmos_jobs.py` |
| Git repos | `step1_git_repos.py` | `step2_git_repos.py` |
| Merge PRs | `step1_merge_prs.py` | `step2_merge_prs.py` |

### Pipeline Steps

1. **Step 1 — Fetch**: Pull raw data from APIs → store in Layer 1 (immutable cache with run provenance)
2. **Step 2 — Organize**: Parse raw data → normalize into standard message format → dual organization (time + entity) → store in Layer 2
3. **Step 3 — Consolidate Entities**: Merge entities across sources, deduplicate, build cross-references
4. **Step 4 — Enrich**: Call external APIs (ADO work items, SharePoint docs, etc.) to add metadata and context

---

## 5. Skills System (18 Skills)

Skills live under `.claude/skills/`. Each skill is a directory with a `SKILL.md` file (YAML front matter + documentation) and supporting scripts.

### Core Data Skill
- **brain-inbox-v3** — The main data pipeline skill. Query tools (`brain_inbox_query.py`, `search_brain.py`, `query_brain_data.py`), operational tools (`brain_briefing.py`, `brain_status.py`), report generators, pipeline steps, continuous runner, unified search.

### Communication Skills
- **teams** — Teams chat interactions
- **teams-channel** — Teams channel operations
- **email-tools** — Email operations
- **meeting-recap** — Meeting transcript processing

### Development Skills
- **azure-devops** — ADO integration
- **sharepoint** — SharePoint document access
- **contribute** — Submit code changes (skill routing: triggered by contribution requests)

### Operational Skills
- **runner-start** — Start background data fetching
- **runner-stop** — Stop background data fetching
- **runner-status** — Check runner status
- **update** — Update BrainCore
- **bootstrap** — First-time setup trigger
- **troubleshoot** — Operational problem diagnosis (skill routing: triggered by troubleshooting requests)
- **bug-report** — Record problems (skill routing: triggered by bug reporting)

### Output Skills
- **daily-briefing** — Generate daily briefings
- **daily-update** — Generate daily updates
- **ppt-gen** — PowerPoint generation

### Skill Routing Rules (`.claude/rules/skill-routing.md`)
Mandatory triggers exist for `troubleshoot`, `bug-report`, and `contribute`. The rules include disambiguation logic between troubleshoot vs. bug-report. These triggers must never be skipped.

---

## 6. Agents (3 Agents)

Agents are long-running definitions under `.claude/agents/`.

### bootstrap.md (879 lines)
First-time setup agent v2.0 with 3 phases:
- **Phase A — Connect**: Set BRAIN_HOME, create dirs, create config.yaml, fetch Teams (30 days), organize, detect/consolidate entities, enrich
- **Phase B — Discover & Learn**: 5 checkpoints — identify projects, map chats, chronological reading, gap analysis (3 levels: Co-CEO/Lead/Executor), generate project config, build progressive learning plan, build Layer 3
- **Phase C — Finalize**: Create brain.yaml master config, generate CLAUDE.md, update install.json

### project-builder.md (895 lines)
Project builder agent v3.0 with 5 phases:
- Discovery & Inventory → Workstream Identification → File Generation → Cross-Cutting Aggregation → Validation & Gap Report

### memory-updater.md
Updates agent memory based on new data.

---

## 7. Infrastructure Modules

### brain_paths.py
Path resolution with priority system. Resolves data directories, config files, and skill paths across the multi-repo setup.

### brain_data.py
`BrainData` class — core data access layer. `RawMessage` wrapper provides a standard interface over different message formats.

### brain_coverage.py
`CoverageTracker` — tracks time ranges per data source, detects gaps in coverage, supports auto-backfill. Used by the runner to know what needs fetching.

### Runner Architecture
The continuous runner (`brain_inbox_v3_runner.py`) operates as:
Poll loop → Pipeline chain (step1 → step2 → step3 → step4) → Coverage update → Auto-backfill → State persistence

Registered as a Windows scheduled task (`BrainRunner`) at logon. Can also be started/stopped via `/runner-start` and `/runner-stop` skills.

---

## 8. Query Tools

The query tool landscape was consolidated from 8 scripts to 3:

| Tool | Purpose |
|------|---------|
| `brain_inbox_query.py` | Query messages with filters (date range, source, sender, keywords) |
| `search_brain.py` | Full-text search across all data |
| `query_brain_data.py` | Structured queries against the data model |

Additional operational tools:
- `brain_briefing.py` — Generate briefings from recent activity
- `brain_status.py` — Show pipeline status, coverage, and health

---

## 9. Configuration

### Key Config Files
- **`config.yaml`** — Per-user pipeline config (subscription IDs, internal URLs). Gitignored; users copy from `config.example.yaml`.
- **`brain.yaml`** — Master project config generated by bootstrap
- **`CLAUDE.md`** — Auto-generated project context for Claude Code sessions (gitignored, regenerated by `generate_claude_md.py`)
- **`install.json`** — Installation receipt tracking what was installed and when

### Rules Files (`.claude/rules/`)
Persistent rules checked into the repo (unlike CLAUDE.md which is auto-generated):
- `project-overview.md` — 3-repo structure, directory layout, key modules
- `architecture.md` — Full data pipeline docs, design principles, runner architecture
- `skill-routing.md` — Mandatory skill triggers for troubleshoot/bug-report/contribute
- `code-patterns.md` — Python 3.8+, pathlib always, explicit UTF-8, CoreSkill import pattern, naming conventions

---

## 10. Code Conventions

From `.claude/rules/code-patterns.md`:
- Python 3.8+ compatibility, procedural/functional style
- `pathlib.Path` exclusively (no `os.path`)
- Explicit UTF-8 encoding on all file I/O
- Windows console encoding patch for non-ASCII output
- CoreSkill imports via `get_coreskill_skill_path()` helper
- `argparse` for CLIs, `print()` + `sys.exit(1)` for errors
- YAML for configuration, JSON for data interchange
- Filename sanitization for Windows compatibility
- `subprocess.run()` with explicit argument lists (no shell=True)

---

## 11. Dependencies

- **Runtime**: Python 3.12, Node.js, Azure CLI, Claude Code (>= 2.1.71), pyyaml
- **External services**: Microsoft Graph API, Azure DevOps, SharePoint, Teams, Cosmos DB, Azure ML
- **Development**: Git, GitHub CLI, VS Code, Agent Maestro extension
- **Platform**: Windows Devboxes only (uses winget, `.cmd` launchers, Windows scheduled tasks)

---

## 12. BrainServer REST API

BrainServer runs a FastAPI service on `localhost:8001`. It provides 60+ REST endpoints for session orchestration, skill/agent management, scheduling, and monitoring. The API is consumed by BrainServer's own HTML dashboards (index, metrics, pipeline, admin) — **not** by Claude slash commands (those go through the skill system).

### Session Management

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sessions` | List all sessions (on-disk + live) |
| POST | `/api/sessions` | Create a new session with profile and group |
| DELETE | `/api/sessions/{session_id}` | Delete a session (stop worker, remove from manager) |
| GET | `/api/sessions/{session_id}/status` | Get live status for a single session |
| GET | `/api/sessions/{session_id}/config` | Get session config and recent log |
| PUT | `/api/sessions/{session_id}/config` | Update session config (partial merge); auto-reconnects on agent-affecting changes |
| GET | `/api/sessions/{session_id}/composed-prompt` | Return fully composed system prompt |
| GET | `/api/sessions/{session_id}/messages` | Get session messages (optional limit, task_id filter) |
| GET | `/api/sessions/{session_id}/log-path` | Get on-disk log file path |
| PATCH | `/api/sessions/{session_id}/add-dirs` | Add/remove add_dirs and auto-reconnect |
| PATCH | `/api/sessions/{session_id}/system-prompt` | Replace or append system prompt and auto-reconnect |

### Task Injection

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/sessions/{session_id}/tasks` | Inject a task into session queue |
| POST | `/api/sessions/{session_id}/trigger` | Manually trigger a task (alias for inject) |
| POST | `/api/sessions/{session_id}/interrupt` | Interrupt the running task |
| POST | `/api/sessions/{session_id}/batch` | Inject multiple tasks in a single request |
| POST | `/api/sessions/{session_id}/reconnect` | Force reconnect to apply pending config |

### Skills & Agents CRUD

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sessions/{session_id}/skills` | List skills visible to a session |
| POST | `/api/sessions/{session_id}/skills` | Create a new skill |
| POST | `/api/sessions/{session_id}/skills/batch` | Batch create multiple skills |
| GET | `/api/sessions/{session_id}/skills/{name}` | Read a skill's SKILL.md content |
| PUT | `/api/sessions/{session_id}/skills/{name}` | Update a skill's SKILL.md |
| DELETE | `/api/sessions/{session_id}/skills/{name}` | Delete a skill directory |
| GET | `/api/sessions/{session_id}/agents` | List agents visible to a session |
| POST | `/api/sessions/{session_id}/agents` | Create a new agent |
| POST | `/api/sessions/{session_id}/agents/batch` | Batch create multiple agents |
| GET | `/api/sessions/{session_id}/agents/{name}` | Read an agent's content |
| PUT | `/api/sessions/{session_id}/agents/{name}` | Update an agent .md file |
| DELETE | `/api/sessions/{session_id}/agents/{name}` | Delete an agent .md file |
| GET | `/api/sessions/{session_id}/discovery` | Full skills + agents listing |

### Subscribers & Metadata

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sessions/{session_id}/subscribers` | List subscribers |
| POST | `/api/sessions/{session_id}/subscribers` | Add a delivery subscriber |
| PUT | `/api/sessions/{session_id}/subscribers/{id}` | Update subscriber fields |
| DELETE | `/api/sessions/{session_id}/subscribers/{id}` | Remove a subscriber |
| GET | `/api/sessions/{session_id}/metadata` | Get session metadata |
| PUT | `/api/sessions/{session_id}/metadata` | Update session metadata |

### Groups

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/groups` | List groups with session counts |
| POST | `/api/groups/{group_name}/trigger` | Inject task into all sessions in group |
| PUT | `/api/groups/{group_name}/pause` | Pause all sessions in group |
| PUT | `/api/groups/{group_name}/resume` | Resume all sessions in group |
| DELETE | `/api/groups/{group_name}` | Delete all sessions in group |

### Scheduler

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/scheduler/jobs` | List all scheduled jobs |
| POST | `/api/scheduler/jobs` | Create a new scheduled job |
| GET | `/api/scheduler/jobs/{job_id}` | Get a single job |
| PATCH | `/api/scheduler/jobs/{job_id}` | Update job fields |
| DELETE | `/api/scheduler/jobs/{job_id}` | Delete a job |
| POST | `/api/scheduler/jobs/{job_id}/pause` | Pause a job |
| POST | `/api/scheduler/jobs/{job_id}/resume` | Resume a paused job |

Job types: `heartbeat` (skips when busy), `scheduled_job` (dedup), `mandatory` (always fires). Supports `interval_seconds` and `cron_expr` triggers with timezone support. Persists to `~/.sessions/scheduler_jobs.yaml`.

### Approvals

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/approvals` | List approval requests (filterable by session_id) |
| POST | `/api/approvals/{id}/respond` | Respond to an approval request |
| POST | `/api/approvals/{id}/cancel` | Cancel an approval request |

### Teams/Excel Integration

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/teams-poller/status` | Get Teams/Excel poller status |
| POST | `/api/teams-poller/start` | Start the Teams/Excel poller |
| POST | `/api/teams-poller/stop` | Stop the Teams/Excel poller |
| POST | `/api/linked-sessions` | Create a Teams-linked session with poller |
| GET | `/api/linked-sessions` | List all Teams-linked sessions |
| DELETE | `/api/linked-sessions/{name}` | Delete a Teams-linked session |

### Meeting Recap

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/meeting-recap/status` | Get meeting recap listener status |
| POST | `/api/meeting-recap/start` | Start the meeting recap listener |
| POST | `/api/meeting-recap/stop` | Stop the meeting recap listener |
| PATCH | `/api/meeting-recap/config` | Update meeting recap configuration |
| GET | `/api/meeting-recap/recaps` | List recap .md files |

### Monitoring & System

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Component-level health status |
| GET | `/api/metrics` | System-wide metrics dashboard data |
| GET | `/api/pipeline` | Data processing pipeline analysis |
| GET | `/api/audit` | Query recent audit log entries |
| POST | `/api/shutdown` | Graceful shutdown |
| POST | `/api/restart` | Graceful restart (exit code 42, launcher restarts) |

### API Consumers

The REST API is consumed **only** by BrainServer's own HTML dashboards:
- `templates/index.html` — Main dashboard
- `templates/admin.html` — Admin console (uses 26+ endpoints)
- `templates/metrics.html` — Metrics dashboard
- `templates/pipeline.html` — Pipeline status dashboard

Slash commands (`/teams`, `/email`, etc.) do **not** call these endpoints — they go through Claude's skill system via `--add-dir`.
