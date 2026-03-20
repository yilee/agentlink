// ── Loop mode: state management and message routing ───────────────────────────
import { ref, computed } from 'vue';
import { LOOP_TEMPLATES, LOOP_TEMPLATE_KEYS, buildCronExpression, formatSchedule } from './loopTemplates.js';

import { buildHistoryBatch } from './backgroundRouting.js';

/**
 * Creates the Loop mode controller.
 * @param {object} deps
 * @param {Function} deps.wsSend
 * @param {Function} deps.scrollToBottom
 */
export function createLoop(deps) {
  const { wsSend, scrollToBottom, loadingLoops, setViewMode, formatRelativeTime } = deps;

  // ── Reactive state ──────────────────────────────────

  /** @type {import('vue').Ref<Array>} All Loop definitions from agent */
  const loopsList = ref([]);

  /** @type {import('vue').Ref<object|null>} Loop selected for detail view */
  const selectedLoop = ref(null);

  /** @type {import('vue').Ref<string|null>} Execution ID selected for replay */
  const selectedExecution = ref(null);

  /** @type {import('vue').Ref<Array>} Execution history for selectedLoop */
  const executionHistory = ref([]);

  /** @type {import('vue').Ref<Array>} Messages for selectedExecution replay */
  const executionMessages = ref([]);

  /** @type {import('vue').Ref<object>} loopId -> LoopExecution for currently running */
  const runningLoops = ref({});

  /** @type {import('vue').Ref<boolean>} Loading execution list */
  const loadingExecutions = ref(false);

  /** @type {import('vue').Ref<boolean>} Loading single execution detail */
  const loadingExecution = ref(false);

  /** @type {import('vue').Ref<string|null>} Loop being edited (loopId) or null for new */
  const editingLoopId = ref(null);

  /** @type {import('vue').Ref<string>} Error message from last loop operation (create/update) */
  const loopError = ref('');

  /** @type {number} Current execution history page limit */
  let execPageLimit = 20;

  /** @type {import('vue').Ref<boolean>} Whether more execution history may be available */
  const hasMoreExecutions = ref(false);

  /** @type {import('vue').Ref<boolean>} Loading more executions via pagination */
  const loadingMoreExecutions = ref(false);

  // --- Loop form state refs (moved from store.js) ---
  const loopName = ref('');
  const loopPrompt = ref('');
  const loopScheduleType = ref('daily');
  const loopScheduleHour = ref(9);
  const loopScheduleMinute = ref(0);
  const loopScheduleDayOfWeek = ref(1);
  const loopCronExpr = ref('0 9 * * *');
  const loopSelectedTemplate = ref(null);
  const loopDeleteConfirmOpen = ref(false);
  const loopDeleteConfirmId = ref(null);
  const loopDeleteConfirmName = ref('');
  const renamingLoopId = ref(null);
  const renameLoopText = ref('');
  const loopBrainMode = ref(false);

  // ── Computed ──────────────────────────────────────

  /** Whether any Loop execution is currently running */
  const hasRunningLoop = computed(() => Object.keys(runningLoops.value).length > 0);

  /** Get the first running loop for notification banner */
  const firstRunningLoop = computed(() => {
    const entries = Object.entries(runningLoops.value);
    if (entries.length === 0) return null;
    const [loopId, execution] = entries[0];
    const loop = loopsList.value.find(l => l.id === loopId);
    return { loopId, execution, name: loop?.name || 'Unknown' };
  });

  // ── Loop CRUD ─────────────────────────────────────

  function createNewLoop(config) {
    wsSend({ type: 'create_loop', ...config });
  }

  function updateExistingLoop(loopId, updates) {
    wsSend({ type: 'update_loop', loopId, updates });
  }

  function deleteExistingLoop(loopId) {
    wsSend({ type: 'delete_loop', loopId });
  }

  function toggleLoop(loopId) {
    const loop = loopsList.value.find(l => l.id === loopId);
    if (!loop) return;
    wsSend({ type: 'update_loop', loopId, updates: { enabled: !loop.enabled } });
  }

  function runNow(loopId) {
    wsSend({ type: 'run_loop', loopId });
  }

  function cancelExecution(loopId) {
    wsSend({ type: 'cancel_loop_execution', loopId });
  }

  function requestLoopsList() {
    if (loadingLoops) loadingLoops.value = true;
    wsSend({ type: 'list_loops' });
  }

  // ── Navigation ────────────────────────────────────

  function viewLoopDetail(loopId) {
    const loop = loopsList.value.find(l => l.id === loopId);
    if (!loop) return;
    selectedLoop.value = { ...loop };
    selectedExecution.value = null;
    executionMessages.value = [];
    executionHistory.value = [];
    loadingExecutions.value = true;
    editingLoopId.value = null;
    execPageLimit = 20;
    hasMoreExecutions.value = false;
    wsSend({ type: 'list_loop_executions', loopId, limit: execPageLimit });
  }

  function viewExecution(loopId, executionId) {
    selectedExecution.value = executionId;
    loadingExecution.value = true;
    executionMessages.value = [];
    wsSend({ type: 'get_loop_execution_messages', loopId, executionId });
  }

  function backToLoopsList() {
    selectedLoop.value = null;
    selectedExecution.value = null;
    executionHistory.value = [];
    executionMessages.value = [];
    editingLoopId.value = null;
  }

  function backToLoopDetail() {
    selectedExecution.value = null;
    executionMessages.value = [];
  }

  function startEditing(loopId) {
    editingLoopId.value = loopId;
  }

  function cancelEditing() {
    editingLoopId.value = null;
  }

  function loadMoreExecutions() {
    if (!selectedLoop.value || loadingMoreExecutions.value) return;
    loadingMoreExecutions.value = true;
    execPageLimit *= 2;
    wsSend({ type: 'list_loop_executions', loopId: selectedLoop.value.id, limit: execPageLimit });
  }

  function clearLoopError() {
    loopError.value = '';
  }

  // ── Live output accumulation ─────────────────────

  /** Message ID counter for live execution messages */
  let liveMsgIdCounter = 0;

  /**
   * Append a Claude output message to the live execution display.
   * Mirrors the team.js handleTeamAgentOutput accumulation logic.
   */
  function appendOutputToDisplay(data) {
    if (!data) return;
    const msgs = executionMessages.value;

    if (data.type === 'content_block_delta' && data.delta) {
      const last = msgs.length > 0 ? msgs[msgs.length - 1] : null;
      if (last && last.role === 'assistant' && last.isStreaming) {
        last.content += data.delta;
      } else {
        msgs.push({
          id: ++liveMsgIdCounter, role: 'assistant',
          content: data.delta, isStreaming: true, timestamp: Date.now(),
        });
      }
    } else if (data.type === 'tool_use' && data.tools) {
      const last = msgs.length > 0 ? msgs[msgs.length - 1] : null;
      if (last && last.role === 'assistant' && last.isStreaming) {
        last.isStreaming = false;
      }
      for (const tool of data.tools) {
        msgs.push({
          id: ++liveMsgIdCounter, role: 'tool',
          toolId: tool.id, toolName: tool.name || 'unknown',
          toolInput: tool.input ? JSON.stringify(tool.input, null, 2) : '',
          hasResult: false, expanded: true, timestamp: Date.now(),
        });
      }
    } else if (data.type === 'user' && data.tool_use_result) {
      const result = data.tool_use_result;
      const results = Array.isArray(result) ? result : [result];
      for (const r of results) {
        const toolMsg = msgs.find(m => m.role === 'tool' && m.toolId === r.tool_use_id);
        if (toolMsg) {
          toolMsg.toolOutput = typeof r.content === 'string'
            ? r.content : JSON.stringify(r.content, null, 2);
          toolMsg.hasResult = true;
        }
      }
    }

    scrollToBottom();
  }

  // ── Message routing ───────────────────────────────

  /**
   * Handle incoming Loop-related messages from the WebSocket.
   * Returns true if the message was consumed.
   */
  function handleLoopMessage(msg) {
    switch (msg.type) {
      case 'loops_list':
        loopsList.value = msg.loops || [];
        return true;

      case 'loop_created':
        loopsList.value.push(msg.loop);
        loopError.value = '';
        return true;

      case 'loop_updated': {
        const idx = loopsList.value.findIndex(l => l.id === msg.loop.id);
        if (idx >= 0) loopsList.value[idx] = msg.loop;
        if (selectedLoop.value?.id === msg.loop.id) {
          selectedLoop.value = { ...msg.loop };
        }
        editingLoopId.value = null;
        loopError.value = '';
        return true;
      }

      case 'loop_deleted':
        loopsList.value = loopsList.value.filter(l => l.id !== msg.loopId);
        if (selectedLoop.value?.id === msg.loopId) backToLoopsList();
        return true;

      case 'loop_execution_started':
        runningLoops.value = { ...runningLoops.value, [msg.loopId]: msg.execution };
        // If viewing this loop's detail, prepend to history
        if (selectedLoop.value?.id === msg.loopId) {
          executionHistory.value.unshift(msg.execution);
        }
        return true;

      case 'loop_execution_output':
        // If user is viewing this execution live, append to display
        if (selectedExecution.value === msg.executionId) {
          appendOutputToDisplay(msg.data);
        }
        return true;

      case 'loop_execution_completed': {
        const newRunning = { ...runningLoops.value };
        delete newRunning[msg.loopId];
        runningLoops.value = newRunning;
        // Update execution in history list
        if (selectedLoop.value?.id === msg.loopId) {
          const idx = executionHistory.value.findIndex(e => e.id === msg.execution.id);
          if (idx >= 0) executionHistory.value[idx] = msg.execution;
        }
        // Finalize streaming message
        const msgs = executionMessages.value;
        if (msgs.length > 0) {
          const last = msgs[msgs.length - 1];
          if (last.role === 'assistant' && last.isStreaming) {
            last.isStreaming = false;
          }
        }
        // Update Loop's lastExecution in sidebar list
        const loop = loopsList.value.find(l => l.id === msg.loopId);
        if (loop) {
          loop.lastExecution = {
            id: msg.execution.id,
            status: msg.execution.status,
            startedAt: msg.execution.startedAt,
            durationMs: msg.execution.durationMs,
            trigger: msg.execution.trigger,
          };
        }
        return true;
      }

      case 'loop_executions_list':
        if (selectedLoop.value?.id === msg.loopId) {
          const execs = msg.executions || [];
          executionHistory.value = execs;
          loadingExecutions.value = false;
          loadingMoreExecutions.value = false;
          hasMoreExecutions.value = execs.length >= execPageLimit;
        }
        return true;

      case 'loop_execution_messages':
        if (selectedExecution.value === msg.executionId) {
          if (msg.messages && msg.messages.length > 0) {
            let idCounter = 0;
            executionMessages.value = buildHistoryBatch(msg.messages, () => ++idCounter);
            liveMsgIdCounter = idCounter;
          } else {
            executionMessages.value = [];
          }
          loadingExecution.value = false;
          scrollToBottom();
        }
        return true;

      default:
        return false;
    }
  }


  // --- Loop panel methods (moved from store.js) ---
  function startLoopRename(l) {
    renamingLoopId.value = l.id;
    renameLoopText.value = l.name || '';
  }

  function confirmLoopRename() {
    const lid = renamingLoopId.value;
    const name = renameLoopText.value.trim();
    if (!lid || !name) { renamingLoopId.value = null; renameLoopText.value = ''; return; }
    updateExistingLoop(lid, { name });
    renamingLoopId.value = null;
    renameLoopText.value = '';
  }

  function cancelLoopRename() {
    renamingLoopId.value = null;
    renameLoopText.value = '';
  }

  function newLoop() {
    backToLoopsList();
    editingLoopId.value = null;
    loopSelectedTemplate.value = null;
    loopName.value = '';
    loopPrompt.value = '';
    loopBrainMode.value = false;
    loopScheduleType.value = 'daily';
    loopScheduleHour.value = 9;
    loopScheduleMinute.value = 0;
    loopScheduleDayOfWeek.value = 1;
    loopCronExpr.value = '0 9 * * *';
    setViewMode('loop');
  }

  function viewLoop(loopId) {
    viewLoopDetail(loopId);
    setViewMode('loop');
  }

  function selectLoopTemplate(key) {
    loopSelectedTemplate.value = key;
    const tpl = LOOP_TEMPLATES[key];
    if (!tpl) return;
    loopName.value = tpl.name || '';
    loopPrompt.value = tpl.prompt || '';
    loopScheduleType.value = tpl.scheduleType || 'daily';
    const cfg = tpl.scheduleConfig || {};
    loopScheduleHour.value = cfg.hour ?? 9;
    loopScheduleMinute.value = cfg.minute ?? 0;
    loopScheduleDayOfWeek.value = cfg.dayOfWeek ?? 1;
    loopCronExpr.value = buildCronExpression(tpl.scheduleType || 'daily', cfg);
  }

  function resetLoopForm() {
    loopSelectedTemplate.value = null;
    loopName.value = '';
    loopPrompt.value = '';
    loopScheduleType.value = 'daily';
    loopScheduleHour.value = 9;
    loopScheduleMinute.value = 0;
    loopScheduleDayOfWeek.value = 1;
    loopCronExpr.value = '0 9 * * *';
    editingLoopId.value = null;
  }

  function createLoopFromPanel() {
    const name = loopName.value.trim();
    const prompt = loopPrompt.value.trim();
    if (!name || !prompt) return;
    clearLoopError();
    const schedCfg = { hour: loopScheduleHour.value, minute: loopScheduleMinute.value };
    if (loopScheduleType.value === 'weekly') schedCfg.dayOfWeek = loopScheduleDayOfWeek.value;
    if (loopScheduleType.value === 'cron') schedCfg.cronExpression = loopCronExpr.value;
    const schedule = loopScheduleType.value === 'manual' ? ''
      : loopScheduleType.value === 'cron' ? loopCronExpr.value
      : buildCronExpression(loopScheduleType.value, schedCfg);
    createNewLoop({ name, prompt, schedule, scheduleType: loopScheduleType.value, scheduleConfig: schedCfg, brainMode: loopBrainMode.value });
    // Reset form
    loopSelectedTemplate.value = null;
    loopName.value = '';
    loopPrompt.value = '';
    loopBrainMode.value = false;    loopScheduleType.value = 'daily';
    loopScheduleHour.value = 9;
    loopScheduleMinute.value = 0;
    loopScheduleDayOfWeek.value = 1;
    loopCronExpr.value = '0 9 * * *';
  }

  function startEditingLoop(l) {
    editingLoopId.value = l.id;
    loopName.value = l.name || '';
    loopPrompt.value = l.prompt || '';
    loopBrainMode.value = l.brainMode || false;
    loopScheduleType.value = l.scheduleType || 'daily';
    const cfg = l.scheduleConfig || {};
    loopScheduleHour.value = cfg.hour ?? 9;
    loopScheduleMinute.value = cfg.minute ?? 0;
    loopScheduleDayOfWeek.value = cfg.dayOfWeek ?? 1;
    loopCronExpr.value = l.schedule || buildCronExpression(l.scheduleType || 'daily', cfg);
  }

  function saveLoopEdits() {
    const lid = editingLoopId.value;
    if (!lid) return;
    const name = loopName.value.trim();
    const prompt = loopPrompt.value.trim();
    if (!name || !prompt) return;
    clearLoopError();
    const schedCfg = { hour: loopScheduleHour.value, minute: loopScheduleMinute.value };
    if (loopScheduleType.value === 'weekly') schedCfg.dayOfWeek = loopScheduleDayOfWeek.value;
    if (loopScheduleType.value === 'cron') schedCfg.cronExpression = loopCronExpr.value;
    const schedule = loopScheduleType.value === 'manual' ? ''
      : loopScheduleType.value === 'cron' ? loopCronExpr.value
      : buildCronExpression(loopScheduleType.value, schedCfg);
    updateExistingLoop(lid, { name, prompt, schedule, scheduleType: loopScheduleType.value, scheduleConfig: schedCfg, brainMode: loopBrainMode.value });
    editingLoopId.value = null;
    loopName.value = '';
    loopPrompt.value = '';
  }

  function cancelEditingLoop() {
    editingLoopId.value = null;
    loopName.value = '';
    loopPrompt.value = '';
    loopBrainMode.value = false;
    loopScheduleType.value = 'daily';
    loopScheduleHour.value = 9;
    loopScheduleMinute.value = 0;
  }

  function requestDeleteLoop(l) {
    loopDeleteConfirmId.value = l.id;
    loopDeleteConfirmName.value = l.name || l.id.slice(0, 8);
    loopDeleteConfirmOpen.value = true;
  }

  function confirmDeleteLoop() {
    if (!loopDeleteConfirmId.value) return;
    deleteExistingLoop(loopDeleteConfirmId.value);
    loopDeleteConfirmOpen.value = false;
    loopDeleteConfirmId.value = null;
  }

  function cancelDeleteLoop() {
    loopDeleteConfirmOpen.value = false;
    loopDeleteConfirmId.value = null;
  }

  function loopScheduleDisplay(l) {
    return formatSchedule(l.scheduleType, l.scheduleConfig || {}, l.schedule);
  }

  function loopLastRunDisplay(l) {
    if (!l.lastExecution) return '';
    const exec = l.lastExecution;
    const ago = formatRelativeTime(exec.startedAt);
    const icon = exec.status === 'success' ? 'OK' : exec.status === 'error' ? 'ERR' : exec.status;
    return ago + ' ' + icon;
  }

  function formatExecTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatDuration(ms) {
    if (!ms && ms !== 0) return '';
    const totalSecs = Math.floor(ms / 1000);
    if (totalSecs < 60) return totalSecs + 's';
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    if (m < 60) return m + 'm ' + String(s).padStart(2, '0') + 's';
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return h + 'h ' + String(rm).padStart(2, '0') + 'm';
  }

  function isLoopRunning(loopId) {
    return !!runningLoops.value[loopId];
  }

  function padTwo(n) {
    return String(n).padStart(2, '0');
  }

  return {
    // State
    loopsList, selectedLoop, selectedExecution,
    executionHistory, executionMessages, runningLoops,
    loadingExecutions, loadingExecution, editingLoopId,
    loopError, hasMoreExecutions, loadingMoreExecutions,
    // Form state
    loopName, loopPrompt, loopScheduleType,
    loopScheduleHour, loopScheduleMinute, loopScheduleDayOfWeek,
    loopCronExpr, loopSelectedTemplate, loopBrainMode,
    // Delete/rename state
    loopDeleteConfirmOpen, loopDeleteConfirmId, loopDeleteConfirmName,
    renamingLoopId, renameLoopText,
    // Constants
    LOOP_TEMPLATES, LOOP_TEMPLATE_KEYS, formatSchedule,
    // Computed
    hasRunningLoop, firstRunningLoop,
    // CRUD
    createNewLoop, updateExistingLoop, deleteExistingLoop,
    toggleLoop, runNow, cancelExecution, requestLoopsList,
    // Navigation
    viewLoopDetail, viewExecution,
    backToLoopsList, backToLoopDetail,
    startEditing, cancelEditing,
    // Panel methods
    startLoopRename, confirmLoopRename, cancelLoopRename,
    newLoop, viewLoop, selectLoopTemplate, resetLoopForm,
    createLoopFromPanel, startEditingLoop, saveLoopEdits, cancelEditingLoop,
    requestDeleteLoop, confirmDeleteLoop, cancelDeleteLoop,
    // Display helpers
    loopScheduleDisplay, loopLastRunDisplay, formatExecTime, formatDuration,
    isLoopRunning, padTwo,
    // Pagination & errors
    loadMoreExecutions, clearLoopError,
    // Message routing
    handleLoopMessage,
  };
}
