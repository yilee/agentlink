/**
 * Auto-update: periodically checks npm for a newer version of @agent-link/agent.
 * When an update is found, waits for idle (no active Claude turn), installs the
 * new version via npm, and restarts the daemon. The session URL is preserved
 * through the existing agent.json sessionId restore mechanism.
 */

import { execSync, execFileSync } from 'child_process';
import { createRequire } from 'module';
import { loadConfig } from './config.js';
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
  // Restart via agentlink-client start --daemon (new binary from the updated package)
  // Preserve password and auto-update flag if configured
  const config = loadConfig();
  const restartArgs = ['start', '--daemon'];
  if (config.password) restartArgs.push('--password', config.password);
  if (config.autoUpdate) restartArgs.push('--auto-update');
  try {
    execFileSync('agentlink-client', restartArgs, {
      stdio: 'ignore',
      timeout: 15_000,
      windowsHide: true,
    });
  } catch {
    console.error('[AutoUpdate] Failed to restart daemon. Manual restart needed: agentlink-client start --daemon');
  }

  // Exit current process — new daemon is already running
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
