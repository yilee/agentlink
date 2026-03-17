import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock os.homedir() before importing config module
const tempHome = join(tmpdir(), `agentlink-test-config-${process.pid}`);

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => tempHome };
});

const {
  loadConfig,
  saveConfig,
  resolveConfig,
  saveRuntimeState,
  loadRuntimeState,
  clearRuntimeState,
  isProcessAlive,
  getLogDir,
  getLogDate,
  cleanOldLogs,
  writePidFile,
  readPidFile,
  CONFIG_DIR,
} = await import('../../agent/src/config.js');

beforeEach(() => {
  mkdirSync(join(tempHome, '.agentlink'), { recursive: true });
});

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true });
});

describe('Agent Config', () => {
  describe('loadConfig / saveConfig', () => {
    it('returns empty object when no config file', () => {
      expect(loadConfig()).toEqual({});
    });

    it('round-trips config values', () => {
      saveConfig({ server: 'ws://test:3456', name: 'TestAgent' });
      const config = loadConfig();
      expect(config.server).toBe('ws://test:3456');
      expect(config.name).toBe('TestAgent');
    });

    it('merges with existing config', () => {
      saveConfig({ server: 'ws://first' });
      saveConfig({ name: 'Agent2' });
      const config = loadConfig();
      expect(config.server).toBe('ws://first');
      expect(config.name).toBe('Agent2');
    });

    it('does not clear password when saving unrelated fields', () => {
      saveConfig({ password: 'secret123', server: 'ws://test' });
      saveConfig({ name: 'NewAgent' });
      const config = loadConfig();
      expect(config.password).toBe('secret123');
      expect(config.name).toBe('NewAgent');
    });

    it('does not clear password when saving empty object', () => {
      saveConfig({ password: 'keep-me', autoUpdate: true });
      saveConfig({});
      const config = loadConfig();
      expect(config.password).toBe('keep-me');
      expect(config.autoUpdate).toBe(true);
    });

    it('clears password only when explicitly set to undefined', () => {
      saveConfig({ password: 'old-pass' });
      saveConfig({ password: undefined });
      const config = loadConfig();
      expect(config.password).toBeUndefined();
    });

    it('does not clear autoUpdate when saving unrelated fields', () => {
      saveConfig({ autoUpdate: true, password: 'pass' });
      saveConfig({ server: 'ws://new' });
      const config = loadConfig();
      expect(config.autoUpdate).toBe(true);
      expect(config.password).toBe('pass');
    });
  });

  describe('resolveConfig', () => {
    it('CLI flags take priority over file', () => {
      saveConfig({ server: 'ws://file', name: 'FileAgent' });
      const config = resolveConfig({ server: 'ws://cli' });
      expect(config.server).toBe('ws://cli');
      expect(config.name).toBe('FileAgent');
    });

    it('falls back to defaults', () => {
      const config = resolveConfig({});
      expect(config.server).toBe('wss://msclaude.ai');
      expect(config.dir).toBe(process.cwd());
      expect(config.name).toMatch(/^Agent-/);
      expect(config.autoUpdate).toBe(false);
    });

    it('autoUpdate defaults to false', () => {
      const config = resolveConfig({});
      expect(config.autoUpdate).toBe(false);
    });

    it('autoUpdate can be disabled via CLI flag', () => {
      saveConfig({ autoUpdate: true });
      const config = resolveConfig({ autoUpdate: false });
      expect(config.autoUpdate).toBe(false);
    });

    it('autoUpdate can be set via config file', () => {
      saveConfig({ autoUpdate: false });
      const config = resolveConfig({});
      expect(config.autoUpdate).toBe(false);
    });

    it('CLI autoUpdate flag takes priority over config file', () => {
      saveConfig({ autoUpdate: false });
      const config = resolveConfig({ autoUpdate: true });
      expect(config.autoUpdate).toBe(true);
    });

    it('reads password from config file when not passed via CLI', () => {
      saveConfig({ password: 'saved-pass' });
      const config = resolveConfig({});
      expect(config.password).toBe('saved-pass');
    });

    it('CLI password takes priority over config file', () => {
      saveConfig({ password: 'file-pass' });
      const config = resolveConfig({ password: 'cli-pass' });
      expect(config.password).toBe('cli-pass');
    });

    it('password is undefined when not set anywhere', () => {
      const config = resolveConfig({});
      expect(config.password).toBeUndefined();
    });

    it('reads entra from config file when not passed via CLI', () => {
      saveConfig({ entra: true });
      const config = resolveConfig({});
      expect(config.entra).toBe(true);
    });

    it('CLI entra flag takes priority over config file', () => {
      saveConfig({ entra: false });
      const config = resolveConfig({ entra: true });
      expect(config.entra).toBe(true);
    });

    it('entra is undefined when not set anywhere', () => {
      const config = resolveConfig({});
      expect(config.entra).toBeUndefined();
    });

    it('entra survives config round-trip (persists across restarts)', () => {
      saveConfig({ entra: true, password: 'pass' });
      const config = resolveConfig({});
      expect(config.entra).toBe(true);
      expect(config.password).toBe('pass');
    });

    it('entra not inherited from config file when ignoreConfigFile is true', () => {
      saveConfig({ entra: true });
      const config = resolveConfig({}, true);
      expect(config.entra).toBeUndefined();
    });
  });

  describe('RuntimeState', () => {
    it('round-trips runtime state', () => {
      const state = {
        pid: 12345,
        sessionId: 'abc123',
        sessionUrl: 'http://localhost:3456/s/abc123',
        server: 'ws://localhost:3456',
        name: 'TestAgent',
        dir: '/test',
        startedAt: '2026-01-01T00:00:00Z',
      };
      saveRuntimeState(state);
      expect(loadRuntimeState()).toEqual(state);
    });

    it('returns null when no state file', () => {
      expect(loadRuntimeState()).toBeNull();
    });

    it('clearRuntimeState removes the file', () => {
      saveRuntimeState({
        pid: 1, sessionId: 'x', sessionUrl: 'x', server: 'x', name: 'x', dir: 'x', startedAt: 'x',
      });
      clearRuntimeState();
      expect(loadRuntimeState()).toBeNull();
    });
  });

  describe('isProcessAlive', () => {
    it('returns true for current process', () => {
      expect(isProcessAlive(process.pid)).toBe(true);
    });

    it('returns false for non-existent PID', () => {
      expect(isProcessAlive(999999)).toBe(false);
    });
  });

  describe('Log rotation', () => {
    it('getLogDate returns YYYY-MM-DD format', () => {
      const date = getLogDate();
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('cleanOldLogs deletes files older than N days', () => {
      const logDir = getLogDir();
      // Create old log files (30 days ago)
      const old = new Date(Date.now() - 30 * 86400_000);
      const oldDate = old.toISOString().slice(0, 10);
      writeFileSync(join(logDir, `agent-${oldDate}.log`), 'old log');
      writeFileSync(join(logDir, `agent-${oldDate}.err`), 'old err');

      // Create today's log files
      const today = getLogDate();
      writeFileSync(join(logDir, `agent-${today}.log`), 'today log');
      writeFileSync(join(logDir, `agent-${today}.err`), 'today err');

      cleanOldLogs(7);

      // Old files should be deleted
      expect(existsSync(join(logDir, `agent-${oldDate}.log`))).toBe(false);
      expect(existsSync(join(logDir, `agent-${oldDate}.err`))).toBe(false);
      // Today's files should remain
      expect(existsSync(join(logDir, `agent-${today}.log`))).toBe(true);
      expect(existsSync(join(logDir, `agent-${today}.err`))).toBe(true);
    });

    it('cleanOldLogs does not delete non-matching files', () => {
      const logDir = getLogDir();
      writeFileSync(join(logDir, 'agent.log'), 'legacy log');
      writeFileSync(join(logDir, 'other.txt'), 'other file');

      cleanOldLogs(7);

      expect(existsSync(join(logDir, 'agent.log'))).toBe(true);
      expect(existsSync(join(logDir, 'other.txt'))).toBe(true);
    });
  });

  describe('resolveConfig ignoreConfigFile', () => {
    it('ignores config file when ignoreConfigFile is true', () => {
      saveConfig({ server: 'ws://file-server', password: 'file-pass', name: 'FileAgent' });
      const config = resolveConfig({}, true);
      expect(config.server).toBe('wss://msclaude.ai');
      expect(config.password).toBeUndefined();
      expect(config.name).toMatch(/^Agent-/);
      expect(config.autoUpdate).toBe(false);
    });

    it('CLI flags still work with ignoreConfigFile', () => {
      saveConfig({ server: 'ws://file-server' });
      const config = resolveConfig({ server: 'ws://cli-server', password: 'cli-pass' }, true);
      expect(config.server).toBe('ws://cli-server');
      expect(config.password).toBe('cli-pass');
    });

    it('does not inherit password from config file when ignoreConfigFile is true', () => {
      saveConfig({ password: 'production-secret' });
      const config = resolveConfig({}, true);
      expect(config.password).toBeUndefined();
    });

    it('does not inherit autoUpdate from config file when ignoreConfigFile is true', () => {
      saveConfig({ autoUpdate: true });
      const config = resolveConfig({}, true);
      expect(config.autoUpdate).toBe(false);
    });
  });

  describe('PidFile', () => {
    it('writePidFile / readPidFile round-trips', () => {
      const pidFilePath = join(tempHome, 'test.pid');
      writePidFile(pidFilePath, { pid: 9999, sessionUrl: 'http://localhost:3456/s/abc' });
      const info = readPidFile(pidFilePath);
      expect(info).toEqual({ pid: 9999, sessionUrl: 'http://localhost:3456/s/abc' });
    });

    it('readPidFile returns null when file does not exist', () => {
      expect(readPidFile(join(tempHome, 'nonexistent.pid'))).toBeNull();
    });

    it('writePidFile works without sessionUrl', () => {
      const pidFilePath = join(tempHome, 'test2.pid');
      writePidFile(pidFilePath, { pid: 1234 });
      const info = readPidFile(pidFilePath);
      expect(info!.pid).toBe(1234);
    });
  });
});
