/**
 * Tests for Plan Mode support in claude.ts.
 *
 * These tests verify:
 * - setPermissionMode creates state with the correct mode
 * - setPermissionMode kills existing process
 * - setPermissionMode preserves session ID for resume
 * - startQuery uses permissionMode from existing state
 * - Default permissionMode is bypassPermissions
 * - setPermissionMode with no existing conversation is a no-op
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

  describe('default permissionMode', () => {
    it('defaults to bypassPermissions when creating a new conversation', () => {
      handleChat('conv-plan-1', 'hello', '/tmp');
      const conv = getConversation('conv-plan-1');
      expect(conv).not.toBeNull();
      expect(conv?.permissionMode).toBe('bypassPermissions');
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

  describe('setPermissionMode', () => {
    it('creates state with the correct mode', () => {
      handleChat('conv-pm-1', 'hello', '/tmp');
      setPermissionMode('conv-pm-1', 'plan');

      const conv = getConversation('conv-pm-1');
      expect(conv).not.toBeNull();
      expect(conv?.permissionMode).toBe('plan');
    });

    it('kills existing process when switching mode', () => {
      handleChat('conv-pm-2', 'hello', '/tmp');
      const originalConv = getConversation('conv-pm-2');
      const originalChild = originalConv?.child;
      expect(originalChild).not.toBeNull();

      setPermissionMode('conv-pm-2', 'plan');

      // The original child should have been killed (cleanupConversation removes from map
      // and creates a new state entry, so the child reference should be null on the new state)
      const newConv = getConversation('conv-pm-2');
      expect(newConv).not.toBeNull();
      expect(newConv?.child).toBeNull();
      expect(newConv?.inputStream).toBeNull();
    });

    it('preserves session ID for resume', () => {
      handleChat('conv-pm-3', 'hello', '/tmp');
      const conv = getConversation('conv-pm-3')!;
      // Simulate Claude returning a session ID
      conv.claudeSessionId = 'session-abc-123';

      setPermissionMode('conv-pm-3', 'plan');

      const newConv = getConversation('conv-pm-3');
      expect(newConv).not.toBeNull();
      expect(newConv?.lastClaudeSessionId).toBe('session-abc-123');
    });

    it('preserves lastClaudeSessionId when claudeSessionId is null', () => {
      handleChat('conv-pm-4', 'hello', '/tmp');
      const conv = getConversation('conv-pm-4')!;
      conv.claudeSessionId = null;
      conv.lastClaudeSessionId = 'session-xyz-789';

      setPermissionMode('conv-pm-4', 'plan');

      const newConv = getConversation('conv-pm-4');
      expect(newConv?.lastClaudeSessionId).toBe('session-xyz-789');
    });

    it('preserves workDir', () => {
      handleChat('conv-pm-5', 'hello', '/projects/myapp');
      setPermissionMode('conv-pm-5', 'plan');

      const conv = getConversation('conv-pm-5');
      expect(conv?.workDir).toBe('/projects/myapp');
    });

    it('is a no-op when conversation does not exist', () => {
      // Should not throw
      setPermissionMode('nonexistent-conv', 'plan');

      // No conversation should be created
      expect(getConversation('nonexistent-conv')).toBeNull();
      expect(getConversations().size).toBe(0);
    });

    it('can switch from plan back to bypassPermissions', () => {
      handleChat('conv-pm-6', 'hello', '/tmp');
      setPermissionMode('conv-pm-6', 'plan');
      expect(getConversation('conv-pm-6')?.permissionMode).toBe('plan');

      setPermissionMode('conv-pm-6', 'bypassPermissions');
      expect(getConversation('conv-pm-6')?.permissionMode).toBe('bypassPermissions');
    });

    it('uses undefined conversationId as default', () => {
      handleChat(undefined, 'hello', '/tmp');
      setPermissionMode(undefined, 'plan');

      const conv = getConversation(); // default
      expect(conv).not.toBeNull();
      expect(conv?.permissionMode).toBe('plan');
    });
  });

  describe('startQuery uses permissionMode from existing state', () => {
    it('spawns claude with --permission-mode plan when mode is set', () => {
      // 1. Create a conversation
      handleChat('conv-sq-1', 'first message', '/tmp');
      spawnMock.mockClear();

      // 2. Set plan mode (kills process, creates minimal state with mode=plan)
      setPermissionMode('conv-sq-1', 'plan');

      // 3. Send another message -- this triggers startQuery with the stored mode
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
