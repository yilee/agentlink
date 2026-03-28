/**
 * Tests for scheduler.ts — Loop CRUD, execution lifecycle, and persistence.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, existsSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Use a temp directory so tests don't interfere with real config
vi.mock('../../agent/src/config.js', () => {
  const path = require('path');
  const os = require('os');
  return {
    CONFIG_DIR: path.join(os.tmpdir(), `agentlink-scheduler-test-${process.pid}`),
  };
});

// Mock node-cron to avoid real scheduling
vi.mock('node-cron', () => {
  return {
    default: {
      validate: (expr: string) => {
        if (!expr || typeof expr !== 'string') return false;
        const parts = expr.trim().split(/\s+/);
        if (parts.length !== 5) return false;
        if (expr === 'invalid') return false;
        if (expr === 'not a cron') return false;
        return true;
      },
      schedule: (_expr: string, _cb: () => void, _opts?: any) => {
        return { stop: vi.fn(), getNextRun: () => new Date(Date.now() + 86400000) };
      },
    },
  };
});

const TEST_CONFIG_DIR = join(tmpdir(), `agentlink-scheduler-test-${process.pid}`);

import {
  initScheduler,
  shutdownScheduler,
  createLoop,
  updateLoop,
  deleteLoop,
  listLoops,
  getLoop,
  listLoopExecutions,
  runLoopNow,
  cancelLoopExecution,
  getRunningExecutions,
} from '../../agent/src/scheduler.js';

describe('scheduler.ts', () => {
  let sentMessages: Record<string, unknown>[];
  let handleChatCalls: Array<{ conversationId: string | undefined; prompt: string; workDir: string; options?: any }>;
  let cancelCalls: Array<string | undefined>;
  let outputObservers: Array<(conversationId: string, msg: any) => boolean | void>;
  let closeObservers: Array<(conversationId: string, exitCode: number | null, resultReceived: boolean) => void>;

  function makeDeps() {
    sentMessages = [];
    handleChatCalls = [];
    cancelCalls = [];
    outputObservers = [];
    closeObservers = [];

    return {
      send: (msg: Record<string, unknown>) => sentMessages.push(msg),
      handleChat: (conversationId: string | undefined, prompt: string, workDir: string, options?: any) => {
        handleChatCalls.push({ conversationId, prompt, workDir, options });
      },
      cancelExecution: (conversationId?: string) => cancelCalls.push(conversationId),
      addOutputObserver: (fn: any) => outputObservers.push(fn),
      removeOutputObserver: (fn: any) => {
        const idx = outputObservers.indexOf(fn);
        if (idx >= 0) outputObservers.splice(idx, 1);
      },
      addCloseObserver: (fn: any) => closeObservers.push(fn),
      removeCloseObserver: (fn: any) => {
        const idx = closeObservers.indexOf(fn);
        if (idx >= 0) closeObservers.splice(idx, 1);
      },
    };
  }

  /**
   * Cancel all running loop executions before shutdown,
   * so module-level runningExecutions Map is clean for the next test.
   */
  function cancelAllRunning() {
    for (const loop of listLoops()) {
      cancelLoopExecution(loop.id);
    }
  }

  beforeEach(() => {
    if (existsSync(TEST_CONFIG_DIR)) {
      rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_CONFIG_DIR, { recursive: true });

    const deps = makeDeps();
    initScheduler(deps);
  });

  afterEach(() => {
    cancelAllRunning();
    shutdownScheduler();
    if (existsSync(TEST_CONFIG_DIR)) {
      rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
    }
  });

  describe('createLoop', () => {
    it('creates a loop with correct fields', () => {
      const loop = createLoop({
        name: 'Test Loop',
        prompt: 'Do something',
        schedule: '0 9 * * *',
        scheduleType: 'daily',
        scheduleConfig: { hour: 9, minute: 0 },
        workDir: '/test/dir',
      });

      expect(loop.id).toBeTruthy();
      expect(loop.name).toBe('Test Loop');
      expect(loop.prompt).toBe('Do something');
      expect(loop.schedule).toBe('0 9 * * *');
      expect(loop.scheduleType).toBe('daily');
      expect(loop.enabled).toBe(true);
      expect(loop.workDir).toBe('/test/dir');
      expect(loop.createdAt).toBeTruthy();
      expect(loop.updatedAt).toBeTruthy();
    });

    it('persists loop to disk', () => {
      createLoop({
        name: 'Persisted Loop',
        prompt: 'Check files',
        schedule: '30 8 * * *',
        scheduleType: 'daily',
        scheduleConfig: { hour: 8, minute: 30 },
        workDir: '/test',
      });

      const loopsFile = join(TEST_CONFIG_DIR, 'loops.json');
      expect(existsSync(loopsFile)).toBe(true);

      const raw = readFileSync(loopsFile, 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe('Persisted Loop');
    });

    it('throws on invalid cron expression', () => {
      expect(() =>
        createLoop({
          name: 'Bad Cron',
          prompt: 'Do something',
          schedule: 'invalid',
          scheduleType: 'cron',
          scheduleConfig: {},
          workDir: '/test',
        }),
      ).toThrow('Invalid cron expression');
    });

    it('returns the loop in the loops list', () => {
      createLoop({
        name: 'Listed Loop',
        prompt: 'prompt',
        schedule: '0 9 * * *',
        scheduleType: 'daily',
        scheduleConfig: { hour: 9, minute: 0 },
        workDir: '/test',
      });

      const all = listLoops();
      expect(all).toHaveLength(1);
      expect(all[0].name).toBe('Listed Loop');
    });
  });

  describe('updateLoop', () => {
    it('updates loop name and prompt', () => {
      const loop = createLoop({
        name: 'Original',
        prompt: 'original prompt',
        schedule: '0 9 * * *',
        scheduleType: 'daily',
        scheduleConfig: { hour: 9, minute: 0 },
        workDir: '/test',
      });

      const updated = updateLoop(loop.id, { name: 'Updated Name', prompt: 'new prompt' });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Updated Name');
      expect(updated!.prompt).toBe('new prompt');
      // updatedAt should be set (may be same millisecond as create)
      expect(updated!.updatedAt).toBeTruthy();
    });

    it('returns null for nonexistent loop', () => {
      const result = updateLoop('nonexistent-id', { name: 'New' });
      expect(result).toBeNull();
    });

    it('throws on invalid cron in schedule update', () => {
      const loop = createLoop({
        name: 'Loop',
        prompt: 'prompt',
        schedule: '0 9 * * *',
        scheduleType: 'daily',
        scheduleConfig: { hour: 9, minute: 0 },
        workDir: '/test',
      });

      expect(() => updateLoop(loop.id, { schedule: 'not a cron' })).toThrow(
        'Invalid cron expression',
      );
    });

    it('toggles enabled state', () => {
      const loop = createLoop({
        name: 'Toggle Test',
        prompt: 'prompt',
        schedule: '0 9 * * *',
        scheduleType: 'daily',
        scheduleConfig: { hour: 9, minute: 0 },
        workDir: '/test',
      });

      expect(loop.enabled).toBe(true);

      const disabled = updateLoop(loop.id, { enabled: false });
      expect(disabled!.enabled).toBe(false);

      const enabled = updateLoop(loop.id, { enabled: true });
      expect(enabled!.enabled).toBe(true);
    });

    it('updates schedule and reschedules', () => {
      const loop = createLoop({
        name: 'Schedule Change',
        prompt: 'prompt',
        schedule: '0 9 * * *',
        scheduleType: 'daily',
        scheduleConfig: { hour: 9, minute: 0 },
        workDir: '/test',
      });

      const updated = updateLoop(loop.id, { schedule: '30 14 * * *', scheduleType: 'daily' });
      expect(updated!.schedule).toBe('30 14 * * *');
    });
  });

  describe('deleteLoop', () => {
    it('removes the loop', () => {
      const loop = createLoop({
        name: 'To Delete',
        prompt: 'prompt',
        schedule: '0 9 * * *',
        scheduleType: 'daily',
        scheduleConfig: { hour: 9, minute: 0 },
        workDir: '/test',
      });

      expect(listLoops()).toHaveLength(1);
      const result = deleteLoop(loop.id);
      expect(result).toBe(true);
      expect(listLoops()).toHaveLength(0);
    });

    it('returns false for nonexistent loop', () => {
      expect(deleteLoop('nonexistent')).toBe(false);
    });

    it('persists deletion to disk', () => {
      const loop = createLoop({
        name: 'Delete Me',
        prompt: 'prompt',
        schedule: '0 9 * * *',
        scheduleType: 'daily',
        scheduleConfig: { hour: 9, minute: 0 },
        workDir: '/test',
      });

      deleteLoop(loop.id);

      const loopsFile = join(TEST_CONFIG_DIR, 'loops.json');
      const raw = readFileSync(loopsFile, 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed).toHaveLength(0);
    });
  });

  describe('getLoop', () => {
    it('returns a copy of the loop', () => {
      const loop = createLoop({
        name: 'Get Test',
        prompt: 'prompt',
        schedule: '0 9 * * *',
        scheduleType: 'daily',
        scheduleConfig: { hour: 9, minute: 0 },
        workDir: '/test',
      });

      const retrieved = getLoop(loop.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe('Get Test');
    });

    it('returns null for nonexistent loop', () => {
      expect(getLoop('nonexistent')).toBeNull();
    });
  });

  describe('listLoops', () => {
    it('returns all loops', () => {
      createLoop({
        name: 'Loop A',
        prompt: 'a',
        schedule: '0 9 * * *',
        scheduleType: 'daily',
        scheduleConfig: { hour: 9, minute: 0 },
        workDir: '/a',
      });
      createLoop({
        name: 'Loop B',
        prompt: 'b',
        schedule: '0 10 * * *',
        scheduleType: 'daily',
        scheduleConfig: { hour: 10, minute: 0 },
        workDir: '/b',
      });

      const all = listLoops();
      expect(all).toHaveLength(2);
      // sorted by createdAt descending (newest first)
      expect(all[0].name).toBe('Loop B');
      expect(all[1].name).toBe('Loop A');
    });
  });

  describe('runLoopNow', () => {
    it('triggers handleChat with loop prompt and workDir', () => {
      const loop = createLoop({
        name: 'Manual Run',
        prompt: 'Run this now',
        schedule: '0 9 * * *',
        scheduleType: 'daily',
        scheduleConfig: { hour: 9, minute: 0 },
        workDir: '/manual-dir',
      });

      runLoopNow(loop.id);

      expect(handleChatCalls).toHaveLength(1);
      expect(handleChatCalls[0].prompt).toBe('Run this now');
      expect(handleChatCalls[0].workDir).toBe('/manual-dir');
      expect(handleChatCalls[0].conversationId).toMatch(/^loop-/);
    });

    it('sends loop_execution_started to web UI', () => {
      const loop = createLoop({
        name: 'Started Event',
        prompt: 'prompt',
        schedule: '0 9 * * *',
        scheduleType: 'daily',
        scheduleConfig: { hour: 9, minute: 0 },
        workDir: '/test',
      });

      runLoopNow(loop.id);

      const startMsg = sentMessages.find(m => m.type === 'loop_execution_started');
      expect(startMsg).toBeTruthy();
      expect(startMsg!.loopId).toBe(loop.id);
      expect((startMsg!.execution as any).trigger).toBe('manual');
      expect((startMsg!.execution as any).status).toBe('running');
    });

    it('does nothing for nonexistent loop', () => {
      runLoopNow('nonexistent');
      expect(handleChatCalls).toHaveLength(0);
    });

    it('prevents overlapping executions for the same loop', () => {
      const loop = createLoop({
        name: 'Overlap Test',
        prompt: 'prompt',
        schedule: '0 9 * * *',
        scheduleType: 'daily',
        scheduleConfig: { hour: 9, minute: 0 },
        workDir: '/test',
      });

      runLoopNow(loop.id);
      runLoopNow(loop.id); // Should be skipped

      expect(handleChatCalls).toHaveLength(1);
    });
  });

  describe('cancelLoopExecution', () => {
    it('cancels a running execution', () => {
      const loop = createLoop({
        name: 'Cancel Test',
        prompt: 'prompt',
        schedule: '0 9 * * *',
        scheduleType: 'daily',
        scheduleConfig: { hour: 9, minute: 0 },
        workDir: '/test',
      });

      runLoopNow(loop.id);

      // Verify it is running
      const running = getRunningExecutions();
      const runningForLoop = [...running.values()].filter(e => e.loopId === loop.id);
      expect(runningForLoop).toHaveLength(1);

      cancelLoopExecution(loop.id);

      expect(cancelCalls.length).toBeGreaterThanOrEqual(1);

      // Verify no longer running for this loop
      const afterCancel = [...getRunningExecutions().values()].filter(e => e.loopId === loop.id);
      expect(afterCancel).toHaveLength(0);

      // Should have sent completion message
      const completeMsg = sentMessages.find(m => m.type === 'loop_execution_completed');
      expect(completeMsg).toBeTruthy();
      expect((completeMsg!.execution as any).status).toBe('cancelled');
    });
  });

  describe('execution persistence', () => {
    it('creates execution index JSONL file', () => {
      const loop = createLoop({
        name: 'Persist Exec',
        prompt: 'prompt',
        schedule: '0 9 * * *',
        scheduleType: 'daily',
        scheduleConfig: { hour: 9, minute: 0 },
        workDir: '/test',
      });

      runLoopNow(loop.id);

      const indexPath = join(TEST_CONFIG_DIR, 'loop-executions', loop.id, 'index.jsonl');
      expect(existsSync(indexPath)).toBe(true);

      const raw = readFileSync(indexPath, 'utf-8');
      const lines = raw.trim().split('\n');
      expect(lines).toHaveLength(1);

      const exec = JSON.parse(lines[0]);
      expect(exec.loopId).toBe(loop.id);
      expect(exec.status).toBe('running');
      expect(exec.trigger).toBe('manual');
    });

    it('listLoopExecutions returns empty for no executions', () => {
      const loop = createLoop({
        name: 'Empty Exec',
        prompt: 'prompt',
        schedule: '0 9 * * *',
        scheduleType: 'daily',
        scheduleConfig: { hour: 9, minute: 0 },
        workDir: '/test',
      });

      const execs = listLoopExecutions(loop.id);
      expect(execs).toHaveLength(0);
    });

    it('listLoopExecutions returns executions after run and cancel', () => {
      const loop = createLoop({
        name: 'Multi Exec',
        prompt: 'prompt',
        schedule: '0 9 * * *',
        scheduleType: 'daily',
        scheduleConfig: { hour: 9, minute: 0 },
        workDir: '/test',
      });

      runLoopNow(loop.id);
      cancelLoopExecution(loop.id);
      runLoopNow(loop.id);
      cancelLoopExecution(loop.id);

      const execs = listLoopExecutions(loop.id);
      expect(execs.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('output and close observers', () => {
    it('registers output and close observers on init', () => {
      expect(outputObservers).toHaveLength(1);
      expect(closeObservers).toHaveLength(1);
    });

    it('removes observers on shutdown', () => {
      shutdownScheduler();
      expect(outputObservers).toHaveLength(0);
      expect(closeObservers).toHaveLength(0);
    });
  });

  describe('disk persistence round-trip', () => {
    it('loads loops from disk on reinit', () => {
      createLoop({
        name: 'Reload Test',
        prompt: 'prompt',
        schedule: '0 9 * * *',
        scheduleType: 'daily',
        scheduleConfig: { hour: 9, minute: 0 },
        workDir: '/test',
      });

      expect(listLoops()).toHaveLength(1);

      // Shutdown and reinit
      shutdownScheduler();
      const deps = makeDeps();
      initScheduler(deps);

      const reloaded = listLoops();
      expect(reloaded).toHaveLength(1);
      expect(reloaded[0].name).toBe('Reload Test');
    });
  });

  describe('orphaned execution recovery', () => {
    it('marks running executions as error on reinit', () => {
      const loop = createLoop({
        name: 'Orphan Test',
        prompt: 'prompt',
        schedule: '0 9 * * *',
        scheduleType: 'daily',
        scheduleConfig: { hour: 9, minute: 0 },
        workDir: '/test',
      });

      // Run and then cancel (to clear in-memory map and get a clean state)
      runLoopNow(loop.id);
      cancelLoopExecution(loop.id);

      // Now manually write a fake "running" entry to the index file on disk.
      // This simulates the real crash scenario: agent dies mid-execution,
      // disk still shows status=running, but the in-memory map is gone.
      const indexPath = join(TEST_CONFIG_DIR, 'loop-executions', loop.id, 'index.jsonl');
      const fakeOrphan = JSON.stringify({
        id: 'orphan-exec-001',
        loopId: loop.id,
        status: 'running',
        trigger: 'scheduled',
        startedAt: new Date().toISOString(),
      });
      // Append the orphaned entry to the existing index
      const existing = existsSync(indexPath) ? readFileSync(indexPath, 'utf-8') : '';
      writeFileSync(indexPath, existing.trimEnd() + '\n' + fakeOrphan + '\n');

      // Shutdown and reinit — reconcileOrphanedExecutions should mark it as error
      shutdownScheduler();
      const deps = makeDeps();
      initScheduler(deps);

      const execs = listLoopExecutions(loop.id);
      expect(execs.length).toBeGreaterThanOrEqual(1);
      const orphaned = execs.find(e => e.id === 'orphan-exec-001');
      expect(orphaned).toBeTruthy();
      expect(orphaned!.status).toBe('error');
      expect(orphaned!.error).toBe('Agent restarted during execution');
    });
  });

  describe('brainMode', () => {
    it('creates a loop with brainMode: true', () => {
      const loop = createLoop({
        name: 'Brain Loop',
        prompt: 'brain task',
        schedule: '0 9 * * *',
        scheduleType: 'daily',
        scheduleConfig: { hour: 9, minute: 0 },
        workDir: '/test',
        brainMode: true,
      });

      expect(loop.brainMode).toBe(true);
    });

    it('defaults brainMode to false when not provided', () => {
      const loop = createLoop({
        name: 'Default Loop',
        prompt: 'prompt',
        schedule: '0 9 * * *',
        scheduleType: 'daily',
        scheduleConfig: { hour: 9, minute: 0 },
        workDir: '/test',
      });

      expect(loop.brainMode).toBe(false);
    });

    it('persists brainMode to disk', () => {
      createLoop({
        name: 'Brain Persist',
        prompt: 'prompt',
        schedule: '0 9 * * *',
        scheduleType: 'daily',
        scheduleConfig: { hour: 9, minute: 0 },
        workDir: '/test',
        brainMode: true,
      });

      const loopsFile = join(TEST_CONFIG_DIR, 'loops.json');
      const parsed = JSON.parse(readFileSync(loopsFile, 'utf-8'));
      expect(parsed[0].brainMode).toBe(true);
    });

    it('passes brainMode to handleChat when executing', () => {
      const loop = createLoop({
        name: 'Brain Exec',
        prompt: 'brain prompt',
        schedule: '0 9 * * *',
        scheduleType: 'daily',
        scheduleConfig: { hour: 9, minute: 0 },
        workDir: '/brain-dir',
        brainMode: true,
      });

      runLoopNow(loop.id);

      expect(handleChatCalls).toHaveLength(1);
      expect(handleChatCalls[0].options).toEqual({ brainMode: true });
    });

    it('passes brainMode: false for non-brain loops', () => {
      const loop = createLoop({
        name: 'Normal Exec',
        prompt: 'normal prompt',
        schedule: '0 9 * * *',
        scheduleType: 'daily',
        scheduleConfig: { hour: 9, minute: 0 },
        workDir: '/normal-dir',
      });

      runLoopNow(loop.id);

      expect(handleChatCalls).toHaveLength(1);
      expect(handleChatCalls[0].options).toEqual({ brainMode: false });
    });

    it('updates brainMode via updateLoop', () => {
      const loop = createLoop({
        name: 'Update Brain',
        prompt: 'prompt',
        schedule: '0 9 * * *',
        scheduleType: 'daily',
        scheduleConfig: { hour: 9, minute: 0 },
        workDir: '/test',
        brainMode: false,
      });

      const updated = updateLoop(loop.id, { brainMode: true });
      expect(updated!.brainMode).toBe(true);

      // Verify persistence
      const loopsFile = join(TEST_CONFIG_DIR, 'loops.json');
      const parsed = JSON.parse(readFileSync(loopsFile, 'utf-8'));
      expect(parsed[0].brainMode).toBe(true);
    });
  });

  describe('missed schedule catch-up', () => {
    it('fires catch-up for daily loop that missed its schedule', () => {
      // Pre-seed loops.json with a daily loop whose lastExecution is >24h ago
      const loopsFile = join(TEST_CONFIG_DIR, 'loops.json');
      const now = new Date();
      // Schedule for 1 minute ago so "previous scheduled time" is just before now
      let missedHour = now.getHours();
      let missedMinute = now.getMinutes() - 1;
      if (missedMinute < 0) {
        missedMinute = 59;
        missedHour = (missedHour - 1 + 24) % 24;
      }
      const staleTime = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 days ago

      const loopData = [{
        id: 'catchup-daily-001',
        name: 'Catch-up Daily',
        prompt: 'catch me',
        schedule: `${missedMinute} ${missedHour} * * *`,
        scheduleType: 'daily',
        scheduleConfig: { hour: missedHour, minute: missedMinute },
        workDir: '/test',
        enabled: true,
        brainMode: false,
        createdAt: staleTime.toISOString(),
        updatedAt: staleTime.toISOString(),
        lastExecution: {
          id: 'old-exec-001',
          status: 'success',
          startedAt: staleTime.toISOString(),
          durationMs: 5000,
          trigger: 'scheduled',
        },
      }];
      writeFileSync(loopsFile, JSON.stringify(loopData));

      // Reinit — should trigger catch-up
      shutdownScheduler();
      const deps = makeDeps();
      initScheduler(deps);

      // Should have called handleChat for the catch-up
      expect(handleChatCalls).toHaveLength(1);
      expect(handleChatCalls[0].prompt).toBe('catch me');
      expect(handleChatCalls[0].workDir).toBe('/test');

      // Should have sent loop_execution_started
      const startMsg = sentMessages.find(m => m.type === 'loop_execution_started');
      expect(startMsg).toBeTruthy();
      expect((startMsg!.execution as any).trigger).toBe('scheduled');
    });

    it('does NOT fire catch-up if lastExecution is recent', () => {
      const loopsFile = join(TEST_CONFIG_DIR, 'loops.json');
      const now = new Date();
      // Schedule for a time that already passed today (2 minutes ago)
      const pastDate = new Date(now.getTime() - 2 * 60 * 1000);
      const scheduledHour = pastDate.getHours();
      const scheduledMinute = pastDate.getMinutes();

      // lastExecution started AT the scheduled time (i.e., it already ran)
      const recentTime = new Date(pastDate);

      const loopData = [{
        id: 'nocatchup-001',
        name: 'No Catch-up',
        prompt: 'already ran',
        schedule: `${scheduledMinute} ${scheduledHour} * * *`,
        scheduleType: 'daily',
        scheduleConfig: { hour: scheduledHour, minute: scheduledMinute },
        workDir: '/test',
        enabled: true,
        brainMode: false,
        createdAt: recentTime.toISOString(),
        updatedAt: recentTime.toISOString(),
        lastExecution: {
          id: 'recent-exec-001',
          status: 'success',
          startedAt: recentTime.toISOString(),
          durationMs: 5000,
          trigger: 'scheduled',
        },
      }];
      writeFileSync(loopsFile, JSON.stringify(loopData));

      shutdownScheduler();
      const deps = makeDeps();
      initScheduler(deps);

      // Should NOT have triggered catch-up
      expect(handleChatCalls).toHaveLength(0);
    });

    it('does NOT fire catch-up for disabled loops', () => {
      const loopsFile = join(TEST_CONFIG_DIR, 'loops.json');
      const now = new Date();
      const staleTime = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

      const loopData = [{
        id: 'disabled-catchup-001',
        name: 'Disabled Loop',
        prompt: 'should not run',
        schedule: `${now.getMinutes()} ${now.getHours()} * * *`,
        scheduleType: 'daily',
        scheduleConfig: { hour: now.getHours(), minute: now.getMinutes() },
        workDir: '/test',
        enabled: false,
        brainMode: false,
        createdAt: staleTime.toISOString(),
        updatedAt: staleTime.toISOString(),
        lastExecution: {
          id: 'old-exec-002',
          status: 'success',
          startedAt: staleTime.toISOString(),
          durationMs: 5000,
          trigger: 'scheduled',
        },
      }];
      writeFileSync(loopsFile, JSON.stringify(loopData));

      shutdownScheduler();
      const deps = makeDeps();
      initScheduler(deps);

      expect(handleChatCalls).toHaveLength(0);
    });

    it('does NOT fire catch-up for manual loops', () => {
      const loopsFile = join(TEST_CONFIG_DIR, 'loops.json');
      const staleTime = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

      const loopData = [{
        id: 'manual-catchup-001',
        name: 'Manual Loop',
        prompt: 'manual only',
        schedule: '',
        scheduleType: 'manual',
        scheduleConfig: { hour: 9, minute: 0 },
        workDir: '/test',
        enabled: true,
        brainMode: false,
        createdAt: staleTime.toISOString(),
        updatedAt: staleTime.toISOString(),
      }];
      writeFileSync(loopsFile, JSON.stringify(loopData));

      shutdownScheduler();
      const deps = makeDeps();
      initScheduler(deps);

      expect(handleChatCalls).toHaveLength(0);
    });

    it('fires catch-up for hourly loop that missed its schedule', () => {
      const loopsFile = join(TEST_CONFIG_DIR, 'loops.json');
      const now = new Date();
      const minute = now.getMinutes() > 0 ? now.getMinutes() - 1 : 59;
      const staleTime = new Date(now.getTime() - 3 * 60 * 60 * 1000); // 3 hours ago

      const loopData = [{
        id: 'catchup-hourly-001',
        name: 'Catch-up Hourly',
        prompt: 'hourly catch',
        schedule: `${minute} * * * *`,
        scheduleType: 'hourly',
        scheduleConfig: { minute },
        workDir: '/test',
        enabled: true,
        brainMode: false,
        createdAt: staleTime.toISOString(),
        updatedAt: staleTime.toISOString(),
        lastExecution: {
          id: 'old-hourly-001',
          status: 'success',
          startedAt: staleTime.toISOString(),
          durationMs: 5000,
          trigger: 'scheduled',
        },
      }];
      writeFileSync(loopsFile, JSON.stringify(loopData));

      shutdownScheduler();
      const deps = makeDeps();
      initScheduler(deps);

      expect(handleChatCalls).toHaveLength(1);
      expect(handleChatCalls[0].prompt).toBe('hourly catch');
    });

    it('fires catch-up for weekly loop that missed its schedule', () => {
      const loopsFile = join(TEST_CONFIG_DIR, 'loops.json');
      const now = new Date();
      // Pick a minute in the past so the "previous scheduled time" falls earlier today
      const minute = now.getMinutes() > 0 ? now.getMinutes() - 1 : 59;
      const hour = minute === 59 ? (now.getHours() > 0 ? now.getHours() - 1 : 23) : now.getHours();
      const dayOfWeek = now.getDay(); // today's day-of-week so previous = today
      const staleTime = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000); // 8 days ago (>1 week)

      const loopData = [{
        id: 'catchup-weekly-001',
        name: 'Catch-up Weekly',
        prompt: 'weekly catch',
        schedule: `${minute} ${hour} * * ${dayOfWeek}`,
        scheduleType: 'weekly',
        scheduleConfig: { hour, minute, dayOfWeek },
        workDir: '/test',
        enabled: true,
        brainMode: false,
        createdAt: staleTime.toISOString(),
        updatedAt: staleTime.toISOString(),
        lastExecution: {
          id: 'old-weekly-001',
          status: 'success',
          startedAt: staleTime.toISOString(),
          durationMs: 5000,
          trigger: 'scheduled',
        },
      }];
      writeFileSync(loopsFile, JSON.stringify(loopData));

      shutdownScheduler();
      const deps = makeDeps();
      initScheduler(deps);

      expect(handleChatCalls).toHaveLength(1);
      expect(handleChatCalls[0].prompt).toBe('weekly catch');
    });
  });
});
