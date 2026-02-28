import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import type { AgentConfig } from './config.js';
import {
  getLogDir, loadRuntimeState, clearRuntimeState,
  killProcess, isProcessAlive,
} from './config.js';

const SERVICE_NAME = 'agentlink';
const LAUNCHD_LABEL = 'com.agentlink.agent';

function getCliPath(): string {
  const __filename = fileURLToPath(import.meta.url);
  return resolve(dirname(__filename), 'cli.js');
}

function getNodePath(): string {
  return process.execPath;
}

// ── Linux (systemd user unit) ──

function getSystemdUnitPath(): string {
  return join(homedir(), '.config', 'systemd', 'user', `${SERVICE_NAME}.service`);
}

function generateSystemdUnit(config: AgentConfig): string {
  const nodePath = getNodePath();
  const cliPath = getCliPath();
  const logDir = getLogDir();
  const nodeBinDir = dirname(nodePath);

  return `[Unit]
Description=AgentLink Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${nodePath} ${cliPath} start --server ${config.server} --dir ${config.dir} --name ${config.name}
WorkingDirectory=${config.dir}
Restart=on-failure
RestartSec=10
Environment=PATH=${nodeBinDir}:${homedir()}/.local/bin:${homedir()}/.npm-global/bin:/usr/local/bin:/usr/bin:/bin
StandardOutput=append:${logDir}/agent.log
StandardError=append:${logDir}/agent.err

[Install]
WantedBy=default.target
`;
}

function linuxInstall(config: AgentConfig): void {
  const unitPath = getSystemdUnitPath();
  mkdirSync(dirname(unitPath), { recursive: true });
  mkdirSync(getLogDir(), { recursive: true });
  writeFileSync(unitPath, generateSystemdUnit(config));
  execSync('systemctl --user daemon-reload');
  execSync(`systemctl --user enable ${SERVICE_NAME}`);
  execSync(`systemctl --user start ${SERVICE_NAME}`);
  console.log('Service installed and started.');
  console.log(`\nUnit file: ${unitPath}`);
  console.log('\nUseful commands:');
  console.log(`  systemctl --user status ${SERVICE_NAME}`);
  console.log(`  journalctl --user -u ${SERVICE_NAME} -f`);
  console.log('\nTo run when not logged in:');
  console.log('  sudo loginctl enable-linger $(whoami)');
}

function linuxUninstall(): void {
  try { execSync(`systemctl --user stop ${SERVICE_NAME} 2>/dev/null`); } catch {}
  try { execSync(`systemctl --user disable ${SERVICE_NAME} 2>/dev/null`); } catch {}
  const unitPath = getSystemdUnitPath();
  if (existsSync(unitPath)) {
    unlinkSync(unitPath);
  }
  try { execSync('systemctl --user daemon-reload'); } catch {}
  console.log('Service uninstalled.');
}

// ── macOS (launchd plist) ──

function getLaunchdPlistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
}

function generateLaunchdPlist(config: AgentConfig): string {
  const nodePath = getNodePath();
  const cliPath = getCliPath();
  const logDir = getLogDir();

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LAUNCHD_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${cliPath}</string>
        <string>start</string>
        <string>--server</string>
        <string>${config.server}</string>
        <string>--dir</string>
        <string>${config.dir}</string>
        <string>--name</string>
        <string>${config.name}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${config.dir}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>StandardOutPath</key>
    <string>${logDir}/agent.log</string>
    <key>StandardErrorPath</key>
    <string>${logDir}/agent.err</string>
</dict>
</plist>
`;
}

function macInstall(config: AgentConfig): void {
  const plistPath = getLaunchdPlistPath();
  mkdirSync(dirname(plistPath), { recursive: true });
  mkdirSync(getLogDir(), { recursive: true });
  if (existsSync(plistPath)) {
    try { execSync(`launchctl unload "${plistPath}" 2>/dev/null`); } catch {}
  }
  writeFileSync(plistPath, generateLaunchdPlist(config));
  execSync(`launchctl load "${plistPath}"`);
  console.log('Service installed and started.');
  console.log(`\nPlist file: ${plistPath}`);
  console.log('\nUseful commands:');
  console.log(`  launchctl list | grep ${LAUNCHD_LABEL}`);
}

function macUninstall(): void {
  const plistPath = getLaunchdPlistPath();
  if (existsSync(plistPath)) {
    try { execSync(`launchctl unload "${plistPath}"`); } catch {}
    unlinkSync(plistPath);
  }
  console.log('Service uninstalled.');
}

// ── Windows (Startup folder .bat) ──

function getStartupBatPath(): string {
  const startupDir = join(
    process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'),
    'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup',
  );
  return join(startupDir, `${SERVICE_NAME}.bat`);
}

function generateStartupBat(config: AgentConfig): string {
  const nodePath = getNodePath();
  const cliPath = getCliPath();
  return `@echo off\r\n"${nodePath}" "${cliPath}" start --daemon --server ${config.server} --dir "${config.dir}" --name ${config.name}\r\n`;
}

function winInstall(config: AgentConfig): void {
  mkdirSync(getLogDir(), { recursive: true });
  const batPath = getStartupBatPath();
  writeFileSync(batPath, generateStartupBat(config));
  console.log('Startup script installed.');
  console.log(`\nStartup file: ${batPath}`);

  // Start the agent now
  console.log('\nStarting agent now...');
  try {
    execSync(
      `"${getNodePath()}" "${getCliPath()}" start --daemon --server ${config.server} --dir "${config.dir}" --name ${config.name}`,
      { stdio: 'inherit' },
    );
  } catch {
    console.error('Failed to start agent. Check logs in ~/.agentlink/logs/');
  }
}

function winUninstall(): void {
  const batPath = getStartupBatPath();
  if (existsSync(batPath)) {
    unlinkSync(batPath);
    console.log(`Removed startup file: ${batPath}`);
  }
  // Stop running agent if any
  const state = loadRuntimeState();
  if (state && isProcessAlive(state.pid)) {
    console.log(`Stopping agent (PID ${state.pid})...`);
    killProcess(state.pid);
    clearRuntimeState();
  }
  console.log('Service uninstalled.');
}

// ── Platform dispatch ──

export function serviceInstall(config: AgentConfig): void {
  const p = process.platform;
  console.log('Installing AgentLink service...');
  console.log(`  Server:    ${config.server}`);
  console.log(`  Directory: ${config.dir}`);
  console.log(`  Name:      ${config.name}`);
  console.log('');

  if (p === 'linux') linuxInstall(config);
  else if (p === 'darwin') macInstall(config);
  else if (p === 'win32') winInstall(config);
  else {
    console.error(`Unsupported platform: ${p}`);
    console.error('Run the agent directly: agentlink-client start --daemon');
    process.exit(1);
  }
}

export function serviceUninstall(): void {
  const p = process.platform;
  console.log('Uninstalling AgentLink service...');

  if (p === 'linux') linuxUninstall();
  else if (p === 'darwin') macUninstall();
  else if (p === 'win32') winUninstall();
  else {
    console.error(`Unsupported platform: ${p}`);
    process.exit(1);
  }
}
