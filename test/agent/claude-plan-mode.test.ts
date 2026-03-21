/**
 * Tests for Plan Mode support in claude.ts.
 *
 * These tests verify:
 * - restartConversation kills process, preserves session, updates planMode
 * - restartConversation sets planModeJustChanged flag when mode changes
 * - restartConversation returns correct wasTurnActive status
 * - restartConversation with no existing conversation returns null session
 * - createPlaceholderConversation creates state for pre-first-message toggle
 * - startQuery uses --permission-mode plan when planMode is true
 * - handleChat prepends [SYSTEM NOTICE] when planModeJustChanged is set
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
// Track mock children for simulating Claude stdout output
const mockChildren: Array<{ stdin: any; stdout: any; stderr: any; emit: any; kill: any }> = [];

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
    mockChildren.push(child);
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
    mockChildren.length = 0;
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
      // Session ID preserved — we resume the same session with different --permission-mode
      expect(result.claudeSessionId).toBe('session-from-init');
      const newConv = getConversation('conv-restart-1');
      expect(newConv).not.toBeNull();
      expect(newConv?.child).toBeNull();
      expect(newConv?.inputStream).toBeNull();
      expect(newConv?.planMode).toBe(true);
      expect(newConv?.planModeJustChanged).toBe(true);
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

    it('preserves session ID when plan mode changes (same session, different --permission-mode)', () => {
      handleChat('conv-restart-2', 'hello', '/tmp');
      const conv = getConversation('conv-restart-2')!;
      conv.claudeSessionId = 'session-abc-123';

      const result = restartConversation('conv-restart-2', { planMode: true });

      // Session ID preserved — resume same session with new permission mode
      expect(result.claudeSessionId).toBe('session-abc-123');
      const newConv = getConversation('conv-restart-2');
      expect(newConv?.lastClaudeSessionId).toBe('session-abc-123');
      expect(newConv?.planModeJustChanged).toBe(true);
    });

    it('preserves session ID when plan mode does not change', () => {
      handleChat('conv-restart-2b', 'hello', '/tmp');
      const conv = getConversation('conv-restart-2b')!;
      conv.claudeSessionId = 'session-abc-123';

      // Restart without changing planMode (e.g., for reload)
      const result = restartConversation('conv-restart-2b');

      expect(result.claudeSessionId).toBe('session-abc-123');
      const newConv = getConversation('conv-restart-2b');
      expect(newConv?.lastClaudeSessionId).toBe('session-abc-123');
    });

    it('preserves lastClaudeSessionId when plan mode changes and claudeSessionId is null', () => {
      handleChat('conv-restart-3', 'hello', '/tmp');
      const conv = getConversation('conv-restart-3')!;
      conv.claudeSessionId = null;
      conv.lastClaudeSessionId = 'session-xyz-789';

      restartConversation('conv-restart-3', { planMode: true });

      const newConv = getConversation('conv-restart-3');
      // Preserved — same session resumed with different --permission-mode
      expect(newConv?.lastClaudeSessionId).toBe('session-xyz-789');
    });

    it('preserves lastClaudeSessionId when claudeSessionId is null and plan mode unchanged', () => {
      handleChat('conv-restart-3b', 'hello', '/tmp');
      const conv = getConversation('conv-restart-3b')!;
      conv.claudeSessionId = null;
      conv.lastClaudeSessionId = 'session-xyz-789';

      restartConversation('conv-restart-3b');

      const newConv = getConversation('conv-restart-3b');
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

    it('DOES resume session when plan mode changes (same session, different --permission-mode)', () => {
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

      // Should have --resume since we keep the same session
      const resumeIdx = args.indexOf('--resume');
      expect(resumeIdx).toBeGreaterThan(-1);
      expect(args[resumeIdx + 1]).toBe('session-resume-test');
    });

    it('DOES resume session when plan mode does not change', () => {
      handleChat('conv-sq-3b', 'first message', '/tmp');
      const conv = getConversation('conv-sq-3b')!;
      conv.claudeSessionId = 'session-resume-test';
      spawnMock.mockClear();

      // Restart without changing plan mode (e.g., reload)
      restartConversation('conv-sq-3b');
      handleChat('conv-sq-3b', 'second message', '/tmp');

      expect(spawnMock).toHaveBeenCalled();
      const args = spawnMock.mock.calls[0][1] as string[];

      // Should have --resume since plan mode didn't change
      const resumeIdx = args.indexOf('--resume');
      expect(resumeIdx).toBeGreaterThan(-1);
      expect(args[resumeIdx + 1]).toBe('session-resume-test');
    });
  });

  describe('planModeJustChanged flag', () => {
    it('sets planModeJustChanged when plan mode changes', () => {
      handleChat('conv-flag-1', 'hello', '/tmp');

      restartConversation('conv-flag-1', { planMode: true });

      const conv = getConversation('conv-flag-1');
      expect(conv?.planModeJustChanged).toBe(true);
    });

    it('does not set planModeJustChanged when plan mode stays the same', () => {
      handleChat('conv-flag-2', 'hello', '/tmp');

      restartConversation('conv-flag-2', { planMode: false }); // same as default

      const conv = getConversation('conv-flag-2');
      expect(conv?.planModeJustChanged).toBe(false);
    });

    it('does not set planModeJustChanged when no planMode option given', () => {
      handleChat('conv-flag-3', 'hello', '/tmp');

      restartConversation('conv-flag-3');

      const conv = getConversation('conv-flag-3');
      expect(conv?.planModeJustChanged).toBe(false);
    });

    it('is preserved across startQuery (handleChat after restart)', () => {
      handleChat('conv-flag-4', 'hello', '/tmp');
      restartConversation('conv-flag-4', { planMode: true });

      // handleChat triggers startQuery which rebuilds state — flag should carry over
      handleChat('conv-flag-4', 'next message', '/tmp');
      // After handleChat, flag should be cleared (consumed by the message prefix logic)
      const conv = getConversation('conv-flag-4');
      expect(conv?.planModeJustChanged).toBe(false);
    });
  });

  describe('message prefixing on plan mode change', () => {
    it('prepends activation notice when switching to plan mode', async () => {
      handleChat('conv-prefix-1', 'hello', '/tmp');
      restartConversation('conv-prefix-1', { planMode: true });

      handleChat('conv-prefix-1', 'analyze this code', '/tmp');

      // Read the enqueued message from the inputStream
      const conv = getConversation('conv-prefix-1')!;
      const result = await conv.inputStream!.next();
      expect(result.done).toBe(false);
      const msg = result.value as any;
      expect(msg.type).toBe('user');
      expect(msg.message.content).toContain('[SYSTEM NOTICE: Plan mode has been activated');
      expect(msg.message.content).toContain('analyze this code');
    });

    it('prepends deactivation notice when switching from plan to normal', async () => {
      handleChat('conv-prefix-2', 'hello', '/tmp');
      restartConversation('conv-prefix-2', { planMode: true });
      restartConversation('conv-prefix-2', { planMode: false });

      handleChat('conv-prefix-2', 'write a file', '/tmp');

      const conv = getConversation('conv-prefix-2')!;
      const result = await conv.inputStream!.next();
      expect(result.done).toBe(false);
      const msg = result.value as any;
      expect(msg.type).toBe('user');
      expect(msg.message.content).toContain('[SYSTEM NOTICE: Plan mode has been deactivated');
      expect(msg.message.content).toContain('write a file');
    });

    it('does NOT prepend notice on second message after toggle', async () => {
      handleChat('conv-prefix-3', 'hello', '/tmp');
      restartConversation('conv-prefix-3', { planMode: true });

      // First message after toggle — should have notice
      handleChat('conv-prefix-3', 'first msg', '/tmp');
      const conv = getConversation('conv-prefix-3')!;
      const first = await conv.inputStream!.next();
      expect((first.value as any).message.content).toContain('[SYSTEM NOTICE');

      // Second message — no notice
      handleChat('conv-prefix-3', 'second msg', '/tmp');
      const second = await conv.inputStream!.next();
      expect((second.value as any).message.content).toBe('second msg');
    });

    it('does NOT prepend notice when plan mode did not change', async () => {
      handleChat('conv-prefix-4', 'hello', '/tmp');
      restartConversation('conv-prefix-4'); // no plan mode change

      handleChat('conv-prefix-4', 'regular message', '/tmp');

      const conv = getConversation('conv-prefix-4')!;
      const result = await conv.inputStream!.next();
      expect((result.value as any).message.content).toBe('regular message');
    });
  });

  describe('plan mode detection via tool_use blocks in assistant messages', () => {
    /**
     * Simulate Claude sending an assistant message with a tool_use block
     * by writing JSON to the mock child's stdout.
     */
    function writeToStdout(child: any, msg: Record<string, unknown>) {
      child.stdout.write(JSON.stringify(msg) + '\n');
    }

    it('detects EnterPlanMode tool_use and sends plan_mode_changed', async () => {
      handleChat('conv-detect-enter', 'hello', '/tmp');
      const child = mockChildren[mockChildren.length - 1];

      // Simulate Claude's system init (needed to set session ID)
      writeToStdout(child, { type: 'system', session_id: 'sess-detect-1' });

      // Simulate assistant message containing EnterPlanMode tool_use
      writeToStdout(child, {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Entering plan mode.' },
            { type: 'tool_use', id: 'tu-1', name: 'EnterPlanMode', input: {} },
          ],
        },
      });

      // Give processOutput time to process
      await new Promise(r => setTimeout(r, 50));

      // Verify plan_mode_changed was sent
      const planModeMsg = sentMessages.find(
        (m) => m.type === 'plan_mode_changed' && m.enabled === true
      );
      expect(planModeMsg).toBeTruthy();

      // Verify conversation state was updated
      const conv = getConversation('conv-detect-enter');
      expect(conv?.planMode).toBe(true);
    });

    it('detects ExitPlanMode tool_use and sends plan_mode_changed', async () => {
      // Start in plan mode
      createPlaceholderConversation('conv-detect-exit', { planMode: true });
      handleChat('conv-detect-exit', 'hello', '/tmp');
      const child = mockChildren[mockChildren.length - 1];

      writeToStdout(child, { type: 'system', session_id: 'sess-detect-2' });

      writeToStdout(child, {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Exiting plan mode.' },
            { type: 'tool_use', id: 'tu-2', name: 'ExitPlanMode', input: {} },
          ],
        },
      });

      await new Promise(r => setTimeout(r, 50));

      const planModeMsg = sentMessages.find(
        (m) => m.type === 'plan_mode_changed' && m.enabled === false
      );
      expect(planModeMsg).toBeTruthy();

      const conv = getConversation('conv-detect-exit');
      expect(conv?.planMode).toBe(false);
    });

    it('does not send duplicate plan_mode_changed if already in the target state', async () => {
      handleChat('conv-detect-nodup', 'hello', '/tmp');
      const child = mockChildren[mockChildren.length - 1];

      writeToStdout(child, { type: 'system', session_id: 'sess-detect-3' });

      // planMode is already false, send ExitPlanMode — should not trigger
      writeToStdout(child, {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tu-3', name: 'ExitPlanMode', input: {} },
          ],
        },
      });

      await new Promise(r => setTimeout(r, 50));

      const planModeMsgs = sentMessages.filter(
        (m) => m.type === 'plan_mode_changed'
      );
      expect(planModeMsgs).toHaveLength(0);
    });
  });

});
