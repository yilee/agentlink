import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Writable, PassThrough } from 'stream';

// ── Tests for pure/testable functions in agent/sdk.ts ──

// We test: isWindows, getCleanEnv, resolveClaudeCommand, streamToStdin
// getDefaultClaudeCodePath relies on filesystem + execSync, tested via resolveClaudeCommand integration

describe('Agent SDK', () => {
  const originalPlatform = process.platform;
  const originalEnv = { ...process.env };

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
    process.env = { ...originalEnv };
  });

  describe('isWindows', () => {
    it('returns true on win32', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32', writable: true });
      // Re-import to pick up platform — but isWindows reads platform() at call time
      const { isWindows } = await import('../../agent/src/sdk.js');
      expect(isWindows()).toBe(process.platform === 'win32');
    });
  });

  describe('getCleanEnv', () => {
    it('returns an env object with PATH set', async () => {
      const { getCleanEnv } = await import('../../agent/src/sdk.js');
      const env = getCleanEnv();
      expect(env.PATH || env.Path).toBeTruthy();
    });

    it('includes enhanced paths beyond original PATH', async () => {
      const { getCleanEnv } = await import('../../agent/src/sdk.js');
      const originalPath = process.env.PATH || process.env.Path || '';
      const cleanEnv = getCleanEnv();
      const newPath = cleanEnv.PATH || cleanEnv.Path || '';
      // Enhanced path should be at least as long as original
      expect(newPath.length).toBeGreaterThanOrEqual(originalPath.length);
    });

    it('sets COMSPEC and SystemRoot on Windows', async () => {
      if (process.platform !== 'win32') return; // Skip on non-Windows
      delete process.env.COMSPEC;
      delete process.env.SystemRoot;
      const { getCleanEnv } = await import('../../agent/src/sdk.js');
      const env = getCleanEnv();
      expect(env.COMSPEC).toBe('C:\\Windows\\system32\\cmd.exe');
      expect(env.SystemRoot).toBe('C:\\Windows');
    });
  });

  describe('getDefaultClaudeCodePath', () => {
    it('respects CLAUDE_PATH env var', async () => {
      process.env.CLAUDE_PATH = '/custom/path/to/claude';
      // Need fresh import to pick up env change — but the function reads env at call time
      const { getDefaultClaudeCodePath } = await import('../../agent/src/sdk.js');
      expect(getDefaultClaudeCodePath()).toBe('/custom/path/to/claude');
      delete process.env.CLAUDE_PATH;
    });

    it('returns a string (fallback to "claude" if not found)', async () => {
      delete process.env.CLAUDE_PATH;
      const { getDefaultClaudeCodePath } = await import('../../agent/src/sdk.js');
      const result = getDefaultClaudeCodePath();
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('resolveClaudeCommand', () => {
    it('returns command, prefixArgs, and spawnOpts', async () => {
      const { resolveClaudeCommand } = await import('../../agent/src/sdk.js');
      const result = resolveClaudeCommand();
      expect(result).toHaveProperty('command');
      expect(result).toHaveProperty('prefixArgs');
      expect(result).toHaveProperty('spawnOpts');
      expect(typeof result.command).toBe('string');
      expect(Array.isArray(result.prefixArgs)).toBe(true);
      expect(typeof result.spawnOpts).toBe('object');
    });

    it('command is not empty', async () => {
      const { resolveClaudeCommand } = await import('../../agent/src/sdk.js');
      const result = resolveClaudeCommand();
      expect(result.command.length).toBeGreaterThan(0);
    });

    it('returns process.execPath when CLAUDE_PATH points to a .cmd file with valid JS target', async () => {
      if (process.platform !== 'win32') return; // Windows-only test
      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-test-'));
      const cmdPath = path.join(tmpDir, 'claude.cmd');
      const jsPath = path.join(tmpDir, 'cli.js');
      // Create a fake .cmd wrapper that references cli.js
      fs.writeFileSync(cmdPath, `@"%dp0%\\cli.js" %*\r\n`);
      fs.writeFileSync(jsPath, '// fake');
      process.env.CLAUDE_PATH = cmdPath;
      try {
        const { resolveClaudeCommand } = await import('../../agent/src/sdk.js');
        const result = resolveClaudeCommand();
        expect(result.command).toBe(process.execPath);
        expect(result.prefixArgs[0]).toBe(jsPath);
      } finally {
        delete process.env.CLAUDE_PATH;
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('streamToStdin', () => {
    it('writes JSON lines to stdin', async () => {
      const { streamToStdin } = await import('../../agent/src/sdk.js');
      const chunks: string[] = [];
      const writable = new PassThrough();
      writable.on('data', (chunk) => chunks.push(chunk.toString()));

      const messages = [
        { type: 'user', content: 'hello' },
        { type: 'user', content: 'world' },
      ];

      async function* gen() {
        for (const m of messages) yield m;
      }

      await streamToStdin(gen(), writable);
      const output = chunks.join('');
      const lines = output.trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0])).toEqual({ type: 'user', content: 'hello' });
      expect(JSON.parse(lines[1])).toEqual({ type: 'user', content: 'world' });
    });

    it('stops when abort signal is triggered', async () => {
      const { streamToStdin } = await import('../../agent/src/sdk.js');
      const chunks: string[] = [];
      const writable = new PassThrough();
      writable.on('data', (chunk) => chunks.push(chunk.toString()));

      const ac = new AbortController();

      async function* gen() {
        yield { type: 'first' };
        ac.abort();
        yield { type: 'second' };
        yield { type: 'third' };
      }

      await streamToStdin(gen(), writable, ac.signal);
      const output = chunks.join('');
      const lines = output.trim().split('\n').filter(Boolean);
      // First message should be written, abort happens after yield 'second' is consumed
      // but check is at top of loop so 'second' may or may not be written
      expect(lines.length).toBeLessThanOrEqual(2);
      expect(JSON.parse(lines[0])).toEqual({ type: 'first' });
    });

    it('handles empty stream', async () => {
      const { streamToStdin } = await import('../../agent/src/sdk.js');
      const chunks: string[] = [];
      const writable = new PassThrough();
      writable.on('data', (chunk) => chunks.push(chunk.toString()));

      async function* gen(): AsyncGenerator<unknown> {
        // empty
      }

      await streamToStdin(gen(), writable);
      const output = chunks.join('');
      expect(output).toBe('');
    });
  });
});
