// ── Loop (Scheduled Tasks) message handlers extracted from connection.ts ──
import {
  createLoop,
  updateLoop,
  deleteLoop,
  listLoops,
  getLoop,
  runLoopNow,
  cancelLoopExecution,
  listLoopExecutions,
  getLoopExecutionMessages,
  getRunningExecutions,
} from './scheduler.js';

type SendFn = (msg: Record<string, unknown>) => void;

export function handleCreateLoop(
  msg: {
    name: string;
    prompt: string;
    schedule: string;
    scheduleType: 'hourly' | 'daily' | 'weekly' | 'cron';
    scheduleConfig: { hour?: number; minute?: number; dayOfWeek?: number };
    brainMode?: boolean;
  },
  workDir: string,
  send: SendFn,
): void {
  try {
    const loop = createLoop({
      name: msg.name,
      prompt: msg.prompt,
      schedule: msg.schedule,
      scheduleType: msg.scheduleType,
      scheduleConfig: msg.scheduleConfig,
      workDir,
      brainMode: msg.brainMode,
    });
    send({ type: 'loop_created', loop });
  } catch (err) {
    send({ type: 'error', message: (err as Error).message });
  }
}

export function handleUpdateLoop(
  msg: {
    loopId: string;
    updates: Partial<{
      name: string;
      prompt: string;
      schedule: string;
      scheduleType: 'hourly' | 'daily' | 'weekly' | 'cron';
      scheduleConfig: { hour?: number; minute?: number; dayOfWeek?: number };
      enabled: boolean;
      brainMode: boolean;
    }>;
  },
  send: SendFn,
): void {
  try {
    const loop = updateLoop(msg.loopId, msg.updates);
    if (loop) {
      send({ type: 'loop_updated', loop });
    } else {
      send({ type: 'error', message: `Loop not found: ${msg.loopId}` });
    }
  } catch (err) {
    send({ type: 'error', message: (err as Error).message });
  }
}

export function handleDeleteLoop(
  msg: { loopId: string },
  send: SendFn,
): void {
  const deleted = deleteLoop(msg.loopId);
  if (deleted) {
    send({ type: 'loop_deleted', loopId: msg.loopId });
  } else {
    send({ type: 'error', message: 'Loop not found or could not be deleted.' });
  }
}

export function handleListLoops(workDir: string, send: SendFn): void {
  send({ type: 'loops_list', loops: listLoops(workDir) });
}

export function handleGetLoop(
  msg: { loopId: string },
  send: SendFn,
): void {
  const loop = getLoop(msg.loopId);
  if (loop) {
    send({ type: 'loop_detail', loop });
  } else {
    send({ type: 'error', message: `Loop not found: ${msg.loopId}` });
  }
}

export function handleRunLoop(
  msg: { loopId: string },
  send: SendFn,
): void {
  try {
    runLoopNow(msg.loopId);
  } catch (err) {
    send({ type: 'error', message: (err as Error).message });
  }
}

export function handleCancelLoopExecution(
  msg: { loopId: string },
): void {
  cancelLoopExecution(msg.loopId);
}

export function handleListLoopExecutions(
  msg: { loopId: string; limit?: number },
  send: SendFn,
): void {
  const executions = listLoopExecutions(msg.loopId, msg.limit);
  send({ type: 'loop_executions_list', loopId: msg.loopId, executions });
}

export function handleGetLoopExecutionMessages(
  msg: { loopId: string; executionId: string },
  send: SendFn,
): void {
  const messages = getLoopExecutionMessages(msg.loopId, msg.executionId);
  send({ type: 'loop_execution_messages', loopId: msg.loopId, executionId: msg.executionId, messages });
}

export function handleQueryLoopStatus(send: SendFn): void {
  const running: Array<{ executionId: string; loopId: string; conversationId?: string }> = [];
  for (const [execId, exec] of getRunningExecutions()) {
    running.push({ executionId: execId, loopId: exec.loopId, conversationId: exec.conversationId });
  }
  send({ type: 'loop_status', loops: listLoops(), runningExecutions: running });
}
