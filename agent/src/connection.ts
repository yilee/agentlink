import WebSocket from 'ws';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import type { AgentConfig } from './config.js';
import { loadRuntimeState, saveRuntimeState } from './config.js';
import { handleListDirectory, handleReadFile, handleChangeWorkDir, handleUpdateFile, handleCreateFile, handleCreateDirectory, handleDeleteFile } from './directory-handlers.js';
import { handleGitStatus, handleGitDiff, handleGitStage, handleGitUnstage, handleGitDiscard, handleGitCommit } from './git-handlers.js';
import { loadSessionMetadata, loadAllSessionMetadata, deleteSessionMetadata } from './session-metadata.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');
import { handleChat as claudeHandleChat, setSendFn, abort as abortClaude, abortAll as abortAllClaude, cancelExecution as claudeCancelExecution, handleUserAnswer, handleBtwQuestion, getConversation, getConversations, getIsCompacting, clearSessionId, evictByClaudeSessionId, rebindConversation, addOutputObserver, removeOutputObserver, addCloseObserver, removeCloseObserver, setOutputObserver, clearOutputObserver, setCloseObserver, clearCloseObserver, setPermissionMode, type ChatFile } from './claude.js';
import { listSessions, readSessionMessages, deleteSession, renameSession } from './history.js';
import { listMemoryFiles, updateMemoryFile, deleteMemoryFile } from './memory.js';
import { decodeKey, parseMessage, encryptAndSend } from './encryption.js';
import { setTeamSendFn, setTeamClaudeFns, createTeam, dissolveTeam, getActiveTeam, loadTeam, listTeams, deleteTeam, renameTeam, serializeTeam, type TeamConfig } from './team.js';
import {
  initScheduler,
  shutdownScheduler,
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

const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 10_000;

interface ConnectionState {
  ws: WebSocket | null;
  sessionId: string | null;
  sessionKey: Uint8Array | null;
  reconnectAttempts: number;
  shouldReconnect: boolean;
  workDir: string;
  config: AgentConfig | null;
}

const state: ConnectionState = {
  ws: null,
  sessionId: null,
  sessionKey: null,
  reconnectAttempts: 0,
  shouldReconnect: true,
  workDir: process.cwd(),
  config: null,
};

/**
 * Connect to the relay server. Returns the sessionId on first successful registration.
 * Reconnects are handled internally — this Promise only covers the initial connect.
 */
export function connect(config: AgentConfig): Promise<string> {
  state.workDir = config.dir;
  state.config = config;
  state.shouldReconnect = true;

  // Restore previous sessionId so the session URL survives agent restarts (e.g. upgrade)
  const prev = loadRuntimeState();
  if (prev?.sessionId && prev.server === config.server) {
    state.sessionId = prev.sessionId;
    console.log(`[AgentLink] Restoring session: ${prev.sessionId}`);
  }

  // Wire up the Claude module to send messages through our WebSocket
  setSendFn(send);

  // Wire up the Team module with send and claude dependencies
  setTeamSendFn(send);
  setTeamClaudeFns({
    handleChat: claudeHandleChat,
    cancelExecution: claudeCancelExecution,
    addOutputObserver,
    removeOutputObserver,
    addCloseObserver,
    removeCloseObserver,
    // Deprecated aliases kept for team.ts backward compat
    setOutputObserver,
    clearOutputObserver,
    setCloseObserver,
    clearCloseObserver,
  });

  // Initialize the Loop scheduler
  initScheduler({
    send,
    handleChat: claudeHandleChat,
    cancelExecution: claudeCancelExecution,
    addOutputObserver,
    removeOutputObserver,
    addCloseObserver,
    removeCloseObserver,
  });

  return new Promise((resolve, reject) => {
    doConnect(config, (sessionId) => resolve(sessionId), (err) => reject(err));
  });
}

/**
 * Internal connect. Calls onRegistered on success, onError on failure.
 * For reconnects, both callbacks are no-ops.
 */
function doConnect(
  config: AgentConfig,
  onRegistered: (sessionId: string) => void,
  onError: (err: Error) => void,
): void {
  const wsUrl = buildWsUrl(config);
  console.log(`[AgentLink] Connecting to ${config.server}...${state.sessionId ? ` (session: ${state.sessionId})` : ''}`);

  const ws = new WebSocket(wsUrl);
  state.ws = ws;
  let settled = false;

  ws.on('open', () => {
    state.reconnectAttempts = 0;
    console.log('[AgentLink] Connected to server');
  });

  ws.on('message', async (data) => {
    const raw = data.toString();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error('[AgentLink] Failed to parse message');
      return;
    }

    if (parsed.type === 'registered') {
      const newSessionId = parsed.sessionId as string;
      const previousSessionId = state.sessionId;
      state.sessionId = newSessionId;
      if (typeof parsed.sessionKey === 'string') {
        state.sessionKey = decodeKey(parsed.sessionKey);
      }
      if (!settled) {
        settled = true;
        onRegistered(state.sessionId);
      }
      // Always check for session ID changes and update runtime state
      if (previousSessionId && previousSessionId !== newSessionId) {
        console.warn(`[AgentLink] Session ID changed: ${previousSessionId} → ${newSessionId}`);
        const prev = loadRuntimeState();
        if (prev) {
          const httpBase = (state.config?.server || '')
            .replace(/^wss:/, 'https:')
            .replace(/^ws:/, 'http:');
          saveRuntimeState({
            ...prev,
            sessionId: newSessionId,
            sessionUrl: `${httpBase}/${state.config?.entra ? 'ms' : 's'}/${newSessionId}`,
          });
        }
      }
      console.log(`[AgentLink] Registered, session: ${state.sessionId}`);
    } else {
      const msg = await parseMessage(raw, state.sessionKey);
      if (msg) {
        handleServerMessage(msg as { type: string; [key: string]: unknown });
      } else {
        console.error(`[AgentLink] Failed to decrypt message (key=${state.sessionKey ? 'set' : 'null'}, raw=${raw.slice(0, 120)})`);
      }
    }
  });

  ws.on('close', () => {
    console.log('[AgentLink] Disconnected from server');
    if (state.shouldReconnect) {
      scheduleReconnect(config);
    }
  });

  ws.on('error', (err) => {
    console.error(`[AgentLink] WebSocket error: ${err.message}`);
    // On first connect, reject the promise so index.ts can handle the error.
    // On reconnect, do nothing — close handler will schedule another attempt.
    if (!settled && !state.sessionId) {
      settled = true;
      onError(err);
    }
  });
}

export function disconnect(): void {
  state.shouldReconnect = false;
  abortAllClaude();
  if (state.ws) {
    state.ws.close();
    state.ws = null;
  }
}

let sendQueue = Promise.resolve();

export function send(msg: Record<string, unknown>): void {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    sendQueue = sendQueue.then(() =>
      encryptAndSend(state.ws!, msg, state.sessionKey));
  } else {
    console.warn(`[AgentLink] Cannot send ${msg.type}: WebSocket not open (readyState=${state.ws?.readyState})`);
  }
}

function buildWsUrl(config: AgentConfig): string {
  const base = config.server.replace(/\/$/, '');
  const params = new URLSearchParams({
    type: 'agent',
    id: config.name,
    name: config.name,
    workDir: state.workDir,
    hostname: os.hostname(),
    version: pkg.version,
  });
  // On reconnect, send previous sessionId so the URL stays valid
  if (state.sessionId) {
    params.set('sessionId', state.sessionId);
  } else {
    console.warn('[AgentLink] No sessionId to send on reconnect — server will assign a new one');
  }
  // Send password if configured (server will hash it)
  if (config.password) {
    params.set('password', config.password);
  }
  // Send entra flag if enabled
  if (config.entra) {
    params.set('entra', '1');
  }
  return `${base}/?${params}`;
}

function scheduleReconnect(config: AgentConfig): void {
  const delay = Math.min(
    RECONNECT_BASE_DELAY * Math.pow(1.5, state.reconnectAttempts),
    RECONNECT_MAX_DELAY
  );
  state.reconnectAttempts++;

  console.log(`[AgentLink] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${state.reconnectAttempts})...`);

  setTimeout(() => {
    state.sessionKey = null; // Reset key; new one will come from server
    // On reconnect, callbacks are no-ops — we don't need to resolve/reject anything
    doConnect(config, () => {
      console.log('[AgentLink] Reconnected successfully');
    }, () => {
      // Connection failed, close handler will schedule next attempt
    });
  }, delay);
}

const BRAIN_HOME_DIR = path.resolve(os.homedir(), '.brain', 'BrainCore');

function isBrainHomeDir(dir: string): boolean {
  return path.resolve(dir) === BRAIN_HOME_DIR;
}

function handleServerMessage(msg: { type: string; [key: string]: unknown }): void {
  console.log(`[AgentLink] ← ${msg.type}`);
  switch (msg.type) {
    case 'chat': {
      const chatConvId = (msg as unknown as { conversationId?: string }).conversationId;
      const existingConv = chatConvId ? getConversation(chatConvId) : getConversation();
      const isBrainMode = (msg as unknown as { brainMode?: boolean }).brainMode;
      const chatWorkDir = existingConv?.workDir || state.workDir;
      const effectiveBrainMode = isBrainMode || isBrainHomeDir(chatWorkDir);
      console.log(`[AgentLink] chat: conversationId=${chatConvId}, existingConv.planMode=${existingConv?.planMode}, brainMode=${effectiveBrainMode} (explicit=${isBrainMode}, workDir=${isBrainHomeDir(chatWorkDir)})`);
      const chatOptions: { resumeSessionId?: string; brainMode?: boolean } = {
        resumeSessionId: (msg as unknown as { resumeSessionId?: string }).resumeSessionId,
      };
      if (effectiveBrainMode) {
        chatOptions.brainMode = true;
      }
      claudeHandleChat(
        chatConvId,
        (msg as unknown as { prompt: string }).prompt,
        existingConv?.workDir || state.workDir,
        chatOptions,
        (msg as unknown as { files?: ChatFile[] }).files,
      );
      break;
    }
    case 'cancel_execution':
      claudeCancelExecution((msg as unknown as { conversationId?: string }).conversationId);
      break;
    case 'list_sessions':
      handleListSessions();
      break;
    case 'list_directory':
      handleListDirectory(msg as unknown as { dirPath: string; source?: string }, state.workDir, send);
      break;
    case 'read_file':
      handleReadFile(msg as unknown as { filePath: string }, state.workDir, send);
      break;
    case 'update_file':
      handleUpdateFile(msg as unknown as { filePath: string; content: string }, state.workDir, send);
      break;
    case 'create_file':
      handleCreateFile(msg as unknown as { dirPath: string; fileName: string }, state.workDir, send);
      break;
    case 'create_directory':
      handleCreateDirectory(msg as unknown as { dirPath: string; dirName: string }, state.workDir, send);
      break;
    case 'delete_file':
      handleDeleteFile(msg as unknown as { filePath: string }, state.workDir, send);
      break;
    case 'change_workdir':
      handleChangeWorkDir(msg as unknown as { workDir: string }, state, send, handleListSessions);
      break;
    case 'new_conversation':
      // Backward compat: old web client sends this to reset the single conversation
      abortClaude();
      clearSessionId('default');
      console.log('[AgentLink] New conversation — session cleared');
      break;
    case 'resume_conversation': {
      const m = msg as unknown as { claudeSessionId: string; conversationId?: string };
      const convId = m.conversationId;

      if (!convId) {
        // Backward compat: single-session mode
        const conv = getConversation();
        if (!conv || conv.claudeSessionId !== m.claudeSessionId) {
          abortClaude();
        }
      } else {
        // Multi-session: rebind running conversation to new conversationId
        // (handles page refresh where web client generates a new UUID)
        rebindConversation(m.claudeSessionId, convId);
      }

      const history = readSessionMessages(state.workDir, m.claudeSessionId);
      console.log(`[AgentLink] → conversation_resumed (${history.length} messages, session ${m.claudeSessionId.slice(0, 8)})`);

      // Include live status so the web client can restore compacting/processing state
      // In multi-session mode, look up by conversationId; in single-session mode, use default
      const currentConv = convId ? getConversation(convId) : getConversation();
      const isSameSession = currentConv?.claudeSessionId === m.claudeSessionId
        || currentConv?.lastClaudeSessionId === m.claudeSessionId;

      // Determine plan mode: prefer in-memory state, fallback to history scan
      let planMode: boolean | undefined;
      if (isSameSession) {
        planMode = currentConv?.planMode === true;
      } else if (history.length > 0) {
        // No in-memory state — scan history for the last EnterPlanMode/ExitPlanMode tool
        for (let i = history.length - 1; i >= 0; i--) {
          const h = history[i];
          if (h.role === 'tool' && (h.toolName === 'EnterPlanMode' || h.toolName === 'ExitPlanMode')) {
            planMode = h.toolName === 'EnterPlanMode';
            break;
          }
        }
      }

      // Determine brain mode from persisted metadata or workDir
      const sessionMeta = loadSessionMetadata(m.claudeSessionId);
      const resumeBrainMode = sessionMeta.brainMode || isBrainHomeDir(state.workDir);

      send({
        type: 'conversation_resumed',
        conversationId: convId,
        claudeSessionId: m.claudeSessionId,
        history,
        isCompacting: isSameSession && (convId ? getIsCompacting(convId) : getIsCompacting()),
        isProcessing: isSameSession && currentConv?.turnActive === true,
        planMode,
        brainMode: resumeBrainMode,
      });
      break;
    }
    case 'ask_user_answer': {
      const m = msg as unknown as { requestId: string; answers: Record<string, unknown> };
      handleUserAnswer(m.requestId, m.answers);
      break;
    }
    case 'delete_session': {
      const m = msg as unknown as { sessionId: string };
      handleDeleteSession(m.sessionId);
      break;
    }
    case 'rename_session': {
      const m = msg as unknown as { sessionId: string; newTitle: string };
      handleRenameSession(m.sessionId, m.newTitle);
      break;
    }
    case 'query_active_conversations': {
      const active: Array<{ conversationId: string; claudeSessionId: string | null; isProcessing: boolean; isCompacting: boolean }> = [];
      for (const [convId, conv] of getConversations()) {
        if (conv.turnActive) {
          active.push({
            conversationId: convId,
            claudeSessionId: conv.claudeSessionId,
            isProcessing: true,
            isCompacting: getIsCompacting(convId),
          });
        }
      }
      const activeTeamState = getActiveTeam();
      // Collect running loop executions for status recovery
      const runningLoops: Array<{ executionId: string; loopId: string; conversationId?: string }> = [];
      for (const [execId, exec] of getRunningExecutions()) {
        runningLoops.push({ executionId: execId, loopId: exec.loopId, conversationId: exec.conversationId });
      }
      console.log(`[AgentLink] → active_conversations (${active.length} active)`);
      send({
        type: 'active_conversations',
        conversations: active,
        activeTeam: activeTeamState ? serializeTeam(activeTeamState) : null,
        runningLoopExecutions: runningLoops,
      });
      break;
    }
    case 'create_team': {
      const m = msg as unknown as { instruction: string; template?: string; leadPrompt?: string; agents?: Record<string, unknown> };
      try {
        createTeam({
          instruction: m.instruction,
          template: m.template,
          leadPrompt: m.leadPrompt,
          agents: m.agents as TeamConfig['agents'],
        }, state.workDir);
      } catch (err) {
        send({ type: 'error', message: (err as Error).message });
      }
      break;
    }
    case 'dissolve_team':
      dissolveTeam();
      break;
    case 'list_teams':
      send({ type: 'teams_list', teams: listTeams(state.workDir) });
      break;
    case 'get_team': {
      const m = msg as unknown as { teamId: string };
      const active = getActiveTeam();
      if (active && active.teamId === m.teamId) {
        send({ type: 'team_detail', team: serializeTeam(active) });
      } else {
        const team = loadTeam(m.teamId);
        if (team) {
          send({ type: 'team_detail', team: serializeTeam(team) });
        } else {
          send({ type: 'error', message: `Team not found: ${m.teamId}` });
        }
      }
      break;
    }
    case 'get_team_agent_history': {
      const m = msg as unknown as { teamId: string; agentId: string };
      const active = getActiveTeam();
      if (active && active.teamId === m.teamId) {
        if (m.agentId === 'lead') {
          send({ type: 'team_agent_history', teamId: m.teamId, agentId: 'lead', messages: active.leadMessages || [] });
        } else {
          const agent = active.agents.get(m.agentId);
          if (agent) {
            send({ type: 'team_agent_history', teamId: m.teamId, agentId: m.agentId, messages: agent.messages });
          } else {
            send({ type: 'error', message: `Agent not found: ${m.agentId}` });
          }
        }
      } else {
        // Historical team — load from disk (messages are persisted)
        const team = loadTeam(m.teamId);
        if (team) {
          if (m.agentId === 'lead') {
            send({ type: 'team_agent_history', teamId: m.teamId, agentId: 'lead', messages: team.leadMessages || [] });
          } else if (team.agents.has(m.agentId)) {
            const agent = team.agents.get(m.agentId)!;
            send({ type: 'team_agent_history', teamId: m.teamId, agentId: m.agentId, messages: agent.messages });
          } else {
            send({ type: 'error', message: `Agent not found: ${m.agentId}` });
          }
        } else {
          send({ type: 'error', message: `Team not found: ${m.teamId}` });
        }
      }
      break;
    }
    case 'delete_team': {
      const m = msg as unknown as { teamId: string };
      const active = getActiveTeam();
      if (active && active.teamId === m.teamId) {
        send({ type: 'error', message: 'Cannot delete an active team.' });
        break;
      }
      const deleted = deleteTeam(m.teamId);
      if (deleted) {
        send({ type: 'team_deleted', teamId: m.teamId });
      } else {
        send({ type: 'error', message: 'Team not found or could not be deleted.' });
      }
      break;
    }
    case 'rename_team': {
      const m = msg as unknown as { teamId: string; newTitle: string };
      const active = getActiveTeam();
      // If renaming the active team, update in-memory state too
      if (active && active.teamId === m.teamId) {
        active.title = m.newTitle;
      }
      const renamed = renameTeam(m.teamId, m.newTitle);
      if (renamed) {
        send({ type: 'team_renamed', teamId: m.teamId, newTitle: m.newTitle });
      } else {
        send({ type: 'error', message: 'Team not found or could not be renamed.' });
      }
      break;
    }
    // ── Loop (Scheduled Tasks) handlers ────────────────────────────────
    case 'create_loop': {
      const m = msg as unknown as {
        name: string;
        prompt: string;
        schedule: string;
        scheduleType: 'hourly' | 'daily' | 'weekly' | 'cron';
        scheduleConfig: { hour?: number; minute?: number; dayOfWeek?: number };
      };
      try {
        const loop = createLoop({
          name: m.name,
          prompt: m.prompt,
          schedule: m.schedule,
          scheduleType: m.scheduleType,
          scheduleConfig: m.scheduleConfig,
          workDir: state.workDir,
        });
        send({ type: 'loop_created', loop });
      } catch (err) {
        send({ type: 'error', message: (err as Error).message });
      }
      break;
    }
    case 'update_loop': {
      const m = msg as unknown as {
        loopId: string;
        updates: Partial<{
          name: string;
          prompt: string;
          schedule: string;
          scheduleType: 'hourly' | 'daily' | 'weekly' | 'cron';
          scheduleConfig: { hour?: number; minute?: number; dayOfWeek?: number };
          enabled: boolean;
        }>;
      };
      try {
        const loop = updateLoop(m.loopId, m.updates);
        if (loop) {
          send({ type: 'loop_updated', loop });
        } else {
          send({ type: 'error', message: `Loop not found: ${m.loopId}` });
        }
      } catch (err) {
        send({ type: 'error', message: (err as Error).message });
      }
      break;
    }
    case 'delete_loop': {
      const m = msg as unknown as { loopId: string };
      const deleted = deleteLoop(m.loopId);
      if (deleted) {
        send({ type: 'loop_deleted', loopId: m.loopId });
      } else {
        send({ type: 'error', message: 'Loop not found or could not be deleted.' });
      }
      break;
    }
    case 'list_loops':
      send({ type: 'loops_list', loops: listLoops(state.workDir) });
      break;
    case 'get_loop': {
      const m = msg as unknown as { loopId: string };
      const loop = getLoop(m.loopId);
      if (loop) {
        send({ type: 'loop_detail', loop });
      } else {
        send({ type: 'error', message: `Loop not found: ${m.loopId}` });
      }
      break;
    }
    case 'run_loop': {
      const m = msg as unknown as { loopId: string };
      try {
        runLoopNow(m.loopId);
      } catch (err) {
        send({ type: 'error', message: (err as Error).message });
      }
      break;
    }
    case 'cancel_loop_execution': {
      const m = msg as unknown as { loopId: string };
      cancelLoopExecution(m.loopId);
      break;
    }
    case 'list_loop_executions': {
      const m = msg as unknown as { loopId: string; limit?: number };
      const executions = listLoopExecutions(m.loopId, m.limit);
      send({ type: 'loop_executions_list', loopId: m.loopId, executions });
      break;
    }
    case 'get_loop_execution_messages': {
      const m = msg as unknown as { loopId: string; executionId: string };
      const messages = getLoopExecutionMessages(m.loopId, m.executionId);
      send({ type: 'loop_execution_messages', loopId: m.loopId, executionId: m.executionId, messages });
      break;
    }
    case 'query_loop_status': {
      const running: Array<{ executionId: string; loopId: string; conversationId?: string }> = [];
      for (const [execId, exec] of getRunningExecutions()) {
        running.push({ executionId: execId, loopId: exec.loopId, conversationId: exec.conversationId });
      }
      send({ type: 'loop_status', loops: listLoops(), runningExecutions: running });
      break;
    }
    case 'ping':
      send({ type: 'pong', ts: (msg as unknown as { ts: number }).ts });
      break;
    case 'list_memory': {
      const result = listMemoryFiles(state.workDir);
      send({ type: 'memory_list', memoryDir: result.memoryDir, files: result.files });
      break;
    }
    case 'update_memory': {
      const { filename, content } = msg as unknown as { filename: string; content: string };
      const result = updateMemoryFile(state.workDir, filename, content);
      send({ type: 'memory_updated', filename, ...result });
      break;
    }
    case 'delete_memory': {
      const { filename } = msg as unknown as { filename: string };
      const result = deleteMemoryFile(state.workDir, filename);
      send({ type: 'memory_deleted', filename, ...result });
      break;
    }
    case 'btw_question': {
      const { question, conversationId, claudeSessionId } = msg as unknown as { question: string; conversationId?: string; claudeSessionId?: string };
      handleBtwQuestion(question, conversationId, state.workDir, send, claudeSessionId);
      break;
    }
    case 'set_plan_mode': {
      const { enabled, conversationId, claudeSessionId } = msg as unknown as {
        enabled: boolean;
        conversationId?: string;
        claudeSessionId?: string;
      };
      const mode = enabled ? 'plan' : 'bypassPermissions';
      console.log(`[AgentLink] set_plan_mode: enabled=${enabled}, conversationId=${conversationId}`);
      const result = setPermissionMode(conversationId, mode, claudeSessionId);

      if (result === 'injected') {
        // Process was idle — setPermissionMode already injected Enter/ExitPlanMode
        // into the running process. Output flows through normal pipeline.
        // Just tell UI right away.
        send({ type: 'plan_mode_changed', enabled, conversationId });
      } else {
        // Immediate path — process was killed/recreated or placeholder created.
        send({ type: 'plan_mode_changed', enabled, conversationId, immediate: true });

        // When exiting plan mode, spawn Claude to record ExitPlanMode in the
        // JSONL so it doesn't think it's still in plan mode on next resume.
        const convId = conversationId || 'default';
        const conv = getConversation(convId);
        const sessionToFix = conv?.lastClaudeSessionId || claudeSessionId;
        if (!enabled && sessionToFix) {
          claudeHandleChat(conversationId, 'Exit plan mode now.', conv?.workDir || state.workDir, { resumeSessionId: sessionToFix });
        }
      }
      break;
    }
    case 'git_status':
      handleGitStatus(msg, state.workDir, send);
      break;
    case 'git_diff':
      handleGitDiff(msg as unknown as { filePath: string; staged?: boolean; untracked?: boolean; type: string }, state.workDir, send);
      break;
    case 'git_stage':
      handleGitStage(msg as unknown as { files: string[]; type: string }, state.workDir, send);
      break;
    case 'git_unstage':
      handleGitUnstage(msg as unknown as { files: string[]; type: string }, state.workDir, send);
      break;
    case 'git_discard':
      handleGitDiscard(msg as unknown as { files: string[]; type: string }, state.workDir, send);
      break;
    case 'git_commit':
      handleGitCommit(msg as unknown as { message: string; type: string }, state.workDir, send);
      break;
    default:
      console.log(`[AgentLink] Unhandled server message: ${msg.type}`);
      send({ type: 'error', message: `Unsupported command: ${msg.type}. Please upgrade your agent: agentlink-client upgrade` });
  }
}

function handleListSessions(): void {
  try {
    const sessions = listSessions(state.workDir);
    const metaMap = loadAllSessionMetadata();
    const isBrainHome = isBrainHomeDir(state.workDir);
    const enriched = sessions.map(s => ({
      ...s,
      ...metaMap.get(s.sessionId),
      // All sessions under Brain Home are brain sessions
      ...(isBrainHome ? { brainMode: true } : {}),
    }));
    console.log(`[AgentLink] → sessions_list (${sessions.length} sessions for ${state.workDir}, brainHome=${isBrainHome})`);
    send({ type: 'sessions_list', sessions: enriched, workDir: state.workDir });
  } catch (err) {
    console.error(`[AgentLink] listSessions failed:`, err);
    send({ type: 'sessions_list', sessions: [], workDir: state.workDir });
  }
}

function handleDeleteSession(sessionId: string): void {
  // Evict any idle conversation holding this session; block if busy
  if (evictByClaudeSessionId(sessionId)) {
    send({ type: 'error', message: 'Cannot delete a session while it is processing.' });
    return;
  }
  const deleted = deleteSession(state.workDir, sessionId);
  if (deleted) {
    deleteSessionMetadata(sessionId);
    send({ type: 'session_deleted', sessionId });
  } else {
    send({ type: 'error', message: 'Session not found or could not be deleted.' });
  }
}

function handleRenameSession(sessionId: string, newTitle: string): void {
  const renamed = renameSession(state.workDir, sessionId, newTitle);
  if (renamed) {
    send({ type: 'session_renamed', sessionId, newTitle });
  } else {
    send({ type: 'error', message: 'Session not found or could not be renamed.' });
  }
}
