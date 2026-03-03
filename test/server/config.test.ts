import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
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
  killProcess,
  isProcessAlive,
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
      const { existsSync } = require('fs');
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
});
