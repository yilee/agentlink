/**
 * Tests for Plan Mode support in claude.ts.
 *
 * These tests verify:
 * - restartConversation kills process, preserves session, updates planMode
 * - restartConversation returns correct wasTurnActive status
 * - restartConversation with no existing conversation returns null session
 * - createPlaceholderConversation creates state for pre-first-message toggle
 * - startQuery uses --permission-mode plan when planMode is true
 * - Default planMode is false (bypassPermissions)
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
  restartConversation,
  createPlaceholderConversation,
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

  describe('restartConversation — kills process and recreates state', () => {
    it('kills process and sets planMode when turn is active', () => {
      handleChat('conv-restart-1', 'hello', '/tmp');
      const conv = getConversation('conv-restart-1')!;
      expect(conv.turnActive).toBe(true);
      // Simulate session ID being set (normally comes from Claude stdout)
      conv.claudeSessionId = 'session-from-init';

      const result = restartConversation('conv-restart-1', { planMode: true });

      expect(result.wasTurnActive).toBe(true);
      expect(result.claudeSessionId).toBe('session-from-init');
      const newConv = getConversation('conv-restart-1');
      expect(newConv).not.toBeNull();
      expect(newConv?.child).toBeNull();
      expect(newConv?.inputStream).toBeNull();
      expect(newConv?.planMode).toBe(true);
    });

    it('kills idle process and sets planMode', () => {
      handleChat('conv-restart-idle', 'hello', '/tmp');
      const conv = getConversation('conv-restart-idle')!;
      conv.turnActive = false;
      conv.turnResultReceived = true;

      const result = restartConversation('conv-restart-idle', { planMode: true });

      expect(result.wasTurnActive).toBe(false);
      const newConv = getConversation('conv-restart-idle');
      expect(newConv?.planMode).toBe(true);
      expect(newConv?.child).toBeNull();
    });

    it('preserves session ID for resume', () => {
      handleChat('conv-restart-2', 'hello', '/tmp');
      const conv = getConversation('conv-restart-2')!;
      conv.claudeSessionId = 'session-abc-123';

      const result = restartConversation('conv-restart-2', { planMode: true });

      expect(result.claudeSessionId).toBe('session-abc-123');
      const newConv = getConversation('conv-restart-2');
      expect(newConv?.lastClaudeSessionId).toBe('session-abc-123');
    });

    it('preserves lastClaudeSessionId when claudeSessionId is null', () => {
      handleChat('conv-restart-3', 'hello', '/tmp');
      const conv = getConversation('conv-restart-3')!;
      conv.claudeSessionId = null;
      conv.lastClaudeSessionId = 'session-xyz-789';

      restartConversation('conv-restart-3', { planMode: true });

      const newConv = getConversation('conv-restart-3');
      expect(newConv?.lastClaudeSessionId).toBe('session-xyz-789');
    });

    it('preserves workDir', () => {
      handleChat('conv-restart-4', 'hello', '/projects/myapp');
      restartConversation('conv-restart-4', { planMode: true });

      const conv = getConversation('conv-restart-4');
      expect(conv?.workDir).toBe('/projects/myapp');
    });

    it('preserves brainMode', () => {
      handleChat('conv-restart-5', 'hello', '/tmp');
      const conv = getConversation('conv-restart-5')!;
      conv.brainMode = true;

      restartConversation('conv-restart-5', { planMode: true });

      const newConv = getConversation('conv-restart-5');
      expect(newConv?.brainMode).toBe(true);
    });

    it('preserves current planMode when no planMode option given', () => {
      handleChat('conv-restart-6', 'hello', '/tmp');
      const conv = getConversation('conv-restart-6')!;
      conv.planMode = true;

      restartConversation('conv-restart-6');

      const newConv = getConversation('conv-restart-6');
      expect(newConv?.planMode).toBe(true);
    });

    it('returns null session for non-existent conversation', () => {
      const result = restartConversation('nonexistent-conv');

      expect(result.claudeSessionId).toBeNull();
      expect(result.wasTurnActive).toBe(false);
      expect(getConversation('nonexistent-conv')).toBeNull();
    });

    it('can switch from plan back to normal', () => {
      handleChat('conv-switch-1', 'hello', '/tmp');
      restartConversation('conv-switch-1', { planMode: true });
      expect(getConversation('conv-switch-1')?.planMode).toBe(true);

      restartConversation('conv-switch-1', { planMode: false });
      expect(getConversation('conv-switch-1')?.planMode).toBe(false);
    });

    it('uses undefined conversationId as default', () => {
      handleChat(undefined, 'hello', '/tmp');
      restartConversation(undefined, { planMode: true });

      const conv = getConversation(); // default
      expect(conv).not.toBeNull();
      expect(conv?.planMode).toBe(true);
    });
  });

  describe('createPlaceholderConversation', () => {
    it('creates placeholder with planMode true', () => {
      createPlaceholderConversation('placeholder-1', { planMode: true });

      const conv = getConversation('placeholder-1');
      expect(conv).not.toBeNull();
      expect(conv?.planMode).toBe(true);
      expect(conv?.child).toBeNull();
      expect(conv?.workDir).toBe('');
    });

    it('creates placeholder with planMode false by default', () => {
      createPlaceholderConversation('placeholder-2');

      const conv = getConversation('placeholder-2');
      expect(conv?.planMode).toBe(false);
    });

    it('uses default conversationId when undefined', () => {
      createPlaceholderConversation(undefined, { planMode: true });

      const conv = getConversation(); // default
      expect(conv).not.toBeNull();
      expect(conv?.planMode).toBe(true);
    });
  });

  describe('startQuery uses planMode from existing state', () => {
    it('spawns claude with --permission-mode plan when mode is set', () => {
      handleChat('conv-sq-1', 'first message', '/tmp');
      spawnMock.mockClear();

      // Set plan mode via restartConversation
      restartConversation('conv-sq-1', { planMode: true });

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
      restartConversation('conv-sq-2', { planMode: true });
      restartConversation('conv-sq-2', { planMode: false });
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

      restartConversation('conv-sq-3', { planMode: true });
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
