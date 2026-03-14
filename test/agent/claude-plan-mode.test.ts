/**
 * Tests for Plan Mode support in claude.ts.
 *
 * These tests verify:
 * - setPermissionMode injects EnterPlanMode/ExitPlanMode when process is idle
 * - setPermissionMode kills process when turn is active or process is dead
 * - startQuery uses --permission-mode plan when planMode is true
 * - Default planMode is false (bypassPermissions)
 * - setPermissionMode with no existing conversation creates a placeholder
 *
 * Note: These tests do NOT spawn real Claude processes. They test the state
 * management logic by calling exported functions and inspecting conversations.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  handleChat,
  abortAll,
  getConversation,
  getConversations,
  setSendFn,
  setPermissionMode,
} from '../../agent/src/claude.js';

// Track spawn calls to verify CLI args
const spawnMock = vi.fn();

// Mock child_process to avoid actually spawning Claude
vi.mock('child_process', () => {
  const { EventEmitter } = require('events');
  const { PassThrough } = require('stream');

  function createMockChild() {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = Math.floor(Math.random() * 100000);
    child.killed = false;
    child.kill = vi.fn(() => { child.killed = true; });
    return child;
  }

  return {
    spawn: (...args: unknown[]) => {
      spawnMock(...args);
      return createMockChild();
    },
    execSync: vi.fn(),
  };
});

// Mock sdk.js
vi.mock('../../agent/src/sdk.js', () => ({
  resolveClaudeCommand: () => ({ command: 'claude', prefixArgs: [], spawnOpts: {} }),
  getCleanEnv: () => ({ ...process.env }),
  streamToStdin: vi.fn(),
}));

// Mock config.js
vi.mock('../../agent/src/config.js', () => ({
  CONFIG_DIR: '/tmp/agentlink-test',
}));

// Mock fs operations used by processFilesForClaude
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

describe('claude.ts plan mode', () => {
  let sentMessages: Record<string, unknown>[];

  beforeEach(() => {
    abortAll();
    sentMessages = [];
    setSendFn((msg) => sentMessages.push(msg));
    spawnMock.mockClear();
  });

  afterEach(() => {
    abortAll();
  });

  describe('default planMode', () => {
    it('defaults to planMode=false when creating a new conversation', () => {
      handleChat('conv-plan-1', 'hello', '/tmp');
      const conv = getConversation('conv-plan-1');
      expect(conv).not.toBeNull();
      expect(conv?.planMode).toBe(false);
    });

    it('spawns claude with --permission-mode bypassPermissions by default', () => {
      handleChat('conv-plan-2', 'hello', '/tmp');
      expect(spawnMock).toHaveBeenCalled();
      const args = spawnMock.mock.calls[0][1] as string[];
      const modeIdx = args.indexOf('--permission-mode');
      expect(modeIdx).toBeGreaterThan(-1);
      expect(args[modeIdx + 1]).toBe('bypassPermissions');
    });
  });

  describe('setPermissionMode — process idle (injects message)', () => {
    it('injects EnterPlanMode instruction when process is idle', () => {
      handleChat('conv-idle-1', 'hello', '/tmp');
      const conv = getConversation('conv-idle-1')!;
      // Simulate turn completed (idle)
      conv.turnActive = false;
      conv.turnResultReceived = true;

      const result = setPermissionMode('conv-idle-1', 'plan');

      expect(result).toBe('injected');
      // Process should still be alive (not killed)
      expect(conv.child).not.toBeNull();
      expect(conv.child!.killed).toBe(false);
      // planMode should be set
      expect(conv.planMode).toBe(true);
      // Turn should be active (injected message starts a new turn)
      expect(conv.turnActive).toBe(true);
    });

    it('injects ExitPlanMode instruction when switching back', () => {
      handleChat('conv-idle-2', 'hello', '/tmp');
      const conv = getConversation('conv-idle-2')!;
      conv.turnActive = false;
      conv.planMode = true; // pretend we're in plan mode

      const result = setPermissionMode('conv-idle-2', 'bypassPermissions');

      expect(result).toBe('injected');
      expect(conv.child).not.toBeNull();
      expect(conv.child!.killed).toBe(false);
      expect(conv.planMode).toBe(false);
      expect(conv.turnActive).toBe(true);
    });

    it('preserves session ID when injecting (no process restart)', () => {
      handleChat('conv-idle-3', 'hello', '/tmp');
      const conv = getConversation('conv-idle-3')!;
      conv.turnActive = false;
      conv.claudeSessionId = 'session-preserved';

      const result = setPermissionMode('conv-idle-3', 'plan');

      expect(result).toBe('injected');
      // Same conversation object, session ID preserved
      expect(conv.claudeSessionId).toBe('session-preserved');
    });
  });

  describe('setPermissionMode — process busy or dead (kills and recreates)', () => {
    it('kills process when turn is active', () => {
      handleChat('conv-busy-1', 'hello', '/tmp');
      const conv = getConversation('conv-busy-1')!;
      // turnActive is true after handleChat (default)
      expect(conv.turnActive).toBe(true);

      const result = setPermissionMode('conv-busy-1', 'plan');

      expect(result).toBe('immediate');
      const newConv = getConversation('conv-busy-1');
      expect(newConv).not.toBeNull();
      expect(newConv?.child).toBeNull();
      expect(newConv?.inputStream).toBeNull();
      expect(newConv?.planMode).toBe(true);
    });

    it('preserves session ID for resume when killing', () => {
      handleChat('conv-busy-2', 'hello', '/tmp');
      const conv = getConversation('conv-busy-2')!;
      conv.claudeSessionId = 'session-abc-123';

      setPermissionMode('conv-busy-2', 'plan');

      const newConv = getConversation('conv-busy-2');
      expect(newConv).not.toBeNull();
      expect(newConv?.lastClaudeSessionId).toBe('session-abc-123');
    });

    it('preserves lastClaudeSessionId when claudeSessionId is null', () => {
      handleChat('conv-busy-3', 'hello', '/tmp');
      const conv = getConversation('conv-busy-3')!;
      conv.claudeSessionId = null;
      conv.lastClaudeSessionId = 'session-xyz-789';

      setPermissionMode('conv-busy-3', 'plan');

      const newConv = getConversation('conv-busy-3');
      expect(newConv?.lastClaudeSessionId).toBe('session-xyz-789');
    });

    it('preserves workDir', () => {
      handleChat('conv-busy-4', 'hello', '/projects/myapp');
      setPermissionMode('conv-busy-4', 'plan');

      const conv = getConversation('conv-busy-4');
      expect(conv?.workDir).toBe('/projects/myapp');
    });
  });

  describe('setPermissionMode — no existing conversation', () => {
    it('creates placeholder when conversation does not exist', () => {
      const result = setPermissionMode('nonexistent-conv', 'plan');

      expect(result).toBe('immediate');
      const conv = getConversation('nonexistent-conv');
      expect(conv).not.toBeNull();
      expect(conv?.planMode).toBe(true);
    });

    it('stores claudeSessionId as lastClaudeSessionId in placeholder', () => {
      const result = setPermissionMode('restored-conv', 'bypassPermissions', 'session-from-history');

      expect(result).toBe('immediate');
      const conv = getConversation('restored-conv');
      expect(conv).not.toBeNull();
      expect(conv?.planMode).toBe(false);
      expect(conv?.lastClaudeSessionId).toBe('session-from-history');
    });

    it('can switch from plan back to bypassPermissions', () => {
      handleChat('conv-switch-1', 'hello', '/tmp');
      setPermissionMode('conv-switch-1', 'plan');
      expect(getConversation('conv-switch-1')?.planMode).toBe(true);

      setPermissionMode('conv-switch-1', 'bypassPermissions');
      expect(getConversation('conv-switch-1')?.planMode).toBe(false);
    });

    it('uses undefined conversationId as default', () => {
      handleChat(undefined, 'hello', '/tmp');
      setPermissionMode(undefined, 'plan');

      const conv = getConversation(); // default
      expect(conv).not.toBeNull();
      expect(conv?.planMode).toBe(true);
    });
  });

  describe('startQuery uses planMode from existing state', () => {
    it('spawns claude with --permission-mode plan when mode is set', () => {
      handleChat('conv-sq-1', 'first message', '/tmp');
      spawnMock.mockClear();

      // Set plan mode (kills process since turn is active)
      setPermissionMode('conv-sq-1', 'plan');

      // Send another message — triggers startQuery with the stored mode
      handleChat('conv-sq-1', 'second message', '/tmp');

      expect(spawnMock).toHaveBeenCalled();
      const args = spawnMock.mock.calls[0][1] as string[];
      const modeIdx = args.indexOf('--permission-mode');
      expect(modeIdx).toBeGreaterThan(-1);
      expect(args[modeIdx + 1]).toBe('plan');
    });

    it('spawns claude with --permission-mode bypassPermissions after switching back', () => {
      handleChat('conv-sq-2', 'first message', '/tmp');
      setPermissionMode('conv-sq-2', 'plan');
      setPermissionMode('conv-sq-2', 'bypassPermissions');
      spawnMock.mockClear();

      handleChat('conv-sq-2', 'second message', '/tmp');

      expect(spawnMock).toHaveBeenCalled();
      const args = spawnMock.mock.calls[0][1] as string[];
      const modeIdx = args.indexOf('--permission-mode');
      expect(modeIdx).toBeGreaterThan(-1);
      expect(args[modeIdx + 1]).toBe('bypassPermissions');
    });

    it('resumes session with the new permission mode', () => {
      handleChat('conv-sq-3', 'first message', '/tmp');
      const conv = getConversation('conv-sq-3')!;
      conv.claudeSessionId = 'session-resume-test';
      spawnMock.mockClear();

      setPermissionMode('conv-sq-3', 'plan');
      handleChat('conv-sq-3', 'second message', '/tmp');

      expect(spawnMock).toHaveBeenCalled();
      const args = spawnMock.mock.calls[0][1] as string[];

      // Verify plan mode
      const modeIdx = args.indexOf('--permission-mode');
      expect(args[modeIdx + 1]).toBe('plan');

      // Verify resume with saved session
      const resumeIdx = args.indexOf('--resume');
      expect(resumeIdx).toBeGreaterThan(-1);
      expect(args[resumeIdx + 1]).toBe('session-resume-test');
    });
  });

});
