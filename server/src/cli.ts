#!/usr/bin/env node
import { Command } from 'commander';
import { spawn, execSync } from 'child_process';
import { openSync, existsSync, readFileSync, statSync, createReadStream, readdirSync } from 'fs';
import { watchFile, unwatchFile } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import {
  loadServerRuntimeState, clearServerRuntimeState, getLogDir, getLogDate, cleanOldLogs,
  killProcess, isProcessAlive, writePidFile,
} from './config.js';
import { serverServiceInstall, serverServiceUninstall } from './service.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const program = new Command();

program
  .name('agentlink-server')
  .description('AgentLink relay server')
  .version(pkg.version);

program
  .command('start')
  .description('Start the relay server')
  .option('-p, --port <port>', 'Server port', '3456')
  .option('-D, --daemon', 'Run server in the background as a daemon')
  .option('--ephemeral', 'Skip writing runtime state (for running alongside a daemon)')
  .option('--pid-file <path>', 'Write PID and port to a file (for test harness)')
  .action(async (options) => {
    const isEphemeral = !!options.ephemeral;

    // Check if server is already running (skip for ephemeral — no shared state)
    if (!isEphemeral) {
      const existing = loadServerRuntimeState();
      if (existing && isProcessAlive(existing.pid)) {
        console.log(`Server is already running (PID ${existing.pid}, port ${existing.port}).`);
        console.log('Use "agentlink-server stop" to stop it first.');
        process.exit(1);
      }
      if (existing) clearServerRuntimeState();
    }

    if (!options.daemon) {
      // Foreground mode: run server directly
      if (isEphemeral) process.env.AGENTLINK_NO_STATE = '1';
      process.env.PORT = options.port;
      if (options.pidFile) process.env.AGENTLINK_PID_FILE = resolve(options.pidFile);
      await import('./index.js');
      return;
    }

    // Daemon mode: spawn detached child
    const __filename = fileURLToPath(import.meta.url);
    const serverScript = resolve(dirname(__filename), 'index.js');
    const logDir = getLogDir();
    const dateTag = getLogDate();
    const logFile = join(logDir, `server-${dateTag}.log`);
    const errFile = join(logDir, `server-${dateTag}.err`);

    // Clean up log files older than 7 days
    cleanOldLogs(7);

    const out = openSync(logFile, 'a');
    const err = openSync(errFile, 'a');

    const spawnEnv: Record<string, string | undefined> = {
      ...process.env,
      PORT: options.port,
    };
    if (isEphemeral) spawnEnv.AGENTLINK_NO_STATE = '1';
    if (options.pidFile) spawnEnv.AGENTLINK_PID_FILE = resolve(options.pidFile);

    const child = spawn(process.execPath, [serverScript], {
      detached: true,
      stdio: ['ignore', out, err],
      env: spawnEnv,
      windowsHide: true,
    });

    child.unref();

    if (isEphemeral) {
      // Ephemeral daemon: poll log file for "Server listening" line
      const maxWait = 10000;
      const interval = 300;
      let waited = 0;
      let port: number | null = null;

      while (waited < maxWait) {
        await new Promise(r => setTimeout(r, interval));
        waited += interval;
        try {
          const logContent = readFileSync(logFile, 'utf-8');
          const match = logContent.match(/Server listening on http:\/\/localhost:(\d+)/);
          if (match) {
            port = parseInt(match[1], 10);
            break;
          }
        } catch {}
      }

      if (port) {
        console.log(`Server started (PID ${child.pid}, port ${port}).`);
        console.log(`  URL: http://localhost:${port}`);
        console.log(`  Log: ${logFile}`);
        if (options.pidFile) {
          writePidFile(resolve(options.pidFile), { pid: child.pid!, port });
        }
      } else {
        console.error('Server may have failed to start. Check logs:');
        console.error(`  ${errFile}`);
        if (options.pidFile) {
          writePidFile(resolve(options.pidFile), { pid: child.pid! });
        }
        process.exit(1);
      }
    } else {
      // Non-ephemeral daemon: poll runtime state file (original logic)
      const maxWait = 5000;
      const interval = 300;
      let waited = 0;
      let state = null;
      while (waited < maxWait) {
        await new Promise(r => setTimeout(r, interval));
        waited += interval;
        state = loadServerRuntimeState();
        if (state && state.pid !== process.pid) break;
      }

      if (state && state.pid !== process.pid) {
        console.log(`Server started (PID ${state.pid}, port ${state.port}).`);
        console.log(`  URL: http://localhost:${state.port}`);
        console.log(`  Log: ${logFile}`);
        if (options.pidFile) {
          writePidFile(resolve(options.pidFile), { pid: state.pid, port: state.port });
        }
      } else {
        console.error('Server may have failed to start. Check logs:');
        console.error(`  ${errFile}`);
        process.exit(1);
      }
    }
  });

program
  .command('stop')
  .description('Stop the running relay server')
  .action(async () => {
    const state = loadServerRuntimeState();
    if (!state) {
      console.log('Server is not running (no runtime state found).');
      return;
    }

    if (!isProcessAlive(state.pid)) {
      console.log('Server is not running (process already exited).');
      clearServerRuntimeState();
      return;
    }

    console.log(`Stopping server (PID ${state.pid})...`);
    if (!killProcess(state.pid)) {
      console.error('Failed to stop server.');
      process.exit(1);
    }

    // Wait for exit
    const maxWait = 5000;
    const interval = 200;
    let waited = 0;
    while (waited < maxWait) {
      await new Promise(r => setTimeout(r, interval));
      waited += interval;
      if (!isProcessAlive(state.pid)) {
        clearServerRuntimeState();
        console.log('Server stopped.');
        return;
      }
    }

    clearServerRuntimeState();
    console.log('Server stopped.');
  });

program
  .command('status')
  .description('Show server status')
  .action(() => {
    const state = loadServerRuntimeState();
    if (!state) {
      console.log('Server: not running');
    } else if (!isProcessAlive(state.pid)) {
      console.log('Server: not running (stale state)');
      clearServerRuntimeState();
    } else {
      console.log('Server: running');
      console.log(`  PID:     ${state.pid}`);
      console.log(`  Port:    ${state.port}`);
      console.log(`  Started: ${state.startedAt}`);
    }
  });

// ── Service management ──

const serviceCmd = program
  .command('service')
  .description('Manage auto-start service');

serviceCmd
  .command('install')
  .description('Register server as an auto-start service and start it now')
  .option('-p, --port <port>', 'Server port', '3456')
  .action((options) => {
    serverServiceInstall(parseInt(options.port, 10));
  });

serviceCmd
  .command('uninstall')
  .description('Remove auto-start service and stop the server')
  .action(() => {
    serverServiceUninstall();
  });

serviceCmd.action(() => {
  serviceCmd.help();
});

// ── Log ──

program
  .command('log')
  .description('Show daemon log output')
  .option('-f, --follow', 'Follow log output in real-time (like tail -f)')
  .option('-n, --lines <count>', 'Number of lines to show', '100')
  .option('--err', 'Show only stderr log')
  .action((options) => {
    const logDir = getLogDir();
    const lines = parseInt(options.lines, 10) || 100;

    // Find the most recent dated log file, falling back to legacy name
    function findLatestLog(ext: string): string {
      const prefix = 'server-';
      const suffix = `.${ext}`;
      try {
        const dated = readdirSync(logDir)
          .filter(f => f.startsWith(prefix) && f.endsWith(suffix))
          .sort()
          .reverse();
        if (dated.length > 0) return join(logDir, dated[0]);
      } catch {}
      // Fallback to legacy non-dated file
      return join(logDir, `server.${ext}`);
    }

    const logFile = findLatestLog('log');
    const errFile = findLatestLog('err');

    function tailLines(filePath: string, n: number): string {
      if (!existsSync(filePath)) return '';
      const content = readFileSync(filePath, 'utf-8');
      const allLines = content.split('\n');
      if (allLines.length > 0 && allLines[allLines.length - 1] === '') allLines.pop();
      return allLines.slice(-n).join('\n');
    }

    if (!options.err) {
      const out = tailLines(logFile, lines);
      if (out) process.stdout.write(out + '\n');
    }

    const errOut = tailLines(errFile, lines);
    if (errOut) {
      if (!options.err) process.stderr.write('\n--- stderr ---\n');
      process.stderr.write(errOut + '\n');
    }

    if (!options.follow) {
      if (!options.err && !existsSync(logFile) && !existsSync(errFile)) {
        console.log('No log files found. Is the server running in daemon mode?');
      }
      return;
    }

    // Follow mode: watch files for changes and print new content
    const watchers: string[] = [];
    function followFile(filePath: string, output: NodeJS.WritableStream): void {
      if (!existsSync(filePath)) return;
      let pos = statSync(filePath).size;
      watchers.push(filePath);
      watchFile(filePath, { interval: 300 }, (curr) => {
        if (curr.size > pos) {
          const stream = createReadStream(filePath, { start: pos, end: curr.size - 1, encoding: 'utf-8' });
          stream.pipe(output, { end: false });
          pos = curr.size;
        } else if (curr.size < pos) {
          pos = 0;
        }
      });
    }

    if (!options.err) followFile(logFile, process.stdout);
    followFile(errFile, process.stderr);

    process.on('SIGINT', () => {
      for (const f of watchers) unwatchFile(f);
      process.exit(0);
    });
  });

// ── Upgrade ──

program
  .command('upgrade')
  .description('Upgrade to the latest version from npm')
  .action(async () => {
    const currentVersion = pkg.version;
    console.log(`Current version: ${currentVersion}`);

    // Check latest version on npm
    let latestVersion: string;
    try {
      latestVersion = execSync('npm view @agent-link/server version', { encoding: 'utf-8' }).trim();
    } catch {
      console.error('Failed to check latest version. Make sure npm is available.');
      process.exit(1);
    }

    if (latestVersion === currentVersion) {
      console.log(`Already up to date (v${currentVersion}).`);
      return;
    }

    console.log(`New version available: ${latestVersion}`);

    // Check if daemon is running before upgrade
    const wasRunning = loadServerRuntimeState();
    const daemonAlive = wasRunning && isProcessAlive(wasRunning.pid);
    const port = wasRunning?.port;

    // Install latest version FIRST (while old process is still running)
    console.log(`Installing @agent-link/server@${latestVersion}...`);
    try {
      execSync('npm install -g @agent-link/server@latest', { stdio: 'inherit' });
    } catch {
      console.error('Failed to install. You may need to run with elevated permissions.');
      process.exit(1);
    }

    console.log(`Upgraded: v${currentVersion} → v${latestVersion}`);

    // Stop daemon if running, then restart with new binary
    if (daemonAlive) {
      console.log(`Stopping server (PID ${wasRunning!.pid})...`);
      killProcess(wasRunning!.pid);
      for (let i = 0; i < 25; i++) {
        await new Promise(r => setTimeout(r, 200));
        if (!isProcessAlive(wasRunning!.pid)) break;
      }
      clearServerRuntimeState();
      console.log('Server stopped.');

      console.log('Restarting server...');
      const portArg = port ? ` --port ${port}` : '';
      try {
        const npmPrefix = execSync('npm prefix -g', { encoding: 'utf-8' }).trim();
        const newBin = process.platform === 'win32'
          ? join(npmPrefix, 'agentlink-server.cmd')
          : join(npmPrefix, 'bin', 'agentlink-server');
        execSync(`"${newBin}" start --daemon${portArg}`, { stdio: 'inherit' });
      } catch {
        try {
          execSync(`agentlink-server start --daemon${portArg}`, { stdio: 'inherit' });
        } catch {
          console.error('Failed to restart server. Start manually with: agentlink-server start --daemon');
        }
      }
    }
  });

program.parse();
