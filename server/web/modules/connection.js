// ── WebSocket connection, message routing, reconnection ──────────────────────
import { encrypt, decrypt, isEncrypted, decodeKey } from '../encryption.js';
import { isContextSummary } from './messageHelpers.js';

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
    serverVersion, agentVersion,
    messages, isProcessing, isCompacting, visibleLimit, queuedMessages,
    historySessions, currentClaudeSessionId, loadingSessions, loadingHistory,
    folderPickerLoading, folderPickerEntries, folderPickerPath,
    authRequired, authPassword, authError, authAttempts, authLocked,
    streaming, sidebar,
    scrollToBottom,
  } = deps;

  // Dequeue callback — set after creation to resolve circular dependency
  let _dequeueNext = () => {};
  function setDequeueNext(fn) { _dequeueNext = fn; }

  let ws = null;
  let sessionKey = null;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  const toolMsgMap = new Map(); // toolId -> message (for fast tool_result lookup)

  function wsSend(msg) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (sessionKey) {
      const encrypted = encrypt(msg, sessionKey);
      ws.send(JSON.stringify(encrypted));
    } else {
      ws.send(JSON.stringify(msg));
    }
  }

  function getSessionId() {
    const match = window.location.pathname.match(/^\/s\/([^/]+)/);
    return match ? match[1] : null;
  }

  function finalizeStreamingMsg(scheduleHighlight) {
    const sid = streaming.getStreamingMessageId();
    if (sid === null) return;
    const streamMsg = messages.value.find(m => m.id === sid);
    if (streamMsg) {
      streamMsg.isStreaming = false;
      if (isContextSummary(streamMsg.content)) {
        streamMsg.role = 'context-summary';
        streamMsg.contextExpanded = false;
      }
    }
    streaming.setStreamingMessageId(null);
    if (scheduleHighlight) scheduleHighlight();
  }

  function handleClaudeOutput(msg, scheduleHighlight) {
    const data = msg.data;
    if (!data) return;

    if (data.type === 'content_block_delta' && data.delta) {
      streaming.appendPending(data.delta);
      streaming.startReveal();
      return;
    }

    if (data.type === 'tool_use' && data.tools) {
      streaming.flushReveal();
      finalizeStreamingMsg(scheduleHighlight);

      for (const tool of data.tools) {
        const toolMsg = {
          id: streaming.nextId(), role: 'tool',
          toolId: tool.id, toolName: tool.name || 'unknown',
          toolInput: tool.input ? JSON.stringify(tool.input, null, 2) : '',
          hasResult: false, expanded: (tool.name === 'Edit' || tool.name === 'TodoWrite'), timestamp: new Date(),
        };
        messages.value.push(toolMsg);
        if (tool.id) toolMsgMap.set(tool.id, toolMsg);
      }
      scrollToBottom();
      return;
    }

    if (data.type === 'user' && data.tool_use_result) {
      const result = data.tool_use_result;
      const results = Array.isArray(result) ? result : [result];
      for (const r of results) {
        const toolMsg = toolMsgMap.get(r.tool_use_id);
        if (toolMsg) {
          toolMsg.toolOutput = typeof r.content === 'string'
            ? r.content : JSON.stringify(r.content, null, 2);
          toolMsg.hasResult = true;
        }
      }
      scrollToBottom();
      return;
    }
  }

  function connect(scheduleHighlight) {
    const sid = getSessionId();
    if (!sid) {
      status.value = 'No Session';
      error.value = 'No session ID in URL. Use a session URL provided by agentlink start.';
      return;
    }
    sessionId.value = sid;
    status.value = 'Connecting...';
    error.value = '';

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let wsUrl = `${protocol}//${window.location.host}/?type=web&sessionId=${sid}`;
    // Include saved auth token for automatic re-authentication
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
        authError.value = parsed.message || 'Incorrect password.';
        authAttempts.value = parsed.attemptsRemaining != null
          ? `${parsed.attemptsRemaining} attempt${parsed.attemptsRemaining !== 1 ? 's' : ''} remaining`
          : null;
        authPassword.value = '';
        return;
      }
      if (parsed.type === 'auth_locked') {
        authLocked.value = true;
        authRequired.value = false;
        authError.value = parsed.message || 'Too many failed attempts.';
        status.value = 'Locked';
        return;
      }

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

      if (msg.type === 'connected') {
        // Reset auth state
        authRequired.value = false;
        authPassword.value = '';
        authError.value = '';
        authAttempts.value = null;
        authLocked.value = false;
        // Save auth token for automatic re-authentication
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
            wsSend({ type: 'change_workdir', workDir: savedDir });
          }
          sidebar.requestSessionList();
        } else {
          status.value = 'Waiting';
          error.value = 'Agent is not connected yet.';
        }
      } else if (msg.type === 'agent_disconnected') {
        status.value = 'Waiting';
        agentName.value = '';
        hostname.value = '';
        error.value = 'Agent disconnected. Waiting for reconnect...';
        isProcessing.value = false;
        isCompacting.value = false;
        queuedMessages.value = [];
        loadingSessions.value = false;
      } else if (msg.type === 'agent_reconnected') {
        status.value = 'Connected';
        error.value = '';
        if (msg.agent) {
          agentName.value = msg.agent.name;
          hostname.value = msg.agent.hostname || '';
          workDir.value = msg.agent.workDir;
          agentVersion.value = msg.agent.version || '';
          workDir.value = msg.agent.workDir;
          sidebar.addToWorkdirHistory(msg.agent.workDir);
        }
        sidebar.requestSessionList();
      } else if (msg.type === 'error') {
        streaming.flushReveal();
        finalizeStreamingMsg(scheduleHighlight);
        messages.value.push({
          id: streaming.nextId(), role: 'system',
          content: msg.message, isError: true,
          timestamp: new Date(),
        });
        scrollToBottom();
        isProcessing.value = false;
        isCompacting.value = false;
        loadingSessions.value = false;
        _dequeueNext();
      } else if (msg.type === 'claude_output') {
        handleClaudeOutput(msg, scheduleHighlight);
      } else if (msg.type === 'command_output') {
        streaming.flushReveal();
        finalizeStreamingMsg(scheduleHighlight);
        messages.value.push({
          id: streaming.nextId(), role: 'system',
          content: msg.content, isCommandOutput: true,
          timestamp: new Date(),
        });
        scrollToBottom();
      } else if (msg.type === 'context_compaction') {
        if (msg.status === 'started') {
          isCompacting.value = true;
          messages.value.push({
            id: streaming.nextId(), role: 'system',
            content: 'Context compacting...', isCompactStart: true,
            timestamp: new Date(),
          });
          scrollToBottom();
        } else if (msg.status === 'completed') {
          isCompacting.value = false;
          // Update the start message to show completed
          const startMsg = [...messages.value].reverse().find(m => m.isCompactStart && !m.compactDone);
          if (startMsg) {
            startMsg.content = 'Context compacted';
            startMsg.compactDone = true;
          }
          scrollToBottom();
        }
      } else if (msg.type === 'turn_completed' || msg.type === 'execution_cancelled') {
        streaming.flushReveal();
        finalizeStreamingMsg(scheduleHighlight);
        isProcessing.value = false;
        isCompacting.value = false;
        toolMsgMap.clear();
        if (msg.type === 'execution_cancelled') {
          messages.value.push({
            id: streaming.nextId(), role: 'system',
            content: 'Generation stopped.', timestamp: new Date(),
          });
          scrollToBottom();
        }
        _dequeueNext();
      } else if (msg.type === 'ask_user_question') {
        streaming.flushReveal();
        finalizeStreamingMsg(scheduleHighlight);
        for (let i = messages.value.length - 1; i >= 0; i--) {
          const m = messages.value[i];
          if (m.role === 'tool' && m.toolName === 'AskUserQuestion') {
            messages.value.splice(i, 1);
            break;
          }
          if (m.role === 'user') break;
        }
        const questions = msg.questions || [];
        const selectedAnswers = {};
        const customTexts = {};
        for (let i = 0; i < questions.length; i++) {
          selectedAnswers[i] = questions[i].multiSelect ? [] : null;
          customTexts[i] = '';
        }
        messages.value.push({
          id: streaming.nextId(),
          role: 'ask-question',
          requestId: msg.requestId,
          questions,
          answered: false,
          selectedAnswers,
          customTexts,
          timestamp: new Date(),
        });
        scrollToBottom();
      } else if (msg.type === 'sessions_list') {
        historySessions.value = msg.sessions || [];
        loadingSessions.value = false;
      } else if (msg.type === 'session_deleted') {
        historySessions.value = historySessions.value.filter(s => s.sessionId !== msg.sessionId);
      } else if (msg.type === 'conversation_resumed') {
        currentClaudeSessionId.value = msg.claudeSessionId;
        if (msg.history && Array.isArray(msg.history)) {
          const batch = [];
          for (const h of msg.history) {
            if (h.role === 'user') {
              if (isContextSummary(h.content)) {
                batch.push({
                  id: streaming.nextId(), role: 'context-summary',
                  content: h.content, contextExpanded: false,
                  timestamp: h.timestamp ? new Date(h.timestamp) : new Date(),
                });
              } else if (h.isCommandOutput) {
                batch.push({
                  id: streaming.nextId(), role: 'system',
                  content: h.content, isCommandOutput: true,
                  timestamp: h.timestamp ? new Date(h.timestamp) : new Date(),
                });
              } else {
                batch.push({
                  id: streaming.nextId(), role: 'user',
                  content: h.content,
                  timestamp: h.timestamp ? new Date(h.timestamp) : new Date(),
                });
              }
            } else if (h.role === 'assistant') {
              const last = batch[batch.length - 1];
              if (last && last.role === 'assistant' && !last.isStreaming) {
                last.content += '\n\n' + h.content;
              } else {
                batch.push({
                  id: streaming.nextId(), role: 'assistant',
                  content: h.content, isStreaming: false,
                  timestamp: h.timestamp ? new Date(h.timestamp) : new Date(),
                });
              }
            } else if (h.role === 'tool') {
              batch.push({
                id: streaming.nextId(), role: 'tool',
                toolId: h.toolId || '', toolName: h.toolName || 'unknown',
                toolInput: h.toolInput || '', hasResult: true,
                expanded: (h.toolName === 'Edit' || h.toolName === 'TodoWrite'), timestamp: h.timestamp ? new Date(h.timestamp) : new Date(),
              });
            }
          }
          messages.value = batch;
          toolMsgMap.clear();
        }
        loadingHistory.value = false;
        // Restore live status from agent (compacting / processing)
        if (msg.isCompacting) {
          isCompacting.value = true;
          isProcessing.value = true;
          messages.value.push({
            id: streaming.nextId(), role: 'system',
            content: 'Context compacting...', isCompactStart: true,
            timestamp: new Date(),
          });
        } else if (msg.isProcessing) {
          isProcessing.value = true;
          messages.value.push({
            id: streaming.nextId(), role: 'system',
            content: 'Agent is processing...',
            timestamp: new Date(),
          });
        } else {
          messages.value.push({
            id: streaming.nextId(), role: 'system',
            content: 'Session restored. You can continue the conversation.',
            timestamp: new Date(),
          });
        }
        scrollToBottom();
      } else if (msg.type === 'directory_listing') {
        folderPickerLoading.value = false;
        folderPickerEntries.value = (msg.entries || [])
          .filter(e => e.type === 'directory')
          .sort((a, b) => a.name.localeCompare(b.name));
        if (msg.dirPath != null) folderPickerPath.value = msg.dirPath;
      } else if (msg.type === 'workdir_changed') {
        workDir.value = msg.workDir;
        localStorage.setItem(`agentlink-workdir-${sessionId.value}`, msg.workDir);
        sidebar.addToWorkdirHistory(msg.workDir);
        messages.value = [];
        queuedMessages.value = [];
        toolMsgMap.clear();
        visibleLimit.value = 50;
        streaming.setMessageIdCounter(0);
        streaming.setStreamingMessageId(null);
        streaming.reset();
        currentClaudeSessionId.value = null;
        isProcessing.value = false;
        messages.value.push({
          id: streaming.nextId(), role: 'system',
          content: 'Working directory changed to: ' + msg.workDir,
          timestamp: new Date(),
        });
        sidebar.requestSessionList();
      }
    };

    ws.onclose = () => {
      sessionKey = null;
      const wasConnected = status.value === 'Connected' || status.value === 'Connecting...';
      isProcessing.value = false;
      isCompacting.value = false;
      queuedMessages.value = [];
      loadingSessions.value = false;
      loadingHistory.value = false;

      // Don't auto-reconnect if auth-locked or still in auth prompt
      if (authLocked.value || authRequired.value) return;

      if (wasConnected || reconnectAttempts > 0) {
        scheduleReconnect(scheduleHighlight);
      }
    };

    ws.onerror = () => {};
  }

  function scheduleReconnect(scheduleHighlight) {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      status.value = 'Disconnected';
      error.value = 'Unable to reconnect. Please refresh the page.';
      return;
    }
    const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(1.5, reconnectAttempts), RECONNECT_MAX_DELAY);
    reconnectAttempts++;
    status.value = 'Reconnecting...';
    error.value = 'Connection lost. Reconnecting... (attempt ' + reconnectAttempts + ')';
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

  return { connect, wsSend, closeWs, submitPassword, setDequeueNext };
}
