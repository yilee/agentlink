/**
 * Claude Code SDK integration.
 *
 * Spawns `claude` as a child process with --output-format stream-json
 * and --input-format stream-json for persistent bidirectional communication.
 *
 * Lifecycle:
 *   1.  Web user sends first message → startQuery() spawns Claude process
 *   2.  Each user message is enqueued into the inputStream
 *   3.  processOutput() iterates Claude stdout, forwarding messages via sendFn
 *   4.  On 'result' message → turn is complete, process stays alive for next turn
 *   5.  On abort / process exit → cleanup
 */

import { spawn, type ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { Stream } from './stream.js';
import {
  resolveClaudeCommand,
  getCleanEnv,
  streamToStdin,
} from './sdk.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ClaudeMessage {
  type: string;
  subtype?: string;
  [key: string]: unknown;
}

export interface ConversationState {
  child: ChildProcess | null;
  inputStream: Stream<ClaudeMessage> | null;
  abortController: AbortController | null;
  claudeSessionId: string | null;
  workDir: string;
  turnActive: boolean;
  turnResultReceived: boolean;
}

type SendFn = (msg: Record<string, unknown>) => void;

// ── Module state ───────────────────────────────────────────────────────────

let conversation: ConversationState | null = null;
let sendFn: SendFn = () => {};

export function setSendFn(fn: SendFn): void {
  sendFn = fn;
}

export function getConversation(): ConversationState | null {
  return conversation;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Handle a chat message from the web client.
 * Lazily starts the Claude process on the first message.
 */
export function handleChat(prompt: string, workDir: string): void {
  if (!conversation || !conversation.inputStream) {
    startQuery(workDir);
  }

  const state = conversation!;
  state.turnActive = true;
  state.turnResultReceived = false;

  console.log(`[Claude] Sending: ${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}`);

  state.inputStream!.enqueue({
    type: 'user',
    message: { role: 'user', content: prompt },
  });
}

/**
 * Abort the current Claude process (e.g. on agent disconnect).
 */
export function abort(): void {
  if (conversation?.abortController) {
    conversation.abortController.abort();
  }
  cleanup();
}

// ── Internal ───────────────────────────────────────────────────────────────

function startQuery(workDir: string): void {
  // Tear down previous process if any
  if (conversation) {
    abort();
  }

  const inputStream = new Stream<ClaudeMessage>();
  const abortController = new AbortController();

  const state: ConversationState = {
    child: null,
    inputStream,
    abortController,
    claudeSessionId: null,
    workDir,
    turnActive: false,
    turnResultReceived: false,
  };

  conversation = state;

  // Build args
  const args = [
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'bypassPermissions',
  ];

  const { command, prefixArgs, spawnOpts } = resolveClaudeCommand();
  const env = getCleanEnv();

  console.log(`[Claude] Spawning: ${command} ${[...prefixArgs, ...args].join(' ')}`);
  console.log(`[Claude] cwd: ${workDir}`);

  const child = spawn(command, [...prefixArgs, ...args], {
    cwd: workDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    signal: abortController.signal,
    env,
    windowsHide: true,
    ...spawnOpts,
  });

  state.child = child;

  // Pipe user messages → stdin
  streamToStdin(inputStream, child.stdin, abortController.signal);

  // Capture stderr for debugging
  let stderrBuf = '';
  child.stderr.on('data', (data: Buffer) => {
    const text = data.toString();
    stderrBuf += text;
    if (process.env.DEBUG) console.error('[Claude stderr]', text);
  });

  // Process stdout (JSON lines)
  processOutput(child, state, stderrBuf);

  // Handle process exit
  child.on('close', (code) => {
    if (code !== 0 && code !== null && !abortController.signal.aborted) {
      const msg = stderrBuf
        ? `Claude process exited with code ${code}: ${stderrBuf.trim()}`
        : `Claude process exited with code ${code}`;
      console.error(`[Claude] ${msg}`);
    }
  });

  child.on('error', (err) => {
    if (!abortController.signal.aborted) {
      console.error(`[Claude] Process error: ${err.message}`);
    }
  });
}

async function processOutput(
  child: ChildProcess,
  state: ConversationState,
  _stderrBuf: string,
): Promise<void> {
  const rl = createInterface({ input: child.stdout! });
  const messageStream = new Stream<ClaudeMessage>();

  // Reader: parse JSON lines from stdout → messageStream
  (async () => {
    try {
      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const msg: ClaudeMessage = JSON.parse(line);

          // Capture session ID from system init
          if (msg.type === 'system' && msg.session_id) {
            state.claudeSessionId = msg.session_id as string;
            console.log(`[Claude] Session ID: ${state.claudeSessionId}`);
          }

          messageStream.enqueue(msg);
        } catch {
          // Non-JSON line, ignore
        }
      }
    } catch (err) {
      messageStream.error(err);
    } finally {
      messageStream.done();
      rl.close();
    }
  })();

  // Consumer: iterate messages and forward to web client
  let resultHandled = false;

  try {
    for await (const msg of messageStream) {
      // ── result → turn complete ──
      if (msg.type === 'result') {
        if (state.turnResultReceived) {
          // Suppress duplicate result (SDK can emit more than one)
          continue;
        }
        state.turnResultReceived = true;
        resultHandled = true;
        state.turnActive = false;

        // Forward the result, then signal turn_completed
        sendOutput(msg);
        sendFn({ type: 'turn_completed' });
        continue;
      }

      // ── assistant message → forward text & tool_use blocks ──
      if (msg.type === 'assistant' && msg.message) {
        sendOutput(msg);
        continue;
      }

      // ── user (tool_result) → forward ──
      if (msg.type === 'user') {
        sendOutput(msg);
        continue;
      }

      // ── system messages (init, compact, etc.) → log only ──
      if (msg.type === 'system') {
        const sub = msg.subtype || '';
        console.log(`[Claude] system/${sub}`);
        continue;
      }
    }
  } catch (err) {
    const error = err as Error;
    if (error.name === 'AbortError') {
      console.log('[Claude] Query aborted');
    } else if (resultHandled) {
      // Ignore post-turn errors
      console.warn(`[Claude] Ignoring post-result error: ${error.message}`);
    } else {
      console.error(`[Claude] Error: ${error.message}`);
      sendFn({
        type: 'error',
        message: `Claude error: ${error.message}`,
      });
    }
  } finally {
    // If the process exited mid-turn without a result, notify web client
    if (!resultHandled && state.turnActive) {
      sendFn({ type: 'turn_completed' });
    }
    state.turnActive = false;

    // Only clean up if this is still the active conversation
    if (conversation === state) {
      state.child = null;
      state.inputStream = null;
    }
  }
}

function sendOutput(data: ClaudeMessage): void {
  sendFn({ type: 'claude_output', data });
}

function cleanup(): void {
  if (conversation) {
    if (conversation.child && !conversation.child.killed) {
      conversation.child.kill();
    }
    if (conversation.inputStream) {
      conversation.inputStream.done();
    }
    conversation = null;
  }
}
