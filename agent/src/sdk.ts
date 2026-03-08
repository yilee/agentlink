/**
 * Utility helpers for spawning the Claude Code CLI.
 * Locates the executable, builds a clean environment, and
 * handles Windows .cmd wrapper parsing.
 */
import { platform, homedir } from 'os';
import { join, dirname } from 'path';
import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';

export function isWindows(): boolean {
  return platform() === 'win32';
}

function getEnhancedPath(): string {
  if (isWindows()) {
    const systemPaths = [
      'C:\\Windows\\system32',
      'C:\\Windows',
      'C:\\Windows\\System32\\Wbem',
    ];
    const currentPath = process.env.PATH || process.env.Path || '';
    const parts = currentPath.split(';').filter(Boolean);
    for (const sp of systemPaths) {
      if (!parts.some(p => p.toLowerCase() === sp.toLowerCase())) {
        parts.push(sp);
      }
    }
    return parts.join(';');
  }

  const unixPaths = [
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    join(homedir(), '.local', 'bin'),
    join(homedir(), '.npm-global', 'bin'),
  ];
  if (platform() === 'darwin') unixPaths.push('/opt/homebrew/bin');
  unixPaths.push(join(process.execPath, '..'));

  const currentPath = process.env.PATH || '';
  const parts = currentPath.split(':').filter(Boolean);
  for (const sp of unixPaths) {
    if (!parts.includes(sp)) parts.push(sp);
  }
  return parts.join(':');
}

export function getDefaultClaudeCodePath(): string {
  if (process.env.CLAUDE_PATH) return process.env.CLAUDE_PATH;

  if (!isWindows()) {
    const candidates = [
      '/usr/local/bin/claude',
      join(homedir(), '.local', 'bin', 'claude'),
      join(homedir(), '.npm-global', 'bin', 'claude'),
      join(process.execPath, '..', 'claude'),
    ];
    if (platform() === 'darwin') candidates.push('/opt/homebrew/bin/claude');
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
  }

  try {
    const enhancedPath = getEnhancedPath();
    const cmd = isWindows() ? 'where claude' : 'which claude';
    const output = execSync(cmd, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
      env: { ...process.env, PATH: enhancedPath },
      windowsHide: true,
    }).toString().trim();
    const lines = output.split('\n').map(l => l.trim()).filter(Boolean);

    if (isWindows() && lines.length > 1) {
      const preferred = lines.find(l => /\.(cmd|exe)$/i.test(l));
      if (preferred) return preferred;
    }
    if (lines[0]) return lines[0];
  } catch { /* fallthrough */ }

  return 'claude';
}

export function getCleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // Remove CLAUDECODE to allow spawning Claude CLI from within a Claude Code session
  delete env.CLAUDECODE;
  if (isWindows()) {
    if (!env.COMSPEC) env.COMSPEC = 'C:\\Windows\\system32\\cmd.exe';
    if (!env.SystemRoot) env.SystemRoot = 'C:\\Windows';
  }
  env.PATH = getEnhancedPath();
  return env;
}

export interface ResolvedCommand {
  command: string;
  prefixArgs: string[];
  spawnOpts: Record<string, unknown>;
}

/**
 * Resolve the claude executable into spawn-ready components.
 * On Windows npm installs, parses the .cmd wrapper to call node directly,
 * avoiding cmd.exe flash and PowerShell execution policy issues.
 */
export function resolveClaudeCommand(): ResolvedCommand {
  const execPath = getDefaultClaudeCodePath();

  if (isWindows() && execPath.toLowerCase().endsWith('.cmd')) {
    try {
      const cmdContent = readFileSync(execPath, 'utf-8');
      const match =
        cmdContent.match(/%dp0%\\(.+?\.js)"/i) ||
        cmdContent.match(/%dp0%\\(.+?\.js)/i);
      if (match) {
        const cliJsPath = join(dirname(execPath), match[1]);
        if (existsSync(cliJsPath)) {
          return { command: process.execPath, prefixArgs: [cliJsPath], spawnOpts: {} };
        }
      }
    } catch { /* fallthrough */ }

    const ps1Path = execPath.slice(0, -4) + '.ps1';
    if (existsSync(ps1Path)) {
      return {
        command: 'powershell.exe',
        prefixArgs: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1Path],
        spawnOpts: {},
      };
    }
  }

  // windowsHide: true is set in claude.ts spawn() call, which prevents console
  // flash for the process and its children. Do NOT set detached: true here —
  // detached creates a new process group with its own console, and grandchild
  // processes (Claude's tool calls) inherit that console visibility, causing
  // repeated console window flashes on every operation.
  return { command: execPath, prefixArgs: [], spawnOpts: {} };
}

/**
 * Pipe an AsyncIterable of messages into a child stdin as JSON lines.
 */
export async function streamToStdin(
  stream: AsyncIterable<unknown>,
  stdin: NodeJS.WritableStream,
  abort?: AbortSignal,
): Promise<void> {
  for await (const message of stream) {
    if (abort?.aborted) break;
    stdin.write(JSON.stringify(message) + '\n');
  }
  stdin.end();
}
