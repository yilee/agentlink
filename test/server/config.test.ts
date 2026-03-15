import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock os.homedir() before importing config module
const tempHome = join(tmpdir(), `agentlink-test-srvconfig-${process.pid}`);

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => tempHome };
});

const {
  saveServerRuntimeState,
  loadServerRuntimeState,
  clearServerRuntimeState,
  getLogDir,
  getLogDate,
  cleanOldLogs,
  killProcess,
  isProcessAlive,
  writePidFile,
  readPidFile,
  CONFIG_DIR,
} = await import('../../server/src/config.js');

beforeEach(() => {
  delete process.env.AGENTLINK_NO_STATE;
  mkdirSync(join(tempHome, '.agentlink'), { recursive: true });
});

afterEach(() => {
  delete process.env.AGENTLINK_NO_STATE;
  rmSync(tempHome, { recursive: true, force: true });
});

describe('Server Config', () => {
  describe('ServerRuntimeState', () => {
    it('round-trips runtime state', () => {
      const state = {
        pid: 12345,
        port: 3456,
        startedAt: '2026-01-01T00:00:00Z',
      };
      saveServerRuntimeState(state);
      expect(loadServerRuntimeState()).toEqual(state);
    });

    it('returns null when no state file', () => {
      expect(loadServerRuntimeState()).toBeNull();
    });

    it('clearServerRuntimeState removes the file', () => {
      saveServerRuntimeState({
        pid: 1,
        port: 3456,
        startedAt: '2026-01-01T00:00:00Z',
      });
      clearServerRuntimeState();
      expect(loadServerRuntimeState()).toBeNull();
    });

    it('saveServerRuntimeState is a no-op when AGENTLINK_NO_STATE is set', () => {
      process.env.AGENTLINK_NO_STATE = '1';
      saveServerRuntimeState({
        pid: 999,
        port: 9999,
        startedAt: '2026-01-01T00:00:00Z',
      });
      // Should not have written a file
      expect(loadServerRuntimeState()).toBeNull();
    });

    it('clearServerRuntimeState is a no-op when AGENTLINK_NO_STATE is set', () => {
      // First save without the flag
      saveServerRuntimeState({
        pid: 1,
        port: 3456,
        startedAt: '2026-01-01T00:00:00Z',
      });
      // Set the flag, then clear — should NOT delete the file
      process.env.AGENTLINK_NO_STATE = '1';
      clearServerRuntimeState();
      // File should still exist
      delete process.env.AGENTLINK_NO_STATE;
      expect(loadServerRuntimeState()).toEqual({
        pid: 1,
        port: 3456,
        startedAt: '2026-01-01T00:00:00Z',
      });
    });
  });

  describe('getLogDir', () => {
    it('returns a path under CONFIG_DIR', () => {
      const logDir = getLogDir();
      expect(logDir).toContain('.agentlink');
      expect(logDir).toContain('logs');
    });

    it('creates the log directory if it does not exist', () => {
      const logDir = getLogDir();
      expect(existsSync(logDir)).toBe(true);
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

  describe('CONFIG_DIR', () => {
    it('is under the mocked home directory', () => {
      expect(CONFIG_DIR).toBe(join(tempHome, '.agentlink'));
    });
  });

  describe('Log rotation', () => {
    it('getLogDate returns YYYY-MM-DD format', () => {
      const date = getLogDate();
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('cleanOldLogs deletes server logs older than N days', () => {
      const logDir = getLogDir();
      // Create old log files (30 days ago)
      const old = new Date(Date.now() - 30 * 86400_000);
      const oldDate = old.toISOString().slice(0, 10);
      writeFileSync(join(logDir, `server-${oldDate}.log`), 'old log');
      writeFileSync(join(logDir, `server-${oldDate}.err`), 'old err');

      // Create today's log files
      const today = getLogDate();
      writeFileSync(join(logDir, `server-${today}.log`), 'today log');
      writeFileSync(join(logDir, `server-${today}.err`), 'today err');

      cleanOldLogs(7);

      // Old files should be deleted
      expect(existsSync(join(logDir, `server-${oldDate}.log`))).toBe(false);
      expect(existsSync(join(logDir, `server-${oldDate}.err`))).toBe(false);
      // Today's files should remain
      expect(existsSync(join(logDir, `server-${today}.log`))).toBe(true);
      expect(existsSync(join(logDir, `server-${today}.err`))).toBe(true);
    });

    it('cleanOldLogs does not delete non-matching files', () => {
      const logDir = getLogDir();
      writeFileSync(join(logDir, 'server.log'), 'legacy log');
      writeFileSync(join(logDir, 'other.txt'), 'other file');

      cleanOldLogs(7);

      expect(existsSync(join(logDir, 'server.log'))).toBe(true);
      expect(existsSync(join(logDir, 'other.txt'))).toBe(true);
    });
  });

  describe('PidFile', () => {
    it('writePidFile / readPidFile round-trips', () => {
      const pidFilePath = join(tempHome, 'test.pid');
      writePidFile(pidFilePath, { pid: 9999, port: 3456 });
      const info = readPidFile(pidFilePath);
      expect(info).toEqual({ pid: 9999, port: 3456 });
    });

    it('readPidFile returns null when file does not exist', () => {
      expect(readPidFile(join(tempHome, 'nonexistent.pid'))).toBeNull();
    });

    it('writePidFile works without port', () => {
      const pidFilePath = join(tempHome, 'test2.pid');
      writePidFile(pidFilePath, { pid: 1234 });
      const info = readPidFile(pidFilePath);
      expect(info!.pid).toBe(1234);
    });
  });
});
