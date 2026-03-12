/**
 * Tests for the /btw side question feature.
 *
 * Covers:
 * - handleBtwQuestion: no-session fallback, spawn + streaming, error handling
 * - Connection handler routing for btw_question message type
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockSpawn = vi.fn();

vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
  execSync: vi.fn(),
}));

vi.mock('../../agent/src/sdk.js', () => ({
  resolveClaudeCommand: () => ({ command: 'claude', prefixArgs: [], spawnOpts: {} }),
  getCleanEnv: () => ({ ...process.env }),
  streamToStdin: vi.fn(),
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

import {
  handleBtwQuestion,
  handleChat,
  getConversation,
  setSendFn,
  abortAll,
} from '../../agent/src/claude.js';

// ── Helpers ───────────────────────────────────────────────────────────────

function createMockChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    pid: number;
    killed: boolean;
    kill: ReturnType<typeof vi.fn>;
    exitCode: number | null;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = Math.floor(Math.random() * 100000);
  child.killed = false;
  child.kill = vi.fn(() => { child.killed = true; });
  child.exitCode = null;
  return child;
}

describe('handleBtwQuestion', () => {
  let sentMessages: Record<string, unknown>[];

  beforeEach(() => {
    abortAll();
    sentMessages = [];
    setSendFn((msg) => sentMessages.push(msg));
    mockSpawn.mockReset();
  });

  afterEach(() => {
    abortAll();
  });

  // ── No session ID available ──────────────────────────────────────────

  it('sends immediate done reply when no conversation exists and no fallback', async () => {
    const send = vi.fn();
    await handleBtwQuestion('what is this?', 'nonexistent-conv', '/tmp', send);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      type: 'btw_answer',
      delta: 'No active conversation context available.',
      done: true,
    });
  });

  it('sends immediate done reply when conversation has no session ID', async () => {
    // Create a conversation via handleChat (which will spawn a mock child)
    const mockChild = createMockChild();
    mockSpawn.mockReturnValue(mockChild);
    handleChat('conv-btw-1', 'hello', '/tmp');

    // The conversation exists but claudeSessionId starts null until system message
    const conv = getConversation('conv-btw-1');
    expect(conv).not.toBeNull();
    expect(conv!.claudeSessionId).toBeNull();

    const send = vi.fn();
    await handleBtwQuestion('what is this?', 'conv-btw-1', '/tmp', send);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      type: 'btw_answer',
      delta: 'No active conversation context available.',
      done: true,
    });
  });

  // ── Successful streaming ─────────────────────────────────────────────

  it('spawns claude and streams btw_answer deltas from assistant messages', async () => {
    // Set up a conversation with a known session ID
    const mainChild = createMockChild();
    mockSpawn.mockReturnValueOnce(mainChild);
    handleChat('conv-btw-2', 'hello', '/tmp');
    const conv = getConversation('conv-btw-2');
    conv!.claudeSessionId = 'session-abc-123';

    // Set up the btw child that will be spawned
    const btwChild = createMockChild();
    mockSpawn.mockReturnValueOnce(btwChild);

    const send = vi.fn();
    const promise = handleBtwQuestion('what is x?', 'conv-btw-2', '/tmp', send);

    // Simulate Claude streaming output
    await new Promise(r => setTimeout(r, 10));

    btwChild.stdout.write(JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'X is a variable' }] },
    }) + '\n');

    await new Promise(r => setTimeout(r, 10));

    btwChild.stdout.write(JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'X is a variable that holds the value 42.' }] },
    }) + '\n');

    await new Promise(r => setTimeout(r, 10));

    btwChild.stdout.write(JSON.stringify({
      type: 'result',
      result: '',
    }) + '\n');

    // Close stdout to end the readline loop
    btwChild.stdout.end();

    await promise;

    // Verify delta streaming
    const btwAnswers = send.mock.calls.map(c => c[0]).filter(
      (m: Record<string, unknown>) => m.type === 'btw_answer',
    );

    expect(btwAnswers.length).toBeGreaterThanOrEqual(3);
    // First delta
    expect(btwAnswers[0]).toEqual({
      type: 'btw_answer',
      delta: 'X is a variable',
      done: false,
    });
    // Second delta (incremental)
    expect(btwAnswers[1]).toEqual({
      type: 'btw_answer',
      delta: ' that holds the value 42.',
      done: false,
    });
    // Final done
    expect(btwAnswers[btwAnswers.length - 1]).toMatchObject({
      type: 'btw_answer',
      done: true,
    });
  });

  it('uses --resume with session ID and --no-session-persistence', async () => {
    const mainChild = createMockChild();
    mockSpawn.mockReturnValueOnce(mainChild);
    handleChat('conv-btw-3', 'hello', '/tmp');
    const conv = getConversation('conv-btw-3');
    conv!.claudeSessionId = 'session-xyz-789';

    const btwChild = createMockChild();
    mockSpawn.mockReturnValueOnce(btwChild);

    const send = vi.fn();
    const promise = handleBtwQuestion('test question', 'conv-btw-3', '/tmp', send);

    // Send result and end stdout to let the function complete
    await new Promise(r => setTimeout(r, 10));
    btwChild.stdout.write(JSON.stringify({ type: 'result', result: '' }) + '\n');
    btwChild.stdout.end();
    await promise;

    // Verify spawn was called with correct args
    const spawnCall = mockSpawn.mock.calls[1]; // second call is the btw spawn
    expect(spawnCall).toBeDefined();
    const args: string[] = spawnCall[1];
    expect(args).toContain('-p');
    expect(args).toContain('test question');
    expect(args).toContain('--resume');
    expect(args).toContain('session-xyz-789');
    expect(args).toContain('--no-session-persistence');
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--verbose');
  });

  it('uses lastClaudeSessionId when claudeSessionId is null', async () => {
    const mainChild = createMockChild();
    mockSpawn.mockReturnValueOnce(mainChild);
    handleChat('conv-btw-4', 'hello', '/tmp');
    const conv = getConversation('conv-btw-4');
    conv!.claudeSessionId = null;
    conv!.lastClaudeSessionId = 'last-session-456';

    const btwChild = createMockChild();
    mockSpawn.mockReturnValueOnce(btwChild);

    const send = vi.fn();
    const promise = handleBtwQuestion('question', 'conv-btw-4', '/tmp', send);

    await new Promise(r => setTimeout(r, 10));
    btwChild.stdout.write(JSON.stringify({ type: 'result', result: '' }) + '\n');
    btwChild.stdout.end();
    await promise;

    const spawnCall = mockSpawn.mock.calls[1];
    const args: string[] = spawnCall[1];
    expect(args).toContain('--resume');
    expect(args).toContain('last-session-456');
  });

  it('uses fallbackClaudeSessionId when conversation is not in map', async () => {
    // No conversation exists for this ID — simulates resumed history session
    const btwChild = createMockChild();
    mockSpawn.mockReturnValueOnce(btwChild);

    const send = vi.fn();
    const promise = handleBtwQuestion('question', 'nonexistent-conv', '/tmp', send, 'fallback-session-999');

    await new Promise(r => setTimeout(r, 10));
    btwChild.stdout.write(JSON.stringify({ type: 'result', result: '' }) + '\n');
    btwChild.stdout.end();
    await promise;

    // Should have spawned with the fallback session ID
    const spawnCall = mockSpawn.mock.calls[0];
    const args: string[] = spawnCall[1];
    expect(args).toContain('--resume');
    expect(args).toContain('fallback-session-999');
  });

  // ── Error handling ───────────────────────────────────────────────────

  it('sends error message when process exits without output', async () => {
    const mainChild = createMockChild();
    mockSpawn.mockReturnValueOnce(mainChild);
    handleChat('conv-btw-5', 'hello', '/tmp');
    const conv = getConversation('conv-btw-5');
    conv!.claudeSessionId = 'session-err';

    const btwChild = createMockChild();
    mockSpawn.mockReturnValueOnce(btwChild);

    const send = vi.fn();
    const promise = handleBtwQuestion('question', 'conv-btw-5', '/tmp', send);

    // Write stderr then close stdout without any JSON output
    await new Promise(r => setTimeout(r, 10));
    btwChild.stderr.emit('data', Buffer.from('Some error occurred'));
    btwChild.stdout.end();

    await promise;

    const last = send.mock.calls[send.mock.calls.length - 1][0] as Record<string, unknown>;
    expect(last.type).toBe('btw_answer');
    expect(last.done).toBe(true);
    expect(typeof last.delta).toBe('string');
    expect((last.delta as string).length).toBeGreaterThan(0);
  });

  it('sends done even if result message has remaining text', async () => {
    const mainChild = createMockChild();
    mockSpawn.mockReturnValueOnce(mainChild);
    handleChat('conv-btw-6', 'hello', '/tmp');
    const conv = getConversation('conv-btw-6');
    conv!.claudeSessionId = 'session-result-text';

    const btwChild = createMockChild();
    mockSpawn.mockReturnValueOnce(btwChild);

    const send = vi.fn();
    const promise = handleBtwQuestion('question', 'conv-btw-6', '/tmp', send);

    await new Promise(r => setTimeout(r, 10));

    // Result message with text that extends beyond what assistant messages sent
    btwChild.stdout.write(JSON.stringify({
      type: 'result',
      result: 'Full answer text here',
    }) + '\n');
    btwChild.stdout.end();

    await promise;

    const lastCall = send.mock.calls[send.mock.calls.length - 1][0] as Record<string, unknown>;
    expect(lastCall.type).toBe('btw_answer');
    expect(lastCall.done).toBe(true);
    // The result text should appear as delta since no assistant messages were sent
    expect(lastCall.delta).toBe('Full answer text here');
  });

  // ── Closes stdin immediately ─────────────────────────────────────────

  it('closes stdin immediately since it is a one-shot query', async () => {
    const mainChild = createMockChild();
    mockSpawn.mockReturnValueOnce(mainChild);
    handleChat('conv-btw-7', 'hello', '/tmp');
    const conv = getConversation('conv-btw-7');
    conv!.claudeSessionId = 'session-stdin';

    const btwChild = createMockChild();
    const stdinEndSpy = vi.spyOn(btwChild.stdin, 'end');
    mockSpawn.mockReturnValueOnce(btwChild);

    const send = vi.fn();
    const promise = handleBtwQuestion('question', 'conv-btw-7', '/tmp', send);

    await new Promise(r => setTimeout(r, 10));
    btwChild.stdout.write(JSON.stringify({ type: 'result', result: '' }) + '\n');
    btwChild.stdout.end();

    await promise;

    expect(stdinEndSpy).toHaveBeenCalled();
  });
});
