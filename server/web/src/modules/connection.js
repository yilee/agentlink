// ── WebSocket connection, message routing, reconnection ──────────────────────
import { encrypt, decrypt, isEncrypted, decodeKey } from './encryption.js';
import { routeToBackgroundConversation } from './backgroundRouting.js';
import { createClaudeOutputHandlers } from './handlers/claude-output-handler.js';
import { createSessionHandlers } from './handlers/session-handler.js';
import { createExecutionHandlers } from './handlers/execution-handler.js';
import { createFileHandlers } from './handlers/file-handler.js';
import { createFeatureHandlers } from './handlers/feature-handler.js';

const MAX_RECONNECT_ATTEMPTS = 50;
const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 15000;

/**
 * Creates the WebSocket connection controller.
 * @param {object} deps - All reactive state and callbacks needed
 */
export function createConnection(deps) {
  const {
    status, agentName, hostname, workDir, sessionId, error,
    serverVersion, agentVersion, latency,
    messages, isProcessing, isCompacting, queuedMessages,
    historySessions, loadingSessions, loadingHistory,
    authRequired, authPassword, authError, authAttempts, authLocked,
    streaming, sidebar,
    scrollToBottom,
    workdirSwitching,
    // Multi-session parallel
    currentConversationId, processingConversations, conversationCache,
    // i18n
    t,
  } = deps;

  // Dequeue callback — set after creation to resolve circular dependency
  let _dequeueNext = () => {};
  function setDequeueNext(fn) { _dequeueNext = fn; }

  // Late-binding setters for circular dependencies
  let fileBrowser = null;
  function setFileBrowser(fb) { fileBrowser = fb; }
  let filePreview = null;
  function setFilePreview(fp) { filePreview = fp; }
  let team = null;
  function setTeam(t) { team = t; }
  let loop = null;
  function setLoop(l) { loop = l; }

  let ws = null;
  let sessionKey = null;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let pingTimer = null;
  let idleCheckTimer = null;
  const toolMsgMap = new Map();

  // ── toolMsgMap save/restore for conversation switching ──
  function getToolMsgMap() { return new Map(toolMsgMap); }
  function restoreToolMsgMap(map) { toolMsgMap.clear(); for (const [k, v] of map) toolMsgMap.set(k, v); }
  function clearToolMsgMap() { toolMsgMap.clear(); }

  function wsSend(msg) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (sessionKey) {
      const encrypted = encrypt(msg, sessionKey);
      ws.send(JSON.stringify(encrypted));
    } else {
      ws.send(JSON.stringify(msg));
    }
  }

  function startPing() {
    stopPing();
    wsSend({ type: 'ping', ts: Date.now() });
    pingTimer = setInterval(() => {
      wsSend({ type: 'ping', ts: Date.now() });
    }, 10000);
  }

  function stopPing() {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    latency.value = null;
  }

  // Idle-check: if isProcessing stays true with no claude_output for 15s,
  // poll the agent to reconcile stale state.
  const IDLE_CHECK_MS = 15000;
  function resetIdleCheck() {
    if (idleCheckTimer) { clearTimeout(idleCheckTimer); idleCheckTimer = null; }
    if (isProcessing.value) {
      idleCheckTimer = setTimeout(() => {
        idleCheckTimer = null;
        if (isProcessing.value) wsSend({ type: 'query_active_conversations' });
      }, IDLE_CHECK_MS);
    }
  }
  function clearIdleCheck() {
    if (idleCheckTimer) { clearTimeout(idleCheckTimer); idleCheckTimer = null; }
  }

  function getSessionId() {
    const match = window.location.pathname.match(/^\/s\/([^/]+)/);
    return match ? match[1] : null;
  }

  // ── Create handler modules ──
  // Shared deps object for handlers.
  // ⚠️  The getters below are LATE-BOUND — the underlying variables are set
  //    AFTER the handler factories run (via setDequeueNext / setFileBrowser / …).
  //    DO NOT destructure or spread these properties (e.g. `const { fileBrowser } = deps`
  //    or `{ ...handlerDeps }`), as that evaluates the getter once and captures a
  //    stale null / no-op value. Always access them as `deps.xxx` at call time.
  const handlerDeps = {
    ...deps,
    toolMsgMap,
    resetIdleCheck,
    clearIdleCheck,
    wsSend,
    get dequeueNext() { return _dequeueNext; },   // late-bound — see warning above
    get fileBrowser() { return fileBrowser; },     // late-bound
    get filePreview() { return filePreview; },     // late-bound
    get team() { return team; },                   // late-bound
    get loop() { return loop; },                   // late-bound
  };

  const claudeHandlers = createClaudeOutputHandlers(handlerDeps);
  handlerDeps.finalizeStreamingMsg = claudeHandlers.finalizeStreamingMsg;
  const sessionHandlers = createSessionHandlers(handlerDeps);
  const executionHandlers = createExecutionHandlers(handlerDeps);
  const fileHandlers = createFileHandlers(handlerDeps);
  const featureHandlers = createFeatureHandlers(handlerDeps);

  // Dispatch map: message type → handler(msg, scheduleHighlight)
  const handlers = {
    ...claudeHandlers,
    ...sessionHandlers,
    ...executionHandlers,
    ...fileHandlers,
    ...featureHandlers,
  };

  function connect(scheduleHighlight) {
    const sid = getSessionId();
    if (!sid) {
      status.value = 'No Session';
      error.value = t('error.noSessionId');
      return;
    }
    sessionId.value = sid;
    status.value = 'Connecting...';
    error.value = '';

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let wsUrl = `${protocol}//${window.location.host}/?type=web&sessionId=${sid}`;
    const savedToken = localStorage.getItem(`agentlink-auth-${sid}`);
    if (savedToken) {
      wsUrl += `&authToken=${encodeURIComponent(savedToken)}`;
    }
    ws = new WebSocket(wsUrl);

    ws.onopen = () => { error.value = ''; reconnectAttempts = 0; };

    ws.onmessage = (event) => {
      let msg;
      const parsed = JSON.parse(event.data);

      // Auth messages are always plaintext (before session key exchange)
      if (parsed.type === 'auth_required') {
        authRequired.value = true;
        authError.value = '';
        authLocked.value = false;
        status.value = 'Authentication Required';
        return;
      }
      if (parsed.type === 'auth_failed') {
        authError.value = parsed.message || t('error.incorrectPassword');
        authAttempts.value = parsed.attemptsRemaining != null
          ? t('error.attemptsRemaining', { n: parsed.attemptsRemaining })
          : null;
        authPassword.value = '';
        return;
      }
      if (parsed.type === 'auth_locked') {
        authLocked.value = true;
        authRequired.value = false;
        authError.value = parsed.message || t('error.tooManyAttempts');
        status.value = 'Locked';
        return;
      }

      // Decrypt
      if (parsed.type === 'connected') {
        msg = parsed;
        if (typeof parsed.sessionKey === 'string') {
          sessionKey = decodeKey(parsed.sessionKey);
        }
      } else if (sessionKey && isEncrypted(parsed)) {
        msg = decrypt(parsed, sessionKey);
        if (!msg) {
          console.error('[WS] Failed to decrypt message');
          return;
        }
      } else {
        msg = parsed;
      }

      // ── Team messages: route before normal conversation routing ──
      if (team && (msg.type?.startsWith('team_') || msg.type === 'teams_list' || (msg.type === 'claude_output' && msg.teamId))) {
        if (msg.type === 'claude_output' && msg.teamId) {
          team.handleTeamAgentOutput(msg);
        } else {
          team.handleTeamMessage(msg);
        }
        return;
      }

      // ── Loop messages: route before normal conversation routing ──
      if (loop && (msg.type?.startsWith('loop_') || msg.type === 'loops_list')) {
        loop.handleLoopMessage(msg);
        return;
      }

      // ── Multi-session: route messages to background conversations ──
      if (msg.conversationId && currentConversationId
          && currentConversationId.value
          && msg.conversationId !== currentConversationId.value) {
        routeToBackgroundConversation({ conversationCache, processingConversations, activeClaudeSessions: deps.activeClaudeSessions, sidebar, wsSend }, msg.conversationId, msg);
        return;
      }

      // ── Connection lifecycle (stays inline — tightly coupled to ws state) ──
      if (msg.type === 'connected') {
        handleConnected(msg, scheduleHighlight);
      } else if (msg.type === 'pong') {
        if (typeof msg.ts === 'number') latency.value = Date.now() - msg.ts;
      } else if (msg.type === 'agent_disconnected') {
        handleAgentDisconnected();
      } else if (msg.type === 'agent_reconnected') {
        handleAgentReconnected(msg, scheduleHighlight);
      } else if (msg.type === 'active_conversations') {
        handleActiveConversations(msg);
      } else if (msg.type === 'error') {
        handleError(msg, scheduleHighlight);
      } else {
        // Dispatch to extracted handler modules
        const handler = handlers[msg.type];
        if (handler) handler(msg, scheduleHighlight);
      }
    };

    ws.onclose = () => {
      sessionKey = null;
      stopPing();
      clearIdleCheck();
      const wasConnected = status.value === 'Connected' || status.value === 'Connecting...';
      isProcessing.value = false;
      isCompacting.value = false;
      queuedMessages.value = [];
      loadingSessions.value = false;
      loadingHistory.value = false;

      if (authLocked.value || authRequired.value) return;
      if (wasConnected || reconnectAttempts > 0) {
        scheduleReconnect(scheduleHighlight);
      }
    };

    ws.onerror = () => {};
  }

  // ── Connection lifecycle handlers (inline — depend on ws/ping/session state) ──

  function handleConnected(msg, scheduleHighlight) {
    authRequired.value = false;
    authPassword.value = '';
    authError.value = '';
    authAttempts.value = null;
    authLocked.value = false;
    if (msg.authToken) {
      localStorage.setItem(`agentlink-auth-${sessionId.value}`, msg.authToken);
    }
    if (msg.serverVersion) serverVersion.value = msg.serverVersion;
    if (msg.agent) {
      status.value = 'Connected';
      agentName.value = msg.agent.name;
      hostname.value = msg.agent.hostname || '';
      workDir.value = msg.agent.workDir;
      agentVersion.value = msg.agent.version || '';
      sidebar.loadWorkdirHistory();
      sidebar.addToWorkdirHistory(msg.agent.workDir);
      const savedDir = localStorage.getItem(`agentlink-workdir-${sessionId.value}`);
      if (savedDir && savedDir !== msg.agent.workDir) {
        workdirSwitching.value = true;
        setTimeout(() => { workdirSwitching.value = false; }, 10000);
        wsSend({ type: 'change_workdir', workDir: savedDir });
      }
      sidebar.requestSessionList();
      if (team) team.requestTeamsList();
      if (loop) loop.requestLoopsList();
      startPing();
      wsSend({ type: 'query_active_conversations' });
    } else {
      status.value = 'Waiting';
      error.value = t('error.agentNotConnected');
    }
  }

  function handleAgentDisconnected() {
    stopPing();
    status.value = 'Waiting';
    agentName.value = '';
    hostname.value = '';
    error.value = t('error.agentDisconnected');
    isProcessing.value = false;
    isCompacting.value = false;
    queuedMessages.value = [];
    loadingSessions.value = false;
    if (conversationCache) {
      for (const [convId, cached] of Object.entries(conversationCache.value)) {
        cached.isProcessing = false;
        cached.isCompacting = false;
        processingConversations.value[convId] = false;
      }
    }
    if (currentConversationId && currentConversationId.value) {
      processingConversations.value[currentConversationId.value] = false;
    }
    if (deps.activeClaudeSessions) {
      deps.activeClaudeSessions.value = new Set();
    }
  }

  function handleAgentReconnected(msg, scheduleHighlight) {
    status.value = 'Connected';
    error.value = '';
    if (msg.agent) {
      agentName.value = msg.agent.name;
      hostname.value = msg.agent.hostname || '';
      workDir.value = msg.agent.workDir;
      agentVersion.value = msg.agent.version || '';
      sidebar.addToWorkdirHistory(msg.agent.workDir);
    }
    sidebar.requestSessionList();
    if (team) team.requestTeamsList();
    if (loop) loop.requestLoopsList();
    startPing();
    wsSend({ type: 'query_active_conversations' });
  }

  function handleActiveConversations(msg) {
    const activeSet = new Set();
    const convs = msg.conversations || [];
    for (const entry of convs) {
      if (entry.conversationId) activeSet.add(entry.conversationId);
    }

    const wasForegroundProcessing = isProcessing.value;
    if (!activeSet.has(currentConversationId && currentConversationId.value)) {
      isProcessing.value = false;
      isCompacting.value = false;
    }
    if (conversationCache) {
      for (const [convId, cached] of Object.entries(conversationCache.value)) {
        if (!activeSet.has(convId)) {
          cached.isProcessing = false;
          cached.isCompacting = false;
        }
      }
    }
    if (processingConversations) {
      for (const convId of Object.keys(processingConversations.value)) {
        if (!activeSet.has(convId)) {
          processingConversations.value[convId] = false;
        }
      }
    }

    for (const entry of convs) {
      const convId = entry.conversationId;
      if (!convId) continue;
      if (currentConversationId && currentConversationId.value === convId) {
        isProcessing.value = true;
        isCompacting.value = !!entry.isCompacting;
        if (entry.claudeSessionId && deps.currentClaudeSessionId) {
          deps.currentClaudeSessionId.value = entry.claudeSessionId;
        }
      } else if (conversationCache && conversationCache.value[convId]) {
        const cached = conversationCache.value[convId];
        cached.isProcessing = true;
        cached.isCompacting = !!entry.isCompacting;
      }
      if (processingConversations) {
        processingConversations.value[convId] = true;
      }
    }

    // Track active claudeSessionIds so sidebar can show processing indicators
    // even for conversations that don't match the current foreground conversationId
    // (e.g. after page refresh when the conversationId is new but claude is still processing)
    if (deps.activeClaudeSessions) {
      const activeSet = new Set();
      for (const entry of convs) {
        if (entry.claudeSessionId) activeSet.add(entry.claudeSessionId);
      }
      deps.activeClaudeSessions.value = activeSet;
    }

    if (team && msg.activeTeam) {
      team.handleActiveTeamRestore(msg.activeTeam, workDir.value);
    }
    resetIdleCheck();
    if (wasForegroundProcessing && !isProcessing.value) _dequeueNext();
  }

  function handleError(msg, scheduleHighlight) {
    // Route btw-related errors to the overlay
    if (deps.btwPending && deps.btwPending.value && msg.message && msg.message.includes('btw_question')) {
      deps.btwPending.value = false;
      if (deps.btwState && deps.btwState.value) {
        deps.btwState.value.error = msg.message;
        deps.btwState.value.done = true;
      }
      return;
    }
    streaming.flushReveal();
    claudeHandlers.finalizeStreamingMsg(scheduleHighlight);
    messages.value.push({
      id: streaming.nextId(), role: 'system',
      content: msg.message, isError: true,
      timestamp: new Date(),
    });
    deps.scrollToBottom();
    isProcessing.value = false;
    isCompacting.value = false;
    loadingSessions.value = false;
    clearIdleCheck();
    if (currentConversationId && currentConversationId.value) {
      processingConversations.value[currentConversationId.value] = false;
    }
    if (loop && loop.loopError) {
      loop.loopError.value = msg.message || '';
    }
    _dequeueNext();
  }

  function scheduleReconnect(scheduleHighlight) {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      status.value = 'Disconnected';
      error.value = t('error.unableToReconnect');
      return;
    }
    const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(1.5, reconnectAttempts), RECONNECT_MAX_DELAY);
    reconnectAttempts++;
    status.value = 'Reconnecting...';
    error.value = t('error.connectionLost', { n: reconnectAttempts });
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(scheduleHighlight); }, delay);
  }

  function closeWs() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) ws.close();
  }

  function submitPassword() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const pwd = authPassword.value.trim();
    if (!pwd) return;
    ws.send(JSON.stringify({ type: 'authenticate', password: pwd }));
  }

  return { connect, wsSend, closeWs, submitPassword, setDequeueNext, setFileBrowser, setFilePreview, setTeam, setLoop, getToolMsgMap, restoreToolMsgMap, clearToolMsgMap };
}
