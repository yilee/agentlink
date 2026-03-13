/**
 * Auto-update: periodically checks npm for a newer version of @agent-link/agent.
 * When an update is found, waits for idle (no active Claude turn), installs the
 * new version via npm, and restarts the daemon. The session URL is preserved
 * through the existing agent.json sessionId restore mechanism.
 */

import { execSync, spawn } from 'child_process';
import { createRequire } from 'module';
import { join } from 'path';
import { openSync } from 'fs';
import { loadConfig, getLogDir, getLogDate, cleanOldLogs } from './config.js';
import { getConversation } from './claude.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const CHECK_DELAY = 30_000;        // first check 30s after startup
const CHECK_INTERVAL = 4 * 3600_000; // then every 4 hours
const IDLE_POLL_INTERVAL = 5_000;  // poll turn status every 5s
const IDLE_TIMEOUT = 10 * 60_000;  // give up waiting after 10 min

let timer: ReturnType<typeof setInterval> | null = null;

function getLatestVersion(): string | null {
  try {
    return execSync('npm view @agent-link/agent version', {
      encoding: 'utf-8',
      timeout: 30_000,
      windowsHide: true,
    }).trim();
  } catch {
    return null;
  }
}

function isTurnActive(): boolean {
  const conv = getConversation();
  return conv?.turnActive === true;
}

async function waitForIdle(): Promise<boolean> {
  if (!isTurnActive()) return true;
  console.log('[AutoUpdate] Waiting for current turn to finish...');
  const deadline = Date.now() + IDLE_TIMEOUT;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, IDLE_POLL_INTERVAL));
    if (!isTurnActive()) return true;
  }
  return false;
}

async function checkAndUpdate(daemon: boolean): Promise<void> {
  const currentVersion = pkg.version as string;
  const latestVersion = getLatestVersion();
  if (!latestVersion || latestVersion === currentVersion) return;

  console.log(`[AutoUpdate] New version available: ${currentVersion} → ${latestVersion}`);

  if (!daemon) {
    // Foreground mode: just notify, don't auto-update
    console.log('[AutoUpdate] Run "agentlink-client upgrade" to update.');
    return;
  }

  // Wait for idle
  const idle = await waitForIdle();
  if (!idle) {
    console.log('[AutoUpdate] Turn still active after timeout, skipping this update cycle.');
    return;
  }

  // Install new version
  console.log(`[AutoUpdate] Installing @agent-link/agent@${latestVersion}...`);
  try {
    execSync(`npm install -g @agent-link/agent@${latestVersion}`, {
      stdio: 'ignore',
      timeout: 120_000,
      windowsHide: true,
    });
  } catch (err) {
    console.error(`[AutoUpdate] Install failed: ${(err as Error).message}`);
    return;
  }

  console.log(`[AutoUpdate] Updated to v${latestVersion}. Restarting daemon...`);

  // Don't clear agent.json — the new process will restore sessionId from it.
  // We can't use `agentlink-client start --daemon` synchronously because
  // this process is still alive and the start command rejects "already running".
  // Instead, spawn the new daemon.js directly (detached), then exit.
  const config = loadConfig();

  // Resolve the new daemon.js from the freshly-installed package
  let newDaemonScript: string;
  try {
    const npmPrefix = execSync('npm prefix -g', { encoding: 'utf-8', windowsHide: true }).trim();
    const pkgDir = join(npmPrefix, process.platform === 'win32' ? '' : 'lib', 'node_modules', '@agent-link', 'agent', 'dist');
    newDaemonScript = join(pkgDir, 'daemon.js');
  } catch (err) {
    console.error(`[AutoUpdate] Failed to locate new daemon script: ${(err as Error).message}`);
    console.error('[AutoUpdate] Keeping current process alive. Will retry next cycle.');
    return;
  }

  // Build config for the new daemon — preserve password, autoUpdate, and current settings
  const newConfig = { ...config };
  if (!newConfig.autoUpdate) newConfig.autoUpdate = true; // we're in auto-update, keep it on

  const logDir = getLogDir();
  const dateTag = getLogDate();
  cleanOldLogs(7);
  const out = openSync(join(logDir, `agent-${dateTag}.log`), 'a');
  const err = openSync(join(logDir, `agent-${dateTag}.err`), 'a');

  console.log('[AutoUpdate] Spawning new daemon and exiting...');
  const child = spawn(process.execPath, [newDaemonScript, JSON.stringify(newConfig)], {
    detached: true,
    stdio: ['ignore', out, err],
    cwd: config.dir,
    windowsHide: true,
  });
  child.unref();

  // Exit old process — new daemon is starting
  process.exit(0);
}

/**
 * Start the auto-update check loop.
 * @param daemon - true if running in daemon mode (will auto-install + restart);
 *                 false for foreground mode (prints notification only).
 */
export function startAutoUpdate(daemon: boolean): void {
  // First check after a delay so startup isn't slowed
  setTimeout(() => {
    checkAndUpdate(daemon).catch(() => {});

    // Subsequent checks on interval
    timer = setInterval(() => {
      checkAndUpdate(daemon).catch(() => {});
    }, CHECK_INTERVAL);

    // Don't keep process alive just for the timer
    if (timer && typeof timer === 'object' && 'unref' in timer) {
      timer.unref();
    }
  }, CHECK_DELAY);
}

export function stopAutoUpdate(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
