import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, readdirSync } from 'fs';
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
  if (process.env.AGENTLINK_NO_STATE) return;
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
  if (process.env.AGENTLINK_NO_STATE) return;
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
      execSync(`taskkill /pid ${pid} /f /t`, { stdio: 'ignore', windowsHide: true });
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

// ── Log rotation ──

/** Return today's date as YYYY-MM-DD for log file naming. */
export function getLogDate(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Delete server log files older than `days` days from the log directory. */
export function cleanOldLogs(days: number = 7): void {
  const dir = getLogDir();
  const cutoff = Date.now() - days * 86400_000;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const m = name.match(/^server-(\d{4}-\d{2}-\d{2})\.(log|err)$/);
    if (!m) continue;
    const fileDate = new Date(m[1] + 'T00:00:00').getTime();
    if (isNaN(fileDate) || fileDate >= cutoff) continue;
    try {
      unlinkSync(join(dir, name));
    } catch {}
  }
}

// ── PID file for test harness ──

export interface PidFileInfo {
  pid: number;
  port?: number;
}

export function writePidFile(filePath: string, info: PidFileInfo): void {
  writeFileSync(filePath, JSON.stringify(info, null, 2) + '\n', 'utf-8');
}

export function readPidFile(filePath: string): PidFileInfo | null {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as PidFileInfo;
  } catch {
    return null;
  }
}
