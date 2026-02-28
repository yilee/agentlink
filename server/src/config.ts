import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';

export const CONFIG_DIR = join(homedir(), '.agentlink');
const SERVER_RUNTIME_FILE = join(CONFIG_DIR, 'server.json');
const LOG_DIR = join(CONFIG_DIR, 'logs');

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
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

export function getLogDir(): string {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
  return LOG_DIR;
}

// ── Cross-platform process management ──

export function killProcess(pid: number): boolean {
  try {
    if (process.platform === 'win32') {
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
