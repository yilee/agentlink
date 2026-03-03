#!/usr/bin/env node
import { Command } from 'commander';
import {
  resolveConfig, loadConfig, saveConfig, getConfigPath,
  loadRuntimeState, clearRuntimeState, getLogDir,
  killProcess, isProcessAlive,
} from './config.js';
import { serviceInstall, serviceUninstall } from './service.js';
import { spawn, execSync } from 'child_process';
import { openSync } from 'fs';
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
  .action(async (options) => {
    // Persist password and autoUpdate to config file so restarts preserve them
    const configUpdates: Record<string, unknown> = {};
    if (options.password) {
      configUpdates.password = options.password;
    } else {
      configUpdates.password = undefined;
    }
    if (options.autoUpdate) {
      configUpdates.autoUpdate = true;
    }
    saveConfig(configUpdates);

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
      const logFile = join(logDir, 'agent.log');
      const errFile = join(logDir, 'agent.err');

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
      console.log('Agent:  running');
      console.log(`  PID:        ${agentState.pid}`);
      console.log(`  Name:       ${agentState.name}`);
      console.log(`  Directory:  ${agentState.dir}`);
      console.log(`  Server:     ${agentState.server}`);
      console.log(`  Session:    ${agentState.sessionId}`);
      console.log(`  URL:        ${highlightUrl(agentState.sessionUrl)}`);
      console.log(`  Started:    ${agentState.startedAt}`);
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
      try {
        const npmPrefix = execSync('npm prefix -g', { encoding: 'utf-8' }).trim();
        const newBin = process.platform === 'win32'
          ? join(npmPrefix, 'agentlink-client.cmd')
          : join(npmPrefix, 'bin', 'agentlink-client');
        execSync(`"${newBin}" start --daemon`, { stdio: 'inherit' });
      } catch {
        try {
          execSync('agentlink-client start --daemon', { stdio: 'inherit' });
        } catch {
          console.error('Failed to restart agent. Start manually with: agentlink-client start --daemon');
        }
      }
    }
  });

program.parse();
