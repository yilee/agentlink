import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';

export interface AgentConfig {
  server: string;
  dir: string;
  name: string;
}

const DEFAULTS: AgentConfig = {
  server: 'wss://msclaude.ai',
  dir: process.cwd(),
  name: `Agent-${process.platform}-${process.pid}`,
};

export const CONFIG_DIR = join(homedir(), '.agentlink');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const RUNTIME_FILE = join(CONFIG_DIR, 'agent.json');
const SERVER_RUNTIME_FILE = join(CONFIG_DIR, 'server.json');
const LOG_DIR = join(CONFIG_DIR, 'logs');

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): Partial<AgentConfig> {
  try {
    const raw = readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw) as Partial<AgentConfig>;
  } catch {
    return {};
  }
}

export function saveConfig(partial: Partial<AgentConfig>): void {
  ensureConfigDir();
  const existing = loadConfig();
  const merged = { ...existing, ...partial };
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

/**
 * Resolve final config: CLI flags > config file > defaults
 */
export function resolveConfig(cliOptions: Partial<AgentConfig>): AgentConfig {
  const fileConfig = loadConfig();
  return {
    server: cliOptions.server || fileConfig.server || DEFAULTS.server,
    dir: cliOptions.dir || fileConfig.dir || DEFAULTS.dir,
    name: cliOptions.name || fileConfig.name || DEFAULTS.name,
  };
}

// ── Runtime state (written by running agent, read by `status` command) ──

export interface RuntimeState {
  pid: number;
  sessionId: string;
  sessionUrl: string;
  server: string;
  name: string;
  dir: string;
  startedAt: string;
}

export function saveRuntimeState(state: RuntimeState): void {
  ensureConfigDir();
  writeFileSync(RUNTIME_FILE, JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

export function loadRuntimeState(): RuntimeState | null {
  try {
    const raw = readFileSync(RUNTIME_FILE, 'utf-8');
    return JSON.parse(raw) as RuntimeState;
  } catch {
    return null;
  }
}

export function clearRuntimeState(): void {
  try {
    unlinkSync(RUNTIME_FILE);
  } catch {
    // file may not exist
  }
}

export function getLogDir(): string {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
  return LOG_DIR;
}

// ── Server runtime state ──

export interface ServerRuntimeState {
  pid: number;
  port: number;
  startedAt: string;
}

export function saveServerRuntimeState(state: ServerRuntimeState): void {
  ensureConfigDir();
  writeFileSync(SERVER_RUNTIME_FILE, JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

export function loadServerRuntimeState(): ServerRuntimeState | null {
  try {
    const raw = readFileSync(SERVER_RUNTIME_FILE, 'utf-8');
    return JSON.parse(raw) as ServerRuntimeState;
  } catch {
    return null;
  }
}

export function clearServerRuntimeState(): void {
  try {
    unlinkSync(SERVER_RUNTIME_FILE);
  } catch {
    // file may not exist
  }
}

// ── Cross-platform process kill ──

export function killProcess(pid: number): boolean {
  try {
    if (process.platform === 'win32') {
      // On Windows, process.kill(pid, 'SIGTERM') doesn't reliably terminate
      // processes started in separate console windows. Use taskkill instead.
      execSync(`taskkill /pid ${pid} /f /t`, { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGTERM');
    }
    return true;
  } catch {
    return false;
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
