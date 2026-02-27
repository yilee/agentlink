#!/usr/bin/env node
import { Command } from 'commander';
import { resolveConfig, loadConfig, saveConfig, getConfigPath, loadRuntimeState, clearRuntimeState } from './config.js';

const program = new Command();

program
  .name('agentlink')
  .description('Local agent that proxies a working directory to a cloud web interface')
  .version('0.1.0');

program
  .command('start')
  .description('Start the local agent and connect to cloud relay')
  .option('-d, --dir <path>', 'Working directory')
  .option('-s, --server <url>', 'Relay server URL')
  .option('-n, --name <name>', 'Agent name')
  .action(async (options) => {
    const config = resolveConfig(options);
    const { start } = await import('./index.js');
    await start(config);
  });

program
  .command('stop')
  .description('Stop the running agent')
  .action(async () => {
    console.log('[AgentLink] Stop command not yet implemented');
  });

program
  .command('status')
  .description('Show current agent status')
  .action(async () => {
    const state = loadRuntimeState();
    if (!state) {
      console.log('Agent is not running (no runtime state found).');
      return;
    }

    // Check if the process is still alive
    let alive = false;
    try {
      process.kill(state.pid, 0);
      alive = true;
    } catch {
      // Process not found — stale state file
    }

    if (!alive) {
      console.log('Agent is not running (process exited).');
      clearRuntimeState();
      return;
    }

    console.log('Agent is running.\n');
    console.log(`  PID:        ${state.pid}`);
    console.log(`  Name:       ${state.name}`);
    console.log(`  Directory:  ${state.dir}`);
    console.log(`  Server:     ${state.server}`);
    console.log(`  Session:    ${state.sessionId}`);
    console.log(`  URL:        ${state.sessionUrl}`);
    console.log(`  Started:    ${state.startedAt}`);
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
    const validKeys = ['server', 'dir', 'name'];
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

program.parse();
