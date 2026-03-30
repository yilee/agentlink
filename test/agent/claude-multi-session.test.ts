/**
 * Tests for multi-session parallel support in claude.ts.
 *
 * These tests verify:
 * - Conversations Map management (create, lookup, cleanup, abortAll)
 * - ConversationState fields (conversationId, isCompacting, lastClaudeSessionId, createdAt)
 * - Backward compatibility (no conversationId → 'default' key)
 * - Output messages include conversationId
 * - Eviction logic (MAX_CONVERSATIONS)
 * - Per-conversation cleanup (only clears own pending control requests)
 * - cancelExecution targets specific conversation
 *
 * Note: These tests do NOT spawn real Claude processes. They test the state
 * management and message routing logic by directly calling exported functions
 * and inspecting the conversations Map.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  handleChat,
  abort,
  abortAll,
  cancelExecution,
  getConversation,
  getConversations,
  getIsCompacting,
  clearSessionId,
  setSendFn,
  setOutputObserver,
  clearOutputObserver,
  MAX_CONVERSATIONS,
} from '../../agent/src/claude.js';

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
    spawn: vi.fn(() => createMockChild()),
    execSync: vi.fn(),
  };
});

// Mock sdk.js
vi.mock('../../agent/src/sdk.js', () => ({
  resolveClaudeCommand: () => ({ command: 'claude', prefixArgs: [], spawnOpts: {} }),
  getCleanEnv: () => ({ ...process.env }),
  streamToStdin: vi.fn().mockResolvedValue(undefined),
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

describe('claude.ts multi-session', () => {
  let sentMessages: Record<string, unknown>[];

  beforeEach(() => {
    // Clean up all conversations
    abortAll();
    sentMessages = [];
    setSendFn((msg) => sentMessages.push(msg));
  });

  describe('conversations Map management', () => {
    it('starts empty', () => {
      expect(getConversations().size).toBe(0);
    });

    it('creates a conversation when handleChat is called with conversationId', () => {
      handleChat('conv-1', 'hello', '/tmp');
      expect(getConversations().size).toBe(1);
      expect(getConversation('conv-1')).not.toBeNull();
    });

    it('creates multiple independent conversations', () => {
      handleChat('conv-1', 'hello', '/tmp');
      handleChat('conv-2', 'world', '/tmp');
      expect(getConversations().size).toBe(2);

      const conv1 = getConversation('conv-1');
      const conv2 = getConversation('conv-2');
      expect(conv1).not.toBeNull();
      expect(conv2).not.toBeNull();
      expect(conv1).not.toBe(conv2);
    });

    it('does not abort other conversations when starting a new one', () => {
      handleChat('conv-1', 'hello', '/tmp');
      const conv1 = getConversation('conv-1');

      handleChat('conv-2', 'world', '/tmp');

      // conv-1 should still exist
      expect(getConversation('conv-1')).not.toBeNull();
      // And conv-2 also exists
      expect(getConversation('conv-2')).not.toBeNull();
    });

    it('abort(convId) only removes the specified conversation', () => {
      handleChat('conv-1', 'hello', '/tmp');
      handleChat('conv-2', 'world', '/tmp');

      abort('conv-1');

      expect(getConversation('conv-1')).toBeNull();
      expect(getConversation('conv-2')).not.toBeNull();
    });

    it('abortAll() removes all conversations', () => {
      handleChat('conv-1', 'hello', '/tmp');
      handleChat('conv-2', 'world', '/tmp');
      handleChat('conv-3', 'foo', '/tmp');

      abortAll();

      expect(getConversations().size).toBe(0);
    });
  });

  describe('ConversationState fields', () => {
    it('sets conversationId on the state', () => {
      handleChat('my-conv-id', 'hello', '/tmp');
      const conv = getConversation('my-conv-id');
      expect(conv?.conversationId).toBe('my-conv-id');
    });

    it('sets workDir on the state', () => {
      handleChat('conv-1', 'hello', '/projects/foo');
      const conv = getConversation('conv-1');
      expect(conv?.workDir).toBe('/projects/foo');
    });

    it('sets createdAt to a recent timestamp', () => {
      const before = Date.now();
      handleChat('conv-1', 'hello', '/tmp');
      const after = Date.now();

      const conv = getConversation('conv-1');
      expect(conv?.createdAt).toBeGreaterThanOrEqual(before);
      expect(conv?.createdAt).toBeLessThanOrEqual(after);
    });

    it('initializes isCompacting to false', () => {
      handleChat('conv-1', 'hello', '/tmp');
      expect(getIsCompacting('conv-1')).toBe(false);
    });

    it('sets turnActive to true after handleChat', () => {
      handleChat('conv-1', 'hello', '/tmp');
      const conv = getConversation('conv-1');
      expect(conv?.turnActive).toBe(true);
    });
  });

  describe('backward compatibility (no conversationId)', () => {
    it('uses default key when conversationId is undefined', () => {
      handleChat(undefined, 'hello', '/tmp');
      const conv = getConversation(); // no arg → default
      expect(conv).not.toBeNull();
      expect(conv?.conversationId).toBe('default');
    });

    it('getConversation() without args returns default conversation', () => {
      handleChat(undefined, 'hello', '/tmp');
      const conv = getConversation();
      expect(conv).not.toBeNull();
    });

    it('abort() without args aborts the default conversation', () => {
      handleChat(undefined, 'hello', '/tmp');
      expect(getConversation()).not.toBeNull();

      abort();
      expect(getConversation()).toBeNull();
    });

    it('clearSessionId() without args clears all', () => {
      handleChat('conv-1', 'hello', '/tmp');
      handleChat('conv-2', 'world', '/tmp');

      clearSessionId();

      expect(getConversation('conv-1')?.lastClaudeSessionId).toBeNull();
      expect(getConversation('conv-2')?.lastClaudeSessionId).toBeNull();
    });

    it('clearSessionId(convId) only clears the specified conversation', () => {
      handleChat('conv-1', 'hello', '/tmp');
      handleChat('conv-2', 'world', '/tmp');

      // Manually set lastClaudeSessionId for testing
      const conv1 = getConversation('conv-1')!;
      const conv2 = getConversation('conv-2')!;
      conv1.lastClaudeSessionId = 'session-a';
      conv2.lastClaudeSessionId = 'session-b';

      clearSessionId('conv-1');

      expect(conv1.lastClaudeSessionId).toBeNull();
      expect(conv2.lastClaudeSessionId).toBe('session-b');
    });

    it('getIsCompacting() without args checks the default conversation', () => {
      handleChat(undefined, 'hello', '/tmp');
      expect(getIsCompacting()).toBe(false);
    });
  });

  describe('cancelExecution', () => {
    it('only cancels the specified conversation', () => {
      handleChat('conv-1', 'hello', '/tmp');
      handleChat('conv-2', 'world', '/tmp');

      cancelExecution('conv-1');

      // conv-1 should be removed
      expect(getConversation('conv-1')).toBeNull();
      // conv-2 should still exist
      expect(getConversation('conv-2')).not.toBeNull();
    });

    it('sends execution_cancelled with conversationId', () => {
      handleChat('conv-1', 'hello', '/tmp');
      sentMessages = [];

      cancelExecution('conv-1');

      const cancelled = sentMessages.find(m => m.type === 'execution_cancelled');
      expect(cancelled).toBeDefined();
      expect(cancelled?.conversationId).toBe('conv-1');
    });

    it('cancelExecution() without args cancels the default conversation', () => {
      handleChat(undefined, 'hello', '/tmp');
      cancelExecution();

      expect(getConversation()).toBeNull();
    });

    it('does nothing if conversation does not exist', () => {
      cancelExecution('nonexistent');
      // Should not throw
      expect(sentMessages).toHaveLength(0);
    });
  });

  describe('eviction logic', () => {
    it('allows up to MAX_CONVERSATIONS', () => {
      for (let i = 0; i < MAX_CONVERSATIONS; i++) {
        handleChat(`conv-${i}`, `msg ${i}`, '/tmp');
      }
      expect(getConversations().size).toBe(MAX_CONVERSATIONS);
    });

    it('evicts oldest idle conversation when exceeding MAX_CONVERSATIONS', () => {
      // Create MAX_CONVERSATIONS conversations
      for (let i = 0; i < MAX_CONVERSATIONS; i++) {
        handleChat(`conv-${i}`, `msg ${i}`, '/tmp');
      }

      // Mark all but first as turnActive (first is idle)
      for (let i = 1; i < MAX_CONVERSATIONS; i++) {
        getConversation(`conv-${i}`)!.turnActive = true;
      }
      // Mark first as idle
      getConversation('conv-0')!.turnActive = false;

      // Create one more — should evict conv-0 (oldest idle)
      handleChat('conv-new', 'new msg', '/tmp');

      expect(getConversation('conv-0')).toBeNull();
      expect(getConversation('conv-new')).not.toBeNull();
      expect(getConversations().size).toBe(MAX_CONVERSATIONS);
    });
  });

  describe('different workDirs per conversation', () => {
    it('each conversation has its own workDir', () => {
      handleChat('conv-1', 'hello', '/projects/app1');
      handleChat('conv-2', 'hello', '/projects/app2');

      expect(getConversation('conv-1')?.workDir).toBe('/projects/app1');
      expect(getConversation('conv-2')?.workDir).toBe('/projects/app2');
    });
  });

  describe('re-using same conversationId', () => {
    it('replaces the previous conversation for the same conversationId', () => {
      handleChat('conv-1', 'message 1', '/tmp');
      const firstChild = getConversation('conv-1')?.child;

      // Simulate process exit: clear inputStream
      getConversation('conv-1')!.inputStream = null;

      // Send new message to same conversationId — should spawn a new process
      handleChat('conv-1', 'message 2', '/tmp');
      const secondChild = getConversation('conv-1')?.child;

      // Should be a new child process
      expect(secondChild).not.toBe(firstChild);
    });
  });

  describe('output observer', () => {
    afterEach(() => {
      clearOutputObserver();
    });

    it('observer receives all parsed JSON messages from stdout', async () => {
      const observed: Array<{ convId: string; msg: Record<string, unknown> }> = [];
      setOutputObserver((convId, msg) => {
        observed.push({ convId, msg });
      });

      handleChat('obs-conv', 'hello', '/tmp');
      const child = getConversation('obs-conv')?.child as any;

      // Write JSON lines to mock stdout
      child.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'test-session' }) + '\n');
      child.stdout.write(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }) + '\n');

      // Allow the readline async loop to process
      await new Promise(r => setTimeout(r, 50));

      expect(observed.length).toBe(2);
      expect(observed[0].convId).toBe('obs-conv');
      expect(observed[0].msg.type).toBe('system');
      expect(observed[1].msg.type).toBe('assistant');
    });

    it('observer returning true suppresses the message from normal forwarding', async () => {
      setOutputObserver((_convId, msg) => {
        // Suppress assistant messages
        return msg.type === 'assistant';
      });

      handleChat('obs-suppress', 'hello', '/tmp');
      const child = getConversation('obs-suppress')?.child as any;
      sentMessages = [];

      // Write a system message (not suppressed) and an assistant message (suppressed)
      child.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-1' }) + '\n');
      child.stdout.write(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } }) + '\n');

      await new Promise(r => setTimeout(r, 50));

      // system init produces a session_started message
      const sessionStarted = sentMessages.find(m => m.type === 'session_started');
      expect(sessionStarted).toBeDefined();

      // assistant message should be suppressed — no claude_output with delta
      const claudeOutput = sentMessages.find(m => m.type === 'claude_output');
      expect(claudeOutput).toBeUndefined();
    });

    it('clearOutputObserver removes the observer', async () => {
      const observed: unknown[] = [];
      setOutputObserver((_convId, msg) => {
        observed.push(msg);
      });
      clearOutputObserver();

      handleChat('obs-clear', 'hello', '/tmp');
      const child = getConversation('obs-clear')?.child as any;

      child.stdout.write(JSON.stringify({ type: 'system', subtype: 'init' }) + '\n');
      await new Promise(r => setTimeout(r, 50));

      // Observer was cleared, should not receive any messages
      expect(observed.length).toBe(0);
    });
  });
});
