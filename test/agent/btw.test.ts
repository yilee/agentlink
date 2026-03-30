/**
 * Tests for the /btw side question feature.
 *
 * Covers:
 * - handleBtwQuestion: inline context prompt, fallback prompt, spawn + streaming, error handling
 * - readConversationContext() integration for building composed prompts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockSpawn = vi.fn();
const mockReadConversationContext = vi.fn();

vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
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

vi.mock('../../agent/src/history.js', () => ({
  readConversationContext: (...args: unknown[]) => mockReadConversationContext(...args),
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

/** Helper to complete a btw child process */
async function completeBtwChild(btwChild: ReturnType<typeof createMockChild>): Promise<void> {
  await new Promise(r => setTimeout(r, 10));
  btwChild.stdout.write(JSON.stringify({ type: 'result', result: '' }) + '\n');
  btwChild.stdout.end();
}

/** Read stdin content from a mock child (call after writes have been flushed) */
async function getStdinContent(child: ReturnType<typeof createMockChild>): Promise<string> {
  // Small delay to let writes flush through the PassThrough
  await new Promise(r => setTimeout(r, 5));
  const chunks: string[] = [];
  // Read all buffered data from the PassThrough
  let chunk: Buffer | null;
  while ((chunk = child.stdin.read()) !== null) {
    chunks.push(chunk.toString());
  }
  return chunks.join('');
}

describe('handleBtwQuestion', () => {
  let sentMessages: Record<string, unknown>[];

  beforeEach(() => {
    abortAll();
    sentMessages = [];
    setSendFn((msg) => sentMessages.push(msg));
    mockSpawn.mockReset();
    mockReadConversationContext.mockReset();
    // Default: no context available
    mockReadConversationContext.mockReturnValue(null);
  });

  afterEach(() => {
    abortAll();
  });

  // ── No session ID — fallback prompt ────────────────────────────────────

  it('spawns with fallback prompt when no conversation exists and no fallback', async () => {
    const btwChild = createMockChild();
    mockSpawn.mockReturnValueOnce(btwChild);

    const send = vi.fn();
    const promise = handleBtwQuestion('what is this?', 'nonexistent-conv', '/tmp', send);
    const stdinContent = await getStdinContent(btwChild);
    await completeBtwChild(btwChild);
    await promise;

    // Should still spawn (not hard-fail)
    expect(mockSpawn).toHaveBeenCalled();
    // -p receives '-' (stdin marker), actual prompt piped via stdin
    const args: string[] = mockSpawn.mock.calls[0][1];
    expect(args).toContain('-p');
    expect(args[args.indexOf('-p') + 1]).toBe('-');
    expect(stdinContent).toContain('Question: what is this?');
    expect(stdinContent).toContain('text answer only');
    // readConversationContext should NOT have been called (no sessionId)
    expect(mockReadConversationContext).not.toHaveBeenCalled();
  });

  it('spawns with fallback prompt when conversation has no session ID', async () => {
    // Create a conversation via handleChat (which will spawn a mock child)
    const mockChild = createMockChild();
    mockSpawn.mockReturnValue(mockChild);
    handleChat('conv-btw-1', 'hello', '/tmp');

    // The conversation exists but claudeSessionId starts null
    const conv = getConversation('conv-btw-1');
    expect(conv).not.toBeNull();
    expect(conv!.claudeSessionId).toBeNull();

    const btwChild = createMockChild();
    mockSpawn.mockReturnValueOnce(btwChild);

    const send = vi.fn();
    const promise = handleBtwQuestion('what is this?', 'conv-btw-1', '/tmp', send);
    const stdinContent = await getStdinContent(btwChild);
    await completeBtwChild(btwChild);
    await promise;

    expect(stdinContent).toContain('Question: what is this?');
    expect(stdinContent).not.toContain('conversation-context');
  });

  // ── Composed prompt with context ───────────────────────────────────────

  it('includes conversation context in composed prompt when available', async () => {
    const mainChild = createMockChild();
    mockSpawn.mockReturnValueOnce(mainChild);
    handleChat('conv-btw-ctx', 'hello', '/tmp');
    const conv = getConversation('conv-btw-ctx');
    conv!.claudeSessionId = 'session-with-ctx';

    mockReadConversationContext.mockReturnValue('[User]\nWhat is X?\n\n[Assistant]\nX is 42.');

    const btwChild = createMockChild();
    mockSpawn.mockReturnValueOnce(btwChild);

    const send = vi.fn();
    const promise = handleBtwQuestion('explain more', 'conv-btw-ctx', '/tmp', send);
    const stdinContent = await getStdinContent(btwChild);
    await completeBtwChild(btwChild);
    await promise;

    // Verify composed prompt structure (piped via stdin)
    expect(stdinContent).toContain('side question');
    expect(stdinContent).toContain('Do NOT call any tools');
    expect(stdinContent).toContain('<conversation-context>');
    expect(stdinContent).toContain('[User]\nWhat is X?');
    expect(stdinContent).toContain('[Assistant]\nX is 42.');
    expect(stdinContent).toContain('</conversation-context>');
    expect(stdinContent).toContain('Side question: explain more');
  });

  it('uses fallback prompt when readConversationContext returns null', async () => {
    const mainChild = createMockChild();
    mockSpawn.mockReturnValueOnce(mainChild);
    handleChat('conv-btw-null', 'hello', '/tmp');
    const conv = getConversation('conv-btw-null');
    conv!.claudeSessionId = 'session-null-ctx';

    mockReadConversationContext.mockReturnValue(null);

    const btwChild = createMockChild();
    mockSpawn.mockReturnValueOnce(btwChild);

    const send = vi.fn();
    const promise = handleBtwQuestion('general question', 'conv-btw-null', '/tmp', send);
    const stdinContent = await getStdinContent(btwChild);
    await completeBtwChild(btwChild);
    await promise;

    expect(stdinContent).toContain('Question: general question');
    expect(stdinContent).toContain('text answer only');
    expect(stdinContent).not.toContain('conversation-context');
  });

  it('uses fallback prompt when readConversationContext throws', async () => {
    const mainChild = createMockChild();
    mockSpawn.mockReturnValueOnce(mainChild);
    handleChat('conv-btw-err-ctx', 'hello', '/tmp');
    const conv = getConversation('conv-btw-err-ctx');
    conv!.claudeSessionId = 'session-err-ctx';

    mockReadConversationContext.mockImplementation(() => { throw new Error('JSONL parse error'); });

    const btwChild = createMockChild();
    mockSpawn.mockReturnValueOnce(btwChild);

    const send = vi.fn();
    const promise = handleBtwQuestion('question', 'conv-btw-err-ctx', '/tmp', send);
    const stdinContent = await getStdinContent(btwChild);
    await completeBtwChild(btwChild);
    await promise;

    // Should still spawn with fallback prompt (not crash)
    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(stdinContent).toContain('Question: question');
    expect(stdinContent).not.toContain('conversation-context');
  });

  // ── Spawn args verification ────────────────────────────────────────────

  it('uses -p - (stdin piping) with --verbose, no --resume', async () => {
    const mainChild = createMockChild();
    mockSpawn.mockReturnValueOnce(mainChild);
    handleChat('conv-btw-args', 'hello', '/tmp');
    const conv = getConversation('conv-btw-args');
    conv!.claudeSessionId = 'session-xyz-789';

    mockReadConversationContext.mockReturnValue('[User]\nHello');

    const btwChild = createMockChild();
    mockSpawn.mockReturnValueOnce(btwChild);

    const send = vi.fn();
    const promise = handleBtwQuestion('test question', 'conv-btw-args', '/tmp', send);
    const stdinContent = await getStdinContent(btwChild);
    await completeBtwChild(btwChild);
    await promise;

    const spawnCall = mockSpawn.mock.calls[1];
    const args: string[] = spawnCall[1];

    // Should have -p with '-' (stdin marker)
    expect(args).toContain('-p');
    const pIndex = args.indexOf('-p');
    expect(args[pIndex + 1]).toBe('-');
    expect(args).toContain('--no-session-persistence');
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');

    // Should NOT have --resume
    expect(args).not.toContain('--resume');
    // --verbose IS required for -p + stream-json
    expect(args).toContain('--verbose');

    // Prompt content should be piped via stdin
    expect(stdinContent).toContain('Side question: test question');
  });

  // ── Session ID lookup priority ─────────────────────────────────────────

  it('passes claudeSessionId to readConversationContext', async () => {
    const mainChild = createMockChild();
    mockSpawn.mockReturnValueOnce(mainChild);
    handleChat('conv-btw-sid', 'hello', '/tmp');
    const conv = getConversation('conv-btw-sid');
    conv!.claudeSessionId = 'primary-session-123';

    const btwChild = createMockChild();
    mockSpawn.mockReturnValueOnce(btwChild);

    const send = vi.fn();
    const promise = handleBtwQuestion('question', 'conv-btw-sid', '/tmp', send);
    await completeBtwChild(btwChild);
    await promise;

    expect(mockReadConversationContext).toHaveBeenCalledWith('/tmp', 'primary-session-123');
  });

  it('uses lastClaudeSessionId for context when claudeSessionId is null', async () => {
    const mainChild = createMockChild();
    mockSpawn.mockReturnValueOnce(mainChild);
    handleChat('conv-btw-last', 'hello', '/tmp');
    const conv = getConversation('conv-btw-last');
    conv!.claudeSessionId = null;
    conv!.lastClaudeSessionId = 'last-session-456';

    const btwChild = createMockChild();
    mockSpawn.mockReturnValueOnce(btwChild);

    const send = vi.fn();
    const promise = handleBtwQuestion('question', 'conv-btw-last', '/tmp', send);
    await completeBtwChild(btwChild);
    await promise;

    expect(mockReadConversationContext).toHaveBeenCalledWith('/tmp', 'last-session-456');
  });

  it('uses fallbackClaudeSessionId for context when conversation is not in map', async () => {
    const btwChild = createMockChild();
    mockSpawn.mockReturnValueOnce(btwChild);

    const send = vi.fn();
    const promise = handleBtwQuestion('question', 'nonexistent-conv', '/tmp', send, 'fallback-session-999');
    await completeBtwChild(btwChild);
    await promise;

    expect(mockReadConversationContext).toHaveBeenCalledWith('/tmp', 'fallback-session-999');
  });

  // ── Successful streaming ─────────────────────────────────────────────

  it('spawns claude and streams btw_answer deltas from assistant messages', async () => {
    const mainChild = createMockChild();
    mockSpawn.mockReturnValueOnce(mainChild);
    handleChat('conv-btw-2', 'hello', '/tmp');
    const conv = getConversation('conv-btw-2');
    conv!.claudeSessionId = 'session-abc-123';

    const btwChild = createMockChild();
    mockSpawn.mockReturnValueOnce(btwChild);

    const send = vi.fn();
    const promise = handleBtwQuestion('what is x?', 'conv-btw-2', '/tmp', send);

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

    btwChild.stdout.end();
    await promise;

    const btwAnswers = send.mock.calls.map(c => c[0]).filter(
      (m: Record<string, unknown>) => m.type === 'btw_answer',
    );

    expect(btwAnswers.length).toBeGreaterThanOrEqual(3);
    expect(btwAnswers[0]).toEqual({ type: 'btw_answer', delta: 'X is a variable', done: false });
    expect(btwAnswers[1]).toEqual({ type: 'btw_answer', delta: ' that holds the value 42.', done: false });
    expect(btwAnswers[btwAnswers.length - 1]).toMatchObject({ type: 'btw_answer', done: true });
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

    btwChild.stdout.write(JSON.stringify({
      type: 'result',
      result: 'Full answer text here',
    }) + '\n');
    btwChild.stdout.end();

    await promise;

    const lastCall = send.mock.calls[send.mock.calls.length - 1][0] as Record<string, unknown>;
    expect(lastCall.type).toBe('btw_answer');
    expect(lastCall.done).toBe(true);
    expect(lastCall.delta).toBe('Full answer text here');
  });

  // ── Closes stdin immediately ─────────────────────────────────────────

  it('writes prompt to stdin and closes it (stdin piping)', async () => {
    const mainChild = createMockChild();
    mockSpawn.mockReturnValueOnce(mainChild);
    handleChat('conv-btw-7', 'hello', '/tmp');
    const conv = getConversation('conv-btw-7');
    conv!.claudeSessionId = 'session-stdin';

    const btwChild = createMockChild();
    const stdinWriteSpy = vi.spyOn(btwChild.stdin, 'write');
    const stdinEndSpy = vi.spyOn(btwChild.stdin, 'end');
    mockSpawn.mockReturnValueOnce(btwChild);

    const send = vi.fn();
    const promise = handleBtwQuestion('question', 'conv-btw-7', '/tmp', send);
    await completeBtwChild(btwChild);
    await promise;

    // Prompt should be written to stdin then closed
    expect(stdinWriteSpy).toHaveBeenCalled();
    expect(stdinEndSpy).toHaveBeenCalled();
  });
});
