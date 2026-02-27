import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
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

const CONFIG_DIR = join(homedir(), '.agentlink');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

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
