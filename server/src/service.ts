import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import {
  getLogDir, loadServerRuntimeState, clearServerRuntimeState,
  killProcess, isProcessAlive,
} from './config.js';

const SERVICE_NAME = 'agentlink-server';
const LAUNCHD_LABEL = 'com.agentlink.server';

function getCliPath(): string {
  const __filename = fileURLToPath(import.meta.url);
  return resolve(dirname(__filename), 'cli.js');
}

function getNodePath(): string {
  return process.execPath;
}

// ── Linux (systemd) ──

function isRoot(): boolean {
  return process.getuid?.() === 0;
}

function getSystemdUnitPath(): string {
  if (isRoot()) {
    return join('/etc/systemd/system', `${SERVICE_NAME}.service`);
  }
  return join(homedir(), '.config', 'systemd', 'user', `${SERVICE_NAME}.service`);
}

function systemctl(...args: string[]): void {
  const cmd = isRoot()
    ? `systemctl ${args.join(' ')}`
    : `systemctl --user ${args.join(' ')}`;
  execSync(cmd);
}

function generateSystemdUnit(port: number): string {
  const nodePath = getNodePath();
  const cliPath = getCliPath();
  const logDir = getLogDir();
  const nodeBinDir = dirname(nodePath);

  const userSection = isRoot()
    ? ''
    : `Environment=PATH=${nodeBinDir}:${homedir()}/.local/bin:${homedir()}/.npm-global/bin:/usr/local/bin:/usr/bin:/bin\n`;

  return `[Unit]
Description=AgentLink Relay Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${nodePath} ${cliPath} start --port ${port}
Restart=on-failure
RestartSec=10
${userSection}StandardOutput=append:${logDir}/server.log
StandardError=append:${logDir}/server.err

[Install]
WantedBy=${isRoot() ? 'multi-user.target' : 'default.target'}
`;
}

function linuxInstall(port: number): void {
  const unitPath = getSystemdUnitPath();
  mkdirSync(dirname(unitPath), { recursive: true });
  mkdirSync(getLogDir(), { recursive: true });
  writeFileSync(unitPath, generateSystemdUnit(port));
  systemctl('daemon-reload');
  systemctl('enable', SERVICE_NAME);
  systemctl('start', SERVICE_NAME);
  const scope = isRoot() ? 'system' : 'user';
  const ctl = isRoot() ? 'systemctl' : 'systemctl --user';
  const jctl = isRoot() ? 'journalctl' : 'journalctl --user';
  console.log(`Service installed and started (${scope}-level).`);
  console.log(`\nUnit file: ${unitPath}`);
  console.log('\nUseful commands:');
  console.log(`  ${ctl} status ${SERVICE_NAME}`);
  console.log(`  ${jctl} -u ${SERVICE_NAME} -f`);
  if (!isRoot()) {
    console.log('\nTo run when not logged in:');
    console.log('  sudo loginctl enable-linger $(whoami)');
  }
}

function linuxUninstall(): void {
  try { systemctl('stop', `${SERVICE_NAME} 2>/dev/null`); } catch {}
  try { systemctl('disable', `${SERVICE_NAME} 2>/dev/null`); } catch {}
  const unitPath = getSystemdUnitPath();
  if (existsSync(unitPath)) {
    unlinkSync(unitPath);
  }
  try { systemctl('daemon-reload'); } catch {}
  console.log('Service uninstalled.');
}

// ── macOS (launchd plist) ──

function getLaunchdPlistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
}

function generateLaunchdPlist(port: number): string {
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
        <string>--port</string>
        <string>${port}</string>
    </array>
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
    <string>${logDir}/server.log</string>
    <key>StandardErrorPath</key>
    <string>${logDir}/server.err</string>
</dict>
</plist>
`;
}

function macInstall(port: number): void {
  const plistPath = getLaunchdPlistPath();
  mkdirSync(dirname(plistPath), { recursive: true });
  mkdirSync(getLogDir(), { recursive: true });
  if (existsSync(plistPath)) {
    try { execSync(`launchctl unload "${plistPath}" 2>/dev/null`); } catch {}
  }
  writeFileSync(plistPath, generateLaunchdPlist(port));
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

function generateStartupBat(port: number): string {
  const nodePath = getNodePath();
  const cliPath = getCliPath();
  return `@echo off\r\n"${nodePath}" "${cliPath}" start --daemon --port ${port}\r\n`;
}

function winInstall(port: number): void {
  mkdirSync(getLogDir(), { recursive: true });
  const batPath = getStartupBatPath();
  writeFileSync(batPath, generateStartupBat(port));
  console.log('Startup script installed.');
  console.log(`\nStartup file: ${batPath}`);

  // Start the server now
  console.log('\nStarting server now...');
  try {
    execSync(
      `"${getNodePath()}" "${getCliPath()}" start --daemon --port ${port}`,
      { stdio: 'inherit' },
    );
  } catch {
    console.error('Failed to start server. Check logs in ~/.agentlink/logs/');
  }
}

function winUninstall(): void {
  const batPath = getStartupBatPath();
  if (existsSync(batPath)) {
    unlinkSync(batPath);
    console.log(`Removed startup file: ${batPath}`);
  }
  // Stop running server if any
  const state = loadServerRuntimeState();
  if (state && isProcessAlive(state.pid)) {
    console.log(`Stopping server (PID ${state.pid})...`);
    killProcess(state.pid);
    clearServerRuntimeState();
  }
  console.log('Service uninstalled.');
}

// ── Platform dispatch ──

export function serverServiceInstall(port: number): void {
  const p = process.platform;
  console.log('Installing AgentLink server service...');
  console.log(`  Port: ${port}`);
  console.log('');

  if (p === 'linux') linuxInstall(port);
  else if (p === 'darwin') macInstall(port);
  else if (p === 'win32') winInstall(port);
  else {
    console.error(`Unsupported platform: ${p}`);
    console.error('Run the server directly: agentlink-server start --daemon');
    process.exit(1);
  }
}

export function serverServiceUninstall(): void {
  const p = process.platform;
  console.log('Uninstalling AgentLink server service...');

  if (p === 'linux') linuxUninstall();
  else if (p === 'darwin') macUninstall();
  else if (p === 'win32') winUninstall();
  else {
    console.error(`Unsupported platform: ${p}`);
    process.exit(1);
  }
}
