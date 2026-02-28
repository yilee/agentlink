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

import { spawn, execSync, type ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { Stream } from './stream.js';
import {
  resolveClaudeCommand,
  getCleanEnv,
  streamToStdin,
} from './sdk.js';
import { CONFIG_DIR } from './config.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ClaudeMessage {
  type: string;
  subtype?: string;
  [key: string]: unknown;
}

export interface ChatFile {
  name: string;
  mimeType: string;
  data: string; // base64
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

// ── Control request types ──────────────────────────────────────────────────

interface ControlRequest {
  type: 'control_request';
  request_id: string;
  request: {
    subtype: string;
    tool_name?: string;
    input?: Record<string, unknown>;
  };
}

interface PendingControlRequest {
  request: ControlRequest;
  child: ChildProcess;
}

// ── Module state ───────────────────────────────────────────────────────────

let conversation: ConversationState | null = null;
let sendFn: SendFn = () => {};
const pendingControlRequests = new Map<string, PendingControlRequest>();

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
 * If resumeSessionId is provided, resumes that Claude session.
 */
export function handleChat(prompt: string, workDir: string, resumeSessionId?: string, files?: ChatFile[]): void {
  if (!conversation || !conversation.inputStream) {
    startQuery(workDir, resumeSessionId);
  }

  const state = conversation!;
  state.turnActive = true;
  state.turnResultReceived = false;

  console.log(`[Claude] Sending: ${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}`);

  if (files && files.length > 0) {
    const content = processFilesForClaude(files, workDir, prompt);
    state.inputStream!.enqueue({
      type: 'user',
      message: { role: 'user', content },
    });
  } else {
    state.inputStream!.enqueue({
      type: 'user',
      message: { role: 'user', content: prompt },
    });
  }
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

/**
 * Cancel the current execution (user pressed stop button).
 * Kills the process and notifies the web client.
 */
export function cancelExecution(): void {
  if (!conversation) return;

  console.log('[Claude] Cancelling execution');
  conversation.turnActive = false;

  if (conversation.abortController) {
    conversation.abortController.abort();
  }
  cleanup();

  sendFn({ type: 'execution_cancelled' });
}

/**
 * Handle the user's answer to an AskUserQuestion control request.
 * Writes a control_response back to Claude's stdin.
 */
export function handleUserAnswer(requestId: string, answers: Record<string, unknown>): void {
  const pending = pendingControlRequests.get(requestId);
  if (!pending) {
    console.warn(`[Claude] No pending control request for requestId: ${requestId}`);
    return;
  }

  pendingControlRequests.delete(requestId);
  console.log(`[Claude] Answering AskUserQuestion ${requestId}`);

  const controlResponse = {
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: pending.request.request_id,
      response: {
        behavior: 'allow',
        updatedInput: {
          questions: pending.request.request.input?.questions || [],
          answers,
        },
      },
    },
  };

  if (pending.child.stdin && !pending.child.stdin.destroyed) {
    pending.child.stdin.write(JSON.stringify(controlResponse) + '\n');
  }
}

// ── Internal ───────────────────────────────────────────────────────────────

function processFilesForClaude(files: ChatFile[], workDir: string, prompt: string): unknown[] {
  const attachDir = join(CONFIG_DIR, 'tmp-attachments');
  if (!existsSync(attachDir)) {
    mkdirSync(attachDir, { recursive: true });
  }

  const content: unknown[] = [];
  const nonImagePaths: string[] = [];

  for (const file of files) {
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const diskName = `${timestamp}-${safeName}`;
    const diskPath = join(attachDir, diskName);

    // Write file to disk
    writeFileSync(diskPath, Buffer.from(file.data, 'base64'));
    console.log(`[Claude] Saved attachment: ${diskPath}`);

    if (file.mimeType.startsWith('image/')) {
      // Images: send as inline base64 content blocks
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: file.mimeType,
          data: file.data,
        },
      });
    } else {
      // Non-images: reference by file path
      nonImagePaths.push(diskPath);
    }
  }

  // Build text block with prompt + file references
  let textContent = prompt;
  if (nonImagePaths.length > 0) {
    textContent += '\n\nAttached files:\n' + nonImagePaths.map(p => `- ${p}`).join('\n');
  }
  content.push({ type: 'text', text: textContent });

  return content;
}

function startQuery(workDir: string, resumeSessionId?: string): void {
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
    claudeSessionId: resumeSessionId || null,
    workDir,
    turnActive: false,
    turnResultReceived: false,
  };

  conversation = state;

  // Build args
  // bypassPermissions auto-approves all regular tool calls.
  // --permission-prompt-tool stdio tells Claude CLI to send control_request
  // via stdout for interactive tools (like AskUserQuestion) instead of
  // auto-denying them. Our handleControlRequest() intercepts these and
  // either auto-approves or forwards to the web UI.
  const args = [
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'bypassPermissions',
    '--permission-prompt-tool', 'stdio',
  ];

  if (resumeSessionId) {
    args.push('--resume', resumeSessionId);
    console.log(`[Claude] Resuming session: ${resumeSessionId}`);
  }

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

          // Handle control_request (tool permission checks)
          if (msg.type === 'control_request') {
            handleControlRequest(msg as unknown as ControlRequest, child);
            continue;
          }

          // Handle control_cancel_request (abort pending questions)
          if (msg.type === 'control_cancel_request') {
            const reqId = (msg as unknown as { request_id: string }).request_id;
            if (pendingControlRequests.has(reqId)) {
              console.log(`[Claude] Control request cancelled: ${reqId}`);
              pendingControlRequests.delete(reqId);
            }
            continue;
          }

          // Ignore control_response (responses to our own requests, if any)
          if (msg.type === 'control_response') {
            continue;
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
  // Track accumulated text for streaming delta computation
  let lastSentText = '';

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

        // Reset streaming text tracker
        lastSentText = '';

        // Forward the result, then signal turn_completed
        sendOutput(msg);
        sendFn({ type: 'turn_completed' });
        continue;
      }

      // ── assistant message → extract delta and forward incrementally ──
      if (msg.type === 'assistant' && msg.message) {
        const message = msg.message as { content?: Array<Record<string, unknown>> };
        const content = message.content;
        if (Array.isArray(content)) {
          // Extract full text from all text blocks
          const fullText = content
            .filter((b) => b.type === 'text')
            .map((b) => (b.text as string) || '')
            .join('');

          // Compute delta (new text since last emit)
          if (fullText.length > lastSentText.length) {
            const delta = fullText.slice(lastSentText.length);
            lastSentText = fullText;
            sendFn({
              type: 'claude_output',
              data: { type: 'content_block_delta', delta },
            });
          }

          // Forward tool_use blocks as-is (they appear once)
          // Filter out AskUserQuestion — handled via control_request path
          const toolBlocks = content.filter(
            (b) => b.type === 'tool_use' && b.name !== 'AskUserQuestion'
          );
          if (toolBlocks.length > 0) {
            sendFn({
              type: 'claude_output',
              data: { type: 'tool_use', tools: toolBlocks },
            });
          }
        }
        continue;
      }

      // ── user (tool_result) → forward, reset text tracker ──
      if (msg.type === 'user') {
        // New turn segment — reset delta tracker for next assistant message
        lastSentText = '';

        // Check for command output (e.g. /cost, /context) — extract and send separately
        const message = msg.message as { content?: unknown } | undefined;
        if (message && message.content) {
          const raw = typeof message.content === 'string'
            ? message.content
            : Array.isArray(message.content)
              ? (message.content as Array<{ type: string; text?: string }>)
                  .filter(b => b.type === 'text')
                  .map(b => b.text || '')
                  .join('')
              : '';
          const stdoutMatch = raw.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
          const stderrMatch = raw.match(/<local-command-stderr>([\s\S]*?)<\/local-command-stderr>/);
          const cmdOutput = (stdoutMatch && stdoutMatch[1].trim()) || (stderrMatch && stderrMatch[1].trim());
          if (cmdOutput) {
            sendFn({ type: 'command_output', content: cmdOutput });
            continue;
          }
        }

        sendOutput(msg);
        continue;
      }

      // ── system messages (init, compact, etc.) ──
      if (msg.type === 'system') {
        const sub = (msg.subtype || '') as string;
        console.log(`[Claude] system/${sub}`);

        // Forward context compaction events to web client
        // New format: subtype='status', status='compacting'
        if (sub === 'status' && msg.status === 'compacting') {
          sendFn({ type: 'context_compaction', status: 'started' });
        }
        // Compact boundary = compaction completed
        else if (sub === 'compact_boundary') {
          sendFn({ type: 'context_compaction', status: 'completed' });
        }
        // Legacy subtypes
        else if (sub === 'compact_start') {
          sendFn({ type: 'context_compaction', status: 'started' });
        } else if (sub === 'compact_complete' || sub === 'compact_end') {
          sendFn({ type: 'context_compaction', status: 'completed' });
        }
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

/**
 * Handle an incoming control_request from Claude's stdout.
 * For AskUserQuestion: forward to web UI and wait for user answer.
 * For other tools: auto-approve immediately.
 */
function handleControlRequest(request: ControlRequest, child: ChildProcess): void {
  const requestId = request.request_id;
  const subtype = request.request?.subtype;

  if (subtype === 'can_use_tool' && request.request.tool_name === 'AskUserQuestion') {
    console.log(`[Claude] AskUserQuestion control_request: ${requestId}`);
    pendingControlRequests.set(requestId, { request, child });

    // Forward to web UI
    sendFn({
      type: 'ask_user_question',
      requestId,
      questions: (request.request.input as Record<string, unknown>)?.questions || [],
    });
    return;
  }

  // Auto-approve all other tool calls
  const autoApproveResponse = {
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response: {
        behavior: 'allow',
        updatedInput: request.request.input || {},
      },
    },
  };

  if (child.stdin && !child.stdin.destroyed) {
    child.stdin.write(JSON.stringify(autoApproveResponse) + '\n');
  }
}

function cleanup(): void {
  // Clear any pending control requests
  pendingControlRequests.clear();

  if (conversation) {
    if (conversation.child && !conversation.child.killed) {
      const pid = conversation.child.pid;
      // On Windows with detached processes, kill the entire process tree
      if (pid && process.platform === 'win32') {
        try {
          execSync(`taskkill /pid ${pid} /t /f`, { stdio: 'ignore' });
        } catch { /* process may have already exited */ }
      } else {
        conversation.child.kill();
      }
    }
    if (conversation.inputStream) {
      conversation.inputStream.done();
    }
    conversation = null;
  }
}
