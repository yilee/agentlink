/**
 * Tests for silent turn suppression of task-notification messages.
 *
 * When Claude's background tasks complete, the system injects a <task-notification>
 * user message that triggers a new conversation turn. The agent should suppress
 * all output from these "silent turns" so the web UI doesn't show ghost replies.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  handleChat,
  abortAll,
  getConversation,
  setSendFn,
} from '../../agent/src/claude.js';

// Mock child_process — capture the mock child so we can write to its stdout
let lastMockChild: ReturnType<typeof createMockChild> | null = null;

function createMockChild() {
  const { EventEmitter } = require('events');
  const { PassThrough } = require('stream');
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = Math.floor(Math.random() * 100000);
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    child.emit('exit', 0, null);
    child.stdout.end();
  });
  return child;
}

vi.mock('child_process', () => ({
  spawn: () => {
    lastMockChild = createMockChild();
    return lastMockChild;
  },
  execSync: vi.fn(),
}));

vi.mock('../../agent/src/sdk.js', () => ({
  resolveClaudeCommand: () => ({ command: 'claude', prefixArgs: [], spawnOpts: {} }),
  getCleanEnv: () => ({ ...process.env }),
  streamToStdin: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../agent/src/config.js', () => ({
  CONFIG_DIR: '/tmp/agentlink-test',
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

/** Write a JSON line to the mock child's stdout (simulating Claude output). */
function emitMessage(child: ReturnType<typeof createMockChild>, msg: Record<string, unknown>) {
  child.stdout.write(JSON.stringify(msg) + '\n');
}

/**
 * Small delay to let the async consumer loop process messages.
 * The consumer loop reads from a readline interface on stdout,
 * so we need to yield the event loop for processing.
 */
function tick(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('claude.ts silent turn (task-notification suppression)', () => {
  let sentMessages: Record<string, unknown>[];

  beforeEach(() => {
    abortAll();
    lastMockChild = null;
    sentMessages = [];
    setSendFn((msg) => sentMessages.push(msg));
  });

  afterEach(() => {
    abortAll();
  });

  it('suppresses assistant output for task-notification turns', async () => {
    // Start a conversation — spawns mock Claude process
    handleChat('conv-silent-1', 'hello', '/tmp');
    await tick();
    const child = lastMockChild!;
    expect(child).not.toBeNull();

    // Simulate: Claude responds to the initial user message normally
    emitMessage(child, {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello! How can I help?' }] },
    });
    emitMessage(child, {
      type: 'result',
      subtype: 'success',
    });
    await tick();

    // Verify the normal turn produced output
    const normalOutput = sentMessages.filter(
      (m) => m.type === 'claude_output' || m.type === 'turn_completed'
    );
    expect(normalOutput.length).toBeGreaterThan(0);

    // Clear sent messages for the silent turn test
    sentMessages.length = 0;

    // Reset turnResultReceived so processOutput can handle the next result
    const conv = getConversation('conv-silent-1')!;
    conv.turnResultReceived = false;

    // Simulate: system injects a task-notification user message
    emitMessage(child, {
      type: 'user',
      message: {
        content: '<task-notification>Background task completed: agent process exited with code 0\n\nOutput:\nStarted successfully</task-notification>',
      },
    });
    await tick();

    // Simulate: Claude responds to the task-notification
    emitMessage(child, {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'The background task has completed successfully.' }] },
    });
    await tick();

    // Simulate: turn completes
    emitMessage(child, {
      type: 'result',
      subtype: 'success',
    });
    await tick();

    // Verify: NO claude_output or turn_completed was sent during the silent turn
    const silentOutput = sentMessages.filter(
      (m) => m.type === 'claude_output' || m.type === 'turn_completed'
    );
    expect(silentOutput).toEqual([]);
  });

  it('resumes normal forwarding after a silent turn completes', async () => {
    handleChat('conv-silent-2', 'hello', '/tmp');
    await tick();
    const child = lastMockChild!;

    // First turn: normal response
    emitMessage(child, {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hi' }] },
    });
    emitMessage(child, { type: 'result', subtype: 'success' });
    await tick();
    sentMessages.length = 0;

    const conv = getConversation('conv-silent-2')!;
    conv.turnResultReceived = false;

    // Second turn: task-notification (silent)
    emitMessage(child, {
      type: 'user',
      message: { content: '<task-notification>done</task-notification>' },
    });
    emitMessage(child, {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Ghost reply' }] },
    });
    emitMessage(child, { type: 'result', subtype: 'success' });
    await tick();

    // Verify silent turn produced no output
    expect(sentMessages.filter((m) => m.type === 'claude_output')).toEqual([]);
    sentMessages.length = 0;
    conv.turnResultReceived = false;

    // Third turn: normal user message — should work normally
    emitMessage(child, {
      type: 'user',
      message: { content: [{ type: 'tool_result', content: 'file contents here' }] },
    });
    await tick();

    emitMessage(child, {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'I can see the file.' }] },
    });
    await tick();

    // This turn should produce output normally
    const output = sentMessages.filter((m) => m.type === 'claude_output');
    expect(output.length).toBeGreaterThan(0);
  });

  it('suppresses tool_result messages during a silent turn', async () => {
    handleChat('conv-silent-3', 'hello', '/tmp');
    await tick();
    const child = lastMockChild!;

    // Normal first turn
    emitMessage(child, {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hi' }] },
    });
    emitMessage(child, { type: 'result', subtype: 'success' });
    await tick();
    sentMessages.length = 0;

    const conv = getConversation('conv-silent-3')!;
    conv.turnResultReceived = false;

    // Silent turn: task-notification → assistant uses tools → tool_result → result
    emitMessage(child, {
      type: 'user',
      message: { content: '<task-notification>task done</task-notification>' },
    });
    emitMessage(child, {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Let me check.' },
          { type: 'tool_use', id: 't1', name: 'Read', input: { path: '/tmp/log' } },
        ],
      },
    });
    // Tool result from Claude's tool execution
    emitMessage(child, {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'log output' }] },
    });
    emitMessage(child, {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Everything looks fine.' }] },
    });
    emitMessage(child, { type: 'result', subtype: 'success' });
    await tick();

    // All output during the silent turn should be suppressed
    const output = sentMessages.filter(
      (m) => m.type === 'claude_output' || m.type === 'turn_completed'
    );
    expect(output).toEqual([]);
  });
});
