import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
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
});
