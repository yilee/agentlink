# Ephemeral Mode & Misc Fixes

Tracked issues discovered during config/auto-update audit (2026-03-14).

## Client (`agent/src/`)

### 1. `--ephemeral` reads config.json (password, server, name)

**File:** `cli.ts` → `resolveConfig(options)` at start action

**Problem:** `resolveConfig()` merges `fileConfig.password`, `fileConfig.server`, `fileConfig.name` from `~/.agentlink/config.json`. Ephemeral mode is for isolated testing — it shouldn't inherit production config, especially password (forces test clients to authenticate) or server (may connect to production relay instead of local test server).

**Fix:** Add `ignoreConfigFile` param to `resolveConfig()`. When `--ephemeral`, call `resolveConfig(options, true)` so only CLI flags + defaults are used.

### 2. `--ephemeral` can write to config.json

**File:** `cli.ts` lines 47-56

**Problem:** If `--password` or `--auto-update` is passed alongside `--ephemeral`, `saveConfig()` writes to `config.json`, polluting the production daemon's config.

**Fix:** Skip `saveConfig()` when `--ephemeral` is set.

### 3. `--ephemeral` triggers autoUpdate checker

**File:** `index.ts` line 51

**Problem:** If `config.json` has `autoUpdate: true`, ephemeral foreground mode starts the auto-update checker. While foreground mode only prints a notification (doesn't auto-install), it's unnecessary noise for test runs.

**Fix:** Resolved by fix #1 — ephemeral won't read `autoUpdate` from config.json.

## Server (`server/src/`)

### 4. `upgrade` command: Windows path wrong

**File:** `server/src/cli.ts` lines 294-296

**Problem:**
```typescript
const newBin = join(npmPrefix, 'bin', 'agentlink-server');
```
On Windows, npm global prefix has no `bin/` subdirectory. Should be:
```typescript
const newBin = process.platform === 'win32'
  ? join(npmPrefix, 'agentlink-server.cmd')
  : join(npmPrefix, 'bin', 'agentlink-server');
```

### 5. Server daemon logs not rotated

**File:** `server/src/cli.ts` lines 52-53

**Problem:** Server daemon uses fixed filenames `server.log` / `server.err` that grow unbounded. Client already has daily rotation (`agent-YYYY-MM-DD.log`).

**Fix:** Apply the same daily log rotation pattern: `server-YYYY-MM-DD.log`, `server-YYYY-MM-DD.err`, with `cleanOldLogs()`. Need to add `getLogDate()` and `cleanOldLogs()` to `server/src/config.ts` (or share from a common module).

### 6. Server `log` command needs to find dated files

**File:** `server/src/cli.ts` lines 182-184

**Problem:** Once log rotation is implemented (fix #5), the `log` command needs the same `findLatestLog()` logic that the client already has.

## Priority

- **Fix #1 + #2** are the most important — ephemeral mode is broken for its intended purpose (isolated testing).
- **Fix #4** blocks server upgrade on Windows.
- **Fix #5 + #6** are nice-to-have (server logs grow slowly in practice).
