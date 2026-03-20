/**
 * Loop (Scheduled Tasks) scheduler module.
 *
 * Manages Loop CRUD, cron scheduling, execution lifecycle, and output capture.
 * Each Loop is a scheduled prompt sent to Claude on a cron schedule.
 * Executions are persisted as JSONL files for later replay.
 */

import { randomUUID } from 'crypto';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  appendFileSync,
  renameSync,
} from 'fs';
import { join } from 'path';
import cron from 'node-cron';
import { CONFIG_DIR } from './config.js';
import type { ClaudeMessage, HandleChatOptions } from './claude.js';
import type { HistoryMessage } from './history.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface Loop {
  id: string;
  name: string;
  prompt: string;
  schedule: string;                            // cron expression
  scheduleType: 'manual' | 'hourly' | 'daily' | 'weekly' | 'cron';
  scheduleConfig: {
    hour?: number;
    minute?: number;
    dayOfWeek?: number;
  };
  workDir: string;
  enabled: boolean;
  brainMode?: boolean;
  createdAt: string;
  updatedAt: string;
  lastExecution?: LoopExecutionSummary;
}

export interface LoopExecution {
  id: string;
  loopId: string;
  status: 'running' | 'success' | 'error' | 'cancelled';
  trigger: 'scheduled' | 'manual';
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  claudeSessionId?: string;
  conversationId?: string;
  summary?: string;
  error?: string;
}

export type LoopExecutionSummary = Pick<
  LoopExecution,
  'id' | 'status' | 'startedAt' | 'durationMs' | 'trigger'
>;

// ── Constants ─────────────────────────────────────────────────────────────

const LOOPS_FILE = join(CONFIG_DIR, 'loops.json');
const EXECUTIONS_DIR = join(CONFIG_DIR, 'loop-executions');
const MAX_CONCURRENT_LOOPS = 3;

// ── Module state ──────────────────────────────────────────────────────────

let loops: Loop[] = [];
const cronJobs = new Map<string, cron.ScheduledTask>();
const runningExecutions = new Map<string, LoopExecution>();

type SendFn = (msg: Record<string, unknown>) => void;
type HandleChatFn = (
  conversationId: string | undefined,
  prompt: string,
  workDir: string,
  options?: HandleChatOptions,
) => void;
type CancelExecutionFn = (conversationId?: string) => void;
type AddOutputObserverFn = (fn: (conversationId: string, msg: ClaudeMessage) => boolean | void) => void;
type RemoveOutputObserverFn = (fn: (conversationId: string, msg: ClaudeMessage) => boolean | void) => void;
type AddCloseObserverFn = (fn: (conversationId: string, exitCode: number | null, resultReceived: boolean) => void) => void;
type RemoveCloseObserverFn = (fn: (conversationId: string, exitCode: number | null, resultReceived: boolean) => void) => void;

let sendFn: SendFn | null = null;
let handleChatFn: HandleChatFn | null = null;
let cancelExecutionFn: CancelExecutionFn | null = null;
let addOutputObserverFn: AddOutputObserverFn | null = null;
let removeOutputObserverFn: RemoveOutputObserverFn | null = null;
let addCloseObserverFn: AddCloseObserverFn | null = null;
let removeCloseObserverFn: RemoveCloseObserverFn | null = null;

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Initialize the scheduler. Loads loops from disk, reconciles orphaned
 * executions, and starts cron jobs for all enabled loops.
 */
export function initScheduler(deps: {
  send: SendFn;
  handleChat: HandleChatFn;
  cancelExecution: CancelExecutionFn;
  addOutputObserver: AddOutputObserverFn;
  removeOutputObserver: RemoveOutputObserverFn;
  addCloseObserver: AddCloseObserverFn;
  removeCloseObserver: RemoveCloseObserverFn;
}): void {
  sendFn = deps.send;
  handleChatFn = deps.handleChat;
  cancelExecutionFn = deps.cancelExecution;
  addOutputObserverFn = deps.addOutputObserver;
  removeOutputObserverFn = deps.removeOutputObserver;
  addCloseObserverFn = deps.addCloseObserver;
  removeCloseObserverFn = deps.removeCloseObserver;

  loops = loadLoopsFromDisk();
  reconcileOrphanedExecutions();

  // Register output and close observers
  addOutputObserverFn(onLoopOutput);
  addCloseObserverFn(onLoopClose);

  for (const loop of loops) {
    if (loop.enabled && loop.scheduleType !== 'manual') {
      scheduleLoop(loop);
    }
  }

  console.log(`[Scheduler] Initialized with ${loops.length} loops (${cronJobs.size} scheduled)`);
}

/**
 * Shutdown the scheduler. Stops all cron jobs.
 * Running executions are NOT cancelled; they complete naturally.
 */
export function shutdownScheduler(): void {
  for (const [, job] of cronJobs) {
    job.stop();
  }
  cronJobs.clear();

  // Remove observers
  if (removeOutputObserverFn) removeOutputObserverFn(onLoopOutput);
  if (removeCloseObserverFn) removeCloseObserverFn(onLoopClose);

  console.log('[Scheduler] Shutdown complete');
}

// ── CRUD Operations ───────────────────────────────────────────────────────

export function createLoop(config: {
  name: string;
  prompt: string;
  schedule: string;
  scheduleType: Loop['scheduleType'];
  scheduleConfig: Loop['scheduleConfig'];
  workDir: string;
  brainMode?: boolean;
}): Loop {
  // Validate cron expression (skip for manual loops)
  if (config.scheduleType !== 'manual' && !cron.validate(config.schedule)) {
    throw new Error(`Invalid cron expression: ${config.schedule}`);
  }

  const loop: Loop = {
    id: randomUUID(),
    name: config.name,
    prompt: config.prompt,
    schedule: config.schedule,
    scheduleType: config.scheduleType,
    scheduleConfig: config.scheduleConfig,
    workDir: config.workDir,
    enabled: true,
    brainMode: config.brainMode || false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  loops.push(loop);
  saveLoopsToDisk();
  if (config.scheduleType !== 'manual') scheduleLoop(loop);

  console.log(`[Scheduler] Created loop "${loop.name}" (${loop.id.slice(0, 8)}) schedule: ${loop.schedule}`);
  return loop;
}

export function updateLoop(
  loopId: string,
  updates: Partial<Pick<Loop, 'name' | 'prompt' | 'schedule' | 'scheduleType' | 'scheduleConfig' | 'enabled' | 'brainMode'>>,
): Loop | null {
  const loop = loops.find(l => l.id === loopId);
  if (!loop) return null;

  // Validate new cron expression if provided (skip for manual loops)
  const effectiveType = updates.scheduleType ?? loop.scheduleType;
  if (effectiveType !== 'manual' && updates.schedule && !cron.validate(updates.schedule)) {
    throw new Error(`Invalid cron expression: ${updates.schedule}`);
  }

  const scheduleChanged = updates.schedule && updates.schedule !== loop.schedule;
  const enabledChanged = updates.enabled !== undefined && updates.enabled !== loop.enabled;
  const typeChanged = updates.scheduleType !== undefined && updates.scheduleType !== loop.scheduleType;

  Object.assign(loop, updates, { updatedAt: new Date().toISOString() });
  saveLoopsToDisk();

  if (scheduleChanged || enabledChanged || typeChanged) {
    unscheduleLoop(loopId);
    if (loop.enabled && loop.scheduleType !== 'manual') scheduleLoop(loop);
  }

  console.log(`[Scheduler] Updated loop "${loop.name}" (${loop.id.slice(0, 8)})`);
  return loop;
}

export function deleteLoop(loopId: string): boolean {
  const idx = loops.findIndex(l => l.id === loopId);
  if (idx < 0) return false;

  // Cancel if running
  cancelLoopExecution(loopId);
  unscheduleLoop(loopId);
  loops.splice(idx, 1);
  saveLoopsToDisk();

  console.log(`[Scheduler] Deleted loop ${loopId.slice(0, 8)}`);
  return true;
}

export function listLoops(workDir?: string): Loop[] {
  const filtered = workDir ? loops.filter(l => l.workDir === workDir) : loops;
  const result = filtered.map(l => ({ ...l }));
  result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return result;
}

export function getLoop(loopId: string): Loop | null {
  const loop = loops.find(l => l.id === loopId);
  return loop ? { ...loop } : null;
}

export function listLoopExecutions(loopId: string, limit = 50): LoopExecution[] {
  return readExecutionIndex(loopId, limit);
}

export function getLoopExecutionMessages(loopId: string, executionId: string): HistoryMessage[] {
  return readExecutionLog(loopId, executionId);
}

export function runLoopNow(loopId: string): void {
  executeLoop(loopId, 'manual');
}

export function cancelLoopExecution(loopId: string): void {
  for (const [execId, exec] of runningExecutions) {
    if (exec.loopId === loopId && exec.conversationId) {
      if (cancelExecutionFn) {
        cancelExecutionFn(exec.conversationId);
      }
      completeExecution(execId, 'cancelled');
      break;
    }
  }
}

/** Get currently running executions (for status queries). */
export function getRunningExecutions(): Map<string, LoopExecution> {
  return runningExecutions;
}

// ── Scheduling ────────────────────────────────────────────────────────────

function scheduleLoop(loop: Loop): void {
  if (cronJobs.has(loop.id)) {
    cronJobs.get(loop.id)!.stop();
  }

  const job = cron.schedule(loop.schedule, () => {
    console.log(`[Scheduler] Cron fired for loop "${loop.name}" (${loop.id.slice(0, 8)})`);
    executeLoop(loop.id, 'scheduled');
  });

  cronJobs.set(loop.id, job);
  console.log(`[Scheduler] Scheduled loop "${loop.name}" with cron: ${loop.schedule}`);
}

function unscheduleLoop(loopId: string): void {
  const job = cronJobs.get(loopId);
  if (job) {
    job.stop();
    cronJobs.delete(loopId);
  }
}

// ── Execution ─────────────────────────────────────────────────────────────

function executeLoop(loopId: string, trigger: 'scheduled' | 'manual'): void {
  const loop = loops.find(l => l.id === loopId);
  if (!loop) {
    console.warn(`[Scheduler] Cannot execute: loop ${loopId.slice(0, 8)} not found`);
    return;
  }

  // For scheduled triggers, the loop must be enabled
  if (trigger === 'scheduled' && !loop.enabled) {
    return;
  }

  // Check concurrent Loop quota
  if (runningExecutions.size >= MAX_CONCURRENT_LOOPS) {
    console.warn(`[Scheduler] Skipping execution for "${loop.name}": concurrent limit reached (${MAX_CONCURRENT_LOOPS})`);
    return;
  }

  // Prevent overlap: skip if this specific Loop already has a running execution
  for (const exec of runningExecutions.values()) {
    if (exec.loopId === loopId) {
      console.warn(`[Scheduler] Skipping execution for "${loop.name}": already running`);
      return;
    }
  }

  if (!handleChatFn) {
    console.error('[Scheduler] Cannot execute: handleChat not initialized');
    return;
  }

  const executionId = randomUUID();
  const conversationId = `loop-${executionId.slice(0, 8)}`;

  const execution: LoopExecution = {
    id: executionId,
    loopId,
    status: 'running',
    trigger,
    startedAt: new Date().toISOString(),
    conversationId,
  };

  runningExecutions.set(executionId, execution);

  // Ensure execution directory exists
  ensureExecutionDir(loopId);

  // Persist execution metadata
  appendExecutionIndex(loopId, execution);

  // Notify web UI
  sendFn?.({
    type: 'loop_execution_started',
    loopId,
    execution: { ...execution },
  });

  console.log(`[Scheduler] Starting execution ${executionId.slice(0, 8)} for "${loop.name}" (trigger: ${trigger})`);

  // Execute via existing claude.ts handleChat
  try {
    handleChatFn(conversationId, loop.prompt, loop.workDir, { brainMode: loop.brainMode || false });
  } catch (err) {
    console.error(`[Scheduler] Failed to start execution: ${(err as Error).message}`);
    completeExecution(executionId, 'error', (err as Error).message);
  }
}

// ── Output Observer ───────────────────────────────────────────────────────

/**
 * Output observer callback registered with claude.ts.
 * Captures messages from Loop conversations and persists them.
 */
function onLoopOutput(
  conversationId: string,
  msg: ClaudeMessage,
): boolean | void {
  // Only handle loop conversations
  if (!conversationId.startsWith('loop-')) return false;

  const execution = findExecutionByConversationId(conversationId);
  if (!execution) return false;

  // 1. Append raw message to execution JSONL file
  appendToExecutionLog(execution.loopId, execution.id, msg);

  // 2. Forward to web UI with loop context
  sendFn?.({
    type: 'loop_execution_output',
    loopId: execution.loopId,
    executionId: execution.id,
    data: msg,
  });

  // 3. Capture session ID
  if (msg.type === 'system' && msg.session_id) {
    execution.claudeSessionId = msg.session_id as string;
  }

  // 4. Detect completion
  if (msg.type === 'result') {
    const summary = extractSummary(msg);
    const isError = !!msg.is_error || msg.subtype === 'error_response';
    completeExecution(execution.id, isError ? 'error' : 'success', undefined, summary);
  }

  // Don't suppress: let normal forwarding happen too so the web client
  // gets the standard claude_output/turn_completed messages if needed.
  return false;
}

/**
 * Close observer callback. Detects Loop processes that exit without a result.
 */
function onLoopClose(
  conversationId: string,
  _exitCode: number | null,
  resultReceived: boolean,
): void {
  if (!conversationId.startsWith('loop-')) return;
  if (resultReceived) return;

  const execution = findExecutionByConversationId(conversationId);
  if (!execution) return;

  console.log(`[Scheduler] Loop process exited without result for execution ${execution.id.slice(0, 8)}`);
  completeExecution(execution.id, 'error', 'Process exited without completing');
}

// ── Execution Completion ──────────────────────────────────────────────────

function completeExecution(
  executionId: string,
  status: 'success' | 'error' | 'cancelled',
  error?: string,
  summary?: string,
): void {
  const execution = runningExecutions.get(executionId);
  if (!execution) return;

  execution.status = status;
  execution.completedAt = new Date().toISOString();
  execution.durationMs = Date.now() - new Date(execution.startedAt).getTime();
  if (summary) execution.summary = summary;
  if (error) execution.error = error;

  runningExecutions.delete(executionId);

  // Update execution index on disk
  updateExecutionIndex(execution.loopId, execution);

  // Update Loop's lastExecution
  const loop = loops.find(l => l.id === execution.loopId);
  if (loop) {
    loop.lastExecution = {
      id: execution.id,
      status: execution.status,
      startedAt: execution.startedAt,
      durationMs: execution.durationMs,
      trigger: execution.trigger,
    };
    saveLoopsToDisk();
  }

  console.log(`[Scheduler] Execution ${executionId.slice(0, 8)} completed: ${status}${error ? ` (${error})` : ''}`);

  // Notify web UI
  sendFn?.({
    type: 'loop_execution_completed',
    loopId: execution.loopId,
    execution: { ...execution },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────

function findExecutionByConversationId(conversationId: string): LoopExecution | null {
  for (const exec of runningExecutions.values()) {
    if (exec.conversationId === conversationId) return exec;
  }
  return null;
}

function extractSummary(msg: ClaudeMessage): string | undefined {
  if (typeof msg.result === 'string' && msg.result.length > 0) {
    // Truncate summary to first 500 chars
    return msg.result.length > 500
      ? msg.result.slice(0, 497) + '...'
      : msg.result;
  }
  return undefined;
}

// ── Persistence: Loops ────────────────────────────────────────────────────

function loadLoopsFromDisk(): Loop[] {
  try {
    if (!existsSync(LOOPS_FILE)) return [];
    const raw = readFileSync(LOOPS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as Loop[];
  } catch (err) {
    console.error(`[Scheduler] Failed to load loops.json: ${(err as Error).message}`);
    return [];
  }
}

function saveLoopsToDisk(): void {
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
    const tmpFile = LOOPS_FILE + '.tmp';
    writeFileSync(tmpFile, JSON.stringify(loops, null, 2) + '\n', 'utf-8');
    renameSync(tmpFile, LOOPS_FILE);
  } catch (err) {
    console.error(`[Scheduler] Failed to save loops.json: ${(err as Error).message}`);
  }
}

// ── Persistence: Executions ───────────────────────────────────────────────

function ensureExecutionDir(loopId: string): void {
  const dir = join(EXECUTIONS_DIR, loopId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function getExecutionIndexPath(loopId: string): string {
  return join(EXECUTIONS_DIR, loopId, 'index.jsonl');
}

function getExecutionLogPath(loopId: string, executionId: string): string {
  return join(EXECUTIONS_DIR, loopId, `${executionId}.jsonl`);
}

function appendExecutionIndex(loopId: string, execution: LoopExecution): void {
  try {
    ensureExecutionDir(loopId);
    const line = JSON.stringify(execution) + '\n';
    appendFileSync(getExecutionIndexPath(loopId), line, 'utf-8');
  } catch (err) {
    console.error(`[Scheduler] Failed to append execution index: ${(err as Error).message}`);
  }
}

function updateExecutionIndex(loopId: string, execution: LoopExecution): void {
  try {
    const indexPath = getExecutionIndexPath(loopId);
    if (!existsSync(indexPath)) {
      appendExecutionIndex(loopId, execution);
      return;
    }

    const raw = readFileSync(indexPath, 'utf-8');
    const lines = raw.trim().split('\n').filter(l => l.trim());
    const updated: string[] = [];
    let found = false;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as LoopExecution;
        if (entry.id === execution.id) {
          updated.push(JSON.stringify(execution));
          found = true;
        } else {
          updated.push(line);
        }
      } catch {
        updated.push(line); // preserve unparseable lines
      }
    }

    if (!found) {
      updated.push(JSON.stringify(execution));
    }

    writeFileSync(indexPath, updated.join('\n') + '\n', 'utf-8');
  } catch (err) {
    console.error(`[Scheduler] Failed to update execution index: ${(err as Error).message}`);
  }
}

function readExecutionIndex(loopId: string, limit: number): LoopExecution[] {
  try {
    const indexPath = getExecutionIndexPath(loopId);
    if (!existsSync(indexPath)) return [];

    const raw = readFileSync(indexPath, 'utf-8');
    const lines = raw.trim().split('\n').filter(l => l.trim());
    const executions: LoopExecution[] = [];

    for (const line of lines) {
      try {
        executions.push(JSON.parse(line) as LoopExecution);
      } catch {
        // skip unparseable lines
      }
    }

    // Sort by startedAt descending (most recent first) and limit
    executions.sort((a, b) =>
      new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );

    // Merge running status from in-memory state
    for (const exec of executions) {
      const running = runningExecutions.get(exec.id);
      if (running) {
        exec.status = running.status;
        exec.claudeSessionId = running.claudeSessionId;
      }
    }

    return executions.slice(0, limit);
  } catch (err) {
    console.error(`[Scheduler] Failed to read execution index: ${(err as Error).message}`);
    return [];
  }
}

function appendToExecutionLog(loopId: string, executionId: string, msg: ClaudeMessage): void {
  try {
    ensureExecutionDir(loopId);
    const line = JSON.stringify(msg) + '\n';
    appendFileSync(getExecutionLogPath(loopId, executionId), line, 'utf-8');
  } catch (err) {
    console.error(`[Scheduler] Failed to append execution log: ${(err as Error).message}`);
  }
}

function readExecutionLog(loopId: string, executionId: string): HistoryMessage[] {
  try {
    const logPath = getExecutionLogPath(loopId, executionId);
    if (!existsSync(logPath)) return [];

    const raw = readFileSync(logPath, 'utf-8');
    const lines = raw.trim().split('\n').filter(l => l.trim());
    const result: HistoryMessage[] = [];

    for (const line of lines) {
      try {
        const data = JSON.parse(line);
        const ts = data.timestamp || undefined;

        if (data.type === 'user' && data.message?.content) {
          // Extract tool results for tool_result content blocks
          const content = data.message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'tool_result' && block.content) {
                const text = typeof block.content === 'string'
                  ? block.content
                  : JSON.stringify(block.content);
                // Find the matching tool message and add output
                for (let i = result.length - 1; i >= 0; i--) {
                  if (result[i].role === 'tool' && result[i].toolId === block.tool_use_id) {
                    result[i].toolOutput = text;
                    break;
                  }
                }
              }
            }
          } else if (typeof content === 'string' && content.trim()) {
            result.push({ role: 'user', content, timestamp: ts });
          }
        }

        if (data.type === 'assistant' && data.message?.content && Array.isArray(data.message.content)) {
          const textParts: string[] = [];
          const toolBlocks: typeof data.message.content = [];

          for (const block of data.message.content) {
            if (block.type === 'text' && block.text) {
              textParts.push(block.text);
            } else if (block.type === 'tool_use') {
              toolBlocks.push(block);
            }
          }

          if (textParts.length > 0) {
            result.push({ role: 'assistant', content: textParts.join('\n\n'), timestamp: ts });
          }

          for (const tool of toolBlocks) {
            result.push({
              role: 'tool',
              content: '',
              toolName: tool.name,
              toolInput: JSON.stringify(tool.input || {}),
              toolId: tool.id,
              timestamp: ts,
            });
          }
        }
      } catch {
        // skip unparseable lines
      }
    }

    return result;
  } catch (err) {
    console.error(`[Scheduler] Failed to read execution log: ${(err as Error).message}`);
    return [];
  }
}

// ── Orphaned Execution Recovery ───────────────────────────────────────────

function reconcileOrphanedExecutions(): void {
  let orphanCount = 0;

  for (const loop of loops) {
    const executions = readExecutionIndex(loop.id, 100);
    for (const exec of executions) {
      if (exec.status === 'running') {
        exec.status = 'error';
        exec.error = 'Agent restarted during execution';
        exec.completedAt = new Date().toISOString();
        updateExecutionIndex(loop.id, exec);
        orphanCount++;
      }
    }
  }

  if (orphanCount > 0) {
    console.log(`[Scheduler] Reconciled ${orphanCount} orphaned execution(s)`);
  }
}
