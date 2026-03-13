#!/usr/bin/env node
import { Command } from 'commander';
import {
  resolveConfig, loadConfig, saveConfig, getConfigPath,
  loadRuntimeState, clearRuntimeState, getLogDir, getLogDate, cleanOldLogs,
  killProcess, isProcessAlive,
} from './config.js';
import { serviceInstall, serviceUninstall } from './service.js';
import { spawn, execSync } from 'child_process';
import { openSync, existsSync, readFileSync, statSync, createReadStream, readdirSync } from 'fs';
import { watchFile, unwatchFile } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');
const qrcode = require('qrcode-terminal');

/** Highlight a URL with bold + underline ANSI codes if stdout supports color. */
function highlightUrl(url: string): string {
  if (!process.stdout.isTTY) return url;
  return `\x1b[1;4;36m${url}\x1b[0m`;
}

const program = new Command();

program
  .name('agentlink-client')
  .description('Local agent that proxies a working directory to a cloud web interface')
  .version(pkg.version);

program
  .command('start')
  .description('Start the local agent and connect to cloud relay')
  .option('-d, --dir <path>', 'Working directory')
  .option('-s, --server <url>', 'Relay server URL')
  .option('-n, --name <name>', 'Agent name')
  .option('-D, --daemon', 'Run agent in the background as a daemon')
  .option('-p, --password <password>', 'Session password (clients must authenticate)')
  .option('--auto-update', 'Enable automatic update checks (disabled by default)')
  .option('--ephemeral', 'Skip writing runtime state (for running alongside a daemon)')
  .action(async (options) => {
    // Only persist config values the user explicitly passed on the CLI.
    // Don't touch existing config.json values when flags are omitted —
    // otherwise upgrade/auto-update/service restarts would lose password.
    const configUpdates: Record<string, unknown> = {};
    if (options.password) {
      configUpdates.password = options.password;
    }
    if (options.autoUpdate) {
      configUpdates.autoUpdate = true;
    }
    if (Object.keys(configUpdates).length > 0) {
      saveConfig(configUpdates);
    }

    const config = resolveConfig(options);

    if (options.daemon) {
      // Check if agent is already running
      const existing = loadRuntimeState();
      if (existing) {
        let alive = false;
        try { process.kill(existing.pid, 0); alive = true; } catch {}
        if (alive) {
          console.log(`Agent is already running (PID ${existing.pid}).`);
          console.log(`  URL: ${highlightUrl(existing.sessionUrl)}`);
          console.log('Use "agentlink-client stop" to stop it first.');
          process.exit(1);
        }
        // Stale state — leave it so the new process can restore sessionId
      }

      // Spawn detached child process running daemon.js
      const __filename = fileURLToPath(import.meta.url);
      const daemonScript = resolve(dirname(__filename), 'daemon.js');
      const logDir = getLogDir();
      const dateTag = getLogDate();
      const logFile = join(logDir, `agent-${dateTag}.log`);
      const errFile = join(logDir, `agent-${dateTag}.err`);

      // Clean up log files older than 7 days
      cleanOldLogs(7);

      const out = openSync(logFile, 'a');
      const err = openSync(errFile, 'a');

      const child = spawn(process.execPath, [daemonScript, JSON.stringify(config)], {
        detached: true,
        stdio: ['ignore', out, err],
        cwd: config.dir,
        windowsHide: true,
      });

      child.unref();

      // Wait briefly for the daemon to write its runtime state
      const maxWait = 5000;
      const interval = 300;
      let waited = 0;
      let state = null;
      while (waited < maxWait) {
        await new Promise(r => setTimeout(r, interval));
        waited += interval;
        state = loadRuntimeState();
        if (state && state.pid !== process.pid) break;
      }

      if (state && state.pid !== process.pid) {
        console.log(`Agent started in background (PID ${state.pid}).`);
        console.log(`  URL: ${highlightUrl(state.sessionUrl)}`);
        qrcode.generate(state.sessionUrl, { small: true }, (code: string) => {
          console.log(code);
        });
        console.log(`  Log: ${logFile}`);
      } else {
        console.error('Agent may have failed to start. Check logs:');
        console.error(`  ${errFile}`);
        process.exit(1);
      }
      return;
    }

    // Foreground mode (default)
    if (options.ephemeral) process.env.AGENTLINK_NO_STATE = '1';
    const { start } = await import('./index.js');
    await start(config);
  });

program
  .command('stop')
  .description('Stop the running agent')
  .action(async () => {
    const state = loadRuntimeState();
    if (!state) {
      console.log('Agent is not running (no runtime state found).');
      return;
    }

    if (!isProcessAlive(state.pid)) {
      console.log('Agent is not running (process already exited).');
      clearRuntimeState();
      return;
    }

    console.log(`Stopping agent (PID ${state.pid})...`);
    if (!killProcess(state.pid)) {
      console.error('Failed to stop agent.');
      process.exit(1);
    }

    // Wait for the process to exit
    const maxWait = 5000;
    const interval = 200;
    let waited = 0;
    while (waited < maxWait) {
      await new Promise(r => setTimeout(r, interval));
      waited += interval;
      if (!isProcessAlive(state.pid)) {
        clearRuntimeState();
        console.log('Agent stopped.');
        return;
      }
    }

    clearRuntimeState();
    console.log('Agent stopped.');
  });

program
  .command('status')
  .description('Show current agent status')
  .action(async () => {
    // Agent status
    const agentState = loadRuntimeState();
    if (!agentState) {
      console.log('Agent:  not running');
    } else if (!isProcessAlive(agentState.pid)) {
      console.log('Agent:  not running (stale state)');
      clearRuntimeState();
    } else {
      const config = loadConfig();
      console.log('Agent:  running');
      console.log(`  Version:    ${pkg.version}`);
      console.log(`  PID:        ${agentState.pid}`);
      console.log(`  Name:       ${agentState.name}`);
      console.log(`  Directory:  ${agentState.dir}`);
      console.log(`  Server:     ${agentState.server}`);
      console.log(`  Session:    ${agentState.sessionId}`);
      console.log(`  URL:        ${highlightUrl(agentState.sessionUrl)}`);
      console.log(`  Started:    ${agentState.startedAt}`);
      const startTime = new Date(agentState.startedAt).getTime();
      if (!isNaN(startTime)) {
        const elapsed = Date.now() - startTime;
        const days = Math.floor(elapsed / 86400000);
        const hours = Math.floor((elapsed % 86400000) / 3600000);
        const mins = Math.floor((elapsed % 3600000) / 60000);
        const parts: string[] = [];
        if (days > 0) parts.push(`${days}d`);
        if (hours > 0) parts.push(`${hours}h`);
        parts.push(`${mins}m`);
        console.log(`  Uptime:     ${parts.join(' ')}`);
      }
      console.log(`  AutoUpdate: ${config.autoUpdate ? 'enabled' : 'disabled'}`);
      console.log(`  Password:   ${config.password ? '****' : '(not set)'}`);
      qrcode.generate(agentState.sessionUrl, { small: true }, (code: string) => {
        console.log(code);
      });
    }
  });

const configCmd = program
  .command('config')
  .description('View or update configuration');

configCmd
  .command('list')
  .description('Show all configuration')
  .action(() => {
    const config = loadConfig();
    const path = getConfigPath();
    console.log(`Config file: ${path}\n`);
    if (Object.keys(config).length === 0) {
      console.log('(no configuration set, using defaults)');
    } else {
      for (const [key, value] of Object.entries(config)) {
        console.log(`  ${key} = ${value}`);
      }
    }
  });

configCmd
  .command('set <key> <value>')
  .description('Set a configuration value (server, dir, name)')
  .action((key: string, value: string) => {
    const validKeys = ['server', 'dir', 'name', 'autoUpdate', 'password'];
    if (!validKeys.includes(key)) {
      console.error(`Invalid key "${key}". Valid keys: ${validKeys.join(', ')}`);
      process.exit(1);
    }
    saveConfig({ [key]: value });
    console.log(`Set ${key} = ${value}`);
  });

configCmd
  .command('get <key>')
  .description('Get a configuration value')
  .action((key: string) => {
    const config = loadConfig();
    const value = config[key as keyof typeof config];
    if (value !== undefined) {
      console.log(value);
    } else {
      console.log(`(not set)`);
    }
  });

// Default: show config list if no subcommand
configCmd.action(() => {
  configCmd.commands.find(c => c.name() === 'list')?.parse([], { from: 'user' });
});

// ── Service management ──

const serviceCmd = program
  .command('service')
  .description('Manage auto-start service');

serviceCmd
  .command('install')
  .description('Register agent as an auto-start service and start it now')
  .option('-d, --dir <path>', 'Working directory')
  .option('-s, --server <url>', 'Relay server URL')
  .option('-n, --name <name>', 'Agent name')
  .action((options) => {
    const config = resolveConfig(options);
    serviceInstall(config);
  });

serviceCmd
  .command('uninstall')
  .description('Remove auto-start service and stop the agent')
  .action(() => {
    serviceUninstall();
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
      const prefix = 'agent-';
      const suffix = `.${ext}`;
      try {
        const dated = readdirSync(logDir)
          .filter(f => f.startsWith(prefix) && f.endsWith(suffix))
          .sort()
          .reverse();
        if (dated.length > 0) return join(logDir, dated[0]);
      } catch {}
      // Fallback to legacy non-dated file
      return join(logDir, `agent.${ext}`);
    }

    const logFile = findLatestLog('log');
    const errFile = findLatestLog('err');

    function tailLines(filePath: string, n: number): string {
      if (!existsSync(filePath)) return '';
      const content = readFileSync(filePath, 'utf-8');
      const allLines = content.split('\n');
      // Remove trailing empty line from final newline
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
        console.log('No log files found. Is the agent running in daemon mode?');
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
          // File was truncated (log rotation)
          pos = 0;
        }
      });
    }

    if (!options.err) followFile(logFile, process.stdout);
    followFile(errFile, process.stderr);

    // Keep process alive, clean up on exit
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
      latestVersion = execSync('npm view @agent-link/agent version', { encoding: 'utf-8' }).trim();
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
    const wasRunning = loadRuntimeState();
    const daemonAlive = wasRunning && isProcessAlive(wasRunning.pid);

    // Install latest version FIRST (while old process is still running)
    console.log(`Installing @agent-link/agent@${latestVersion}...`);
    try {
      execSync(`npm install -g @agent-link/agent@${latestVersion}`, { stdio: 'inherit' });
    } catch {
      console.error('Failed to install. You may need to run with elevated permissions.');
      process.exit(1);
    }

    console.log(`Upgraded: v${currentVersion} → v${latestVersion}`);

    // Stop daemon if running, then restart with new binary
    if (daemonAlive) {
      console.log(`Stopping agent (PID ${wasRunning!.pid})...`);
      killProcess(wasRunning!.pid);
      for (let i = 0; i < 25; i++) {
        await new Promise(r => setTimeout(r, 200));
        if (!isProcessAlive(wasRunning!.pid)) break;
      }
      // Don't clear runtime state — new process reads sessionId from agent.json
      // to preserve the session URL across upgrades
      console.log('Agent stopped.');

      console.log('Restarting agent...');
      // Preserve password and auto-update from config so the new daemon keeps them
      const savedConfig = loadConfig();
      const restartArgs = ['start', '--daemon'];
      if (savedConfig.password) restartArgs.push('--password', savedConfig.password);
      if (savedConfig.autoUpdate) restartArgs.push('--auto-update');
      try {
        execSync(['agentlink-client', ...restartArgs].map(a => `"${a}"`).join(' '), { stdio: 'inherit' });
      } catch {
        console.error('Failed to restart agent. Start manually with: agentlink-client start --daemon');
      }
    }
  });

program.parse();
