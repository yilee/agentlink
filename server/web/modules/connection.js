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
    serverVersion, agentVersion, latency,
    messages, isProcessing, isCompacting, visibleLimit, queuedMessages, usageStats,
    historySessions, currentClaudeSessionId, needsResume, loadingSessions, loadingHistory,
    folderPickerLoading, folderPickerEntries, folderPickerPath,
    authRequired, authPassword, authError, authAttempts, authLocked,
    streaming, sidebar,
    scrollToBottom,
    workdirSwitching,
    // Multi-session parallel
    currentConversationId, processingConversations, conversationCache,
    switchConversation,
  } = deps;

  // Dequeue callback — set after creation to resolve circular dependency
  let _dequeueNext = () => {};
  function setDequeueNext(fn) { _dequeueNext = fn; }

  // File browser — set after creation to resolve circular dependency
  let fileBrowser = null;
  function setFileBrowser(fb) { fileBrowser = fb; }

  // File preview — set after creation to resolve circular dependency
  let filePreview = null;
  function setFilePreview(fp) { filePreview = fp; }

  // Team module — set after creation to resolve circular dependency
  let team = null;
  function setTeam(t) { team = t; }

  let ws = null;
  let sessionKey = null;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let pingTimer = null;
  const toolMsgMap = new Map(); // toolId -> message (for fast tool_result lookup)

  // ── toolMsgMap save/restore for conversation switching ──
  function getToolMsgMap() { return new Map(toolMsgMap); }
  function restoreToolMsgMap(map) { toolMsgMap.clear(); for (const [k, v] of map) toolMsgMap.set(k, v); }
  function clearToolMsgMap() { toolMsgMap.clear(); }

  // ── Background conversation routing ──
  // When a message arrives for a conversation that is not the current foreground,
  // update its cached state directly (no streaming animation).
  function routeToBackgroundConversation(convId, msg) {
    const cache = conversationCache.value[convId];
    if (!cache) return; // no cache entry — discard

    if (msg.type === 'session_started') {
      // Claude session ID captured for background conversation
      cache.claudeSessionId = msg.claudeSessionId;
      sidebar.requestSessionList();
      return;
    }

    if (msg.type === 'conversation_resumed') {
      cache.claudeSessionId = msg.claudeSessionId;
      if (msg.history && Array.isArray(msg.history)) {
        const batch = [];
        for (const h of msg.history) {
          if (h.role === 'user') {
            if (isContextSummary(h.content)) {
              batch.push({
                id: ++cache.messageIdCounter, role: 'context-summary',
                content: h.content, contextExpanded: false,
                timestamp: h.timestamp ? new Date(h.timestamp) : new Date(),
              });
            } else if (h.isCommandOutput) {
              batch.push({
                id: ++cache.messageIdCounter, role: 'system',
                content: h.content, isCommandOutput: true,
                timestamp: h.timestamp ? new Date(h.timestamp) : new Date(),
              });
            } else {
              batch.push({
                id: ++cache.messageIdCounter, role: 'user',
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
                id: ++cache.messageIdCounter, role: 'assistant',
                content: h.content, isStreaming: false,
                timestamp: h.timestamp ? new Date(h.timestamp) : new Date(),
              });
            }
          } else if (h.role === 'tool') {
            batch.push({
              id: ++cache.messageIdCounter, role: 'tool',
              toolId: h.toolId || '', toolName: h.toolName || 'unknown',
              toolInput: h.toolInput || '', hasResult: true,
              expanded: (h.toolName === 'Edit' || h.toolName === 'TodoWrite'),
              timestamp: h.timestamp ? new Date(h.timestamp) : new Date(),
            });
          }
        }
        cache.messages = batch;
        if (cache.toolMsgMap) cache.toolMsgMap.clear();
      }
      cache.loadingHistory = false;
      if (msg.isCompacting) {
        cache.isCompacting = true;
        cache.isProcessing = true;
        processingConversations.value[convId] = true;
        cache.messages.push({
          id: ++cache.messageIdCounter, role: 'system',
          content: 'Context compacting...', isCompactStart: true,
          timestamp: new Date(),
        });
      } else if (msg.isProcessing) {
        cache.isProcessing = true;
        processingConversations.value[convId] = true;
        cache.messages.push({
          id: ++cache.messageIdCounter, role: 'system',
          content: 'Agent is processing...',
          timestamp: new Date(),
        });
      } else {
        cache.messages.push({
          id: ++cache.messageIdCounter, role: 'system',
          content: 'Session restored. You can continue the conversation.',
          timestamp: new Date(),
        });
      }
      return;
    }

    if (msg.type === 'claude_output') {
      // Safety net: restore processing state if output arrives after reconnect
      if (!cache.isProcessing) {
        cache.isProcessing = true;
        processingConversations.value[convId] = true;
      }
      const data = msg.data;
      if (!data) return;
      if (data.type === 'content_block_delta' && data.delta) {
        // Append text to last assistant message (or create new one)
        const msgs = cache.messages;
        const last = msgs.length > 0 ? msgs[msgs.length - 1] : null;
        if (last && last.role === 'assistant' && last.isStreaming) {
          last.content += data.delta;
        } else {
          msgs.push({
            id: ++cache.messageIdCounter, role: 'assistant',
            content: data.delta, isStreaming: true, timestamp: new Date(),
          });
        }
      } else if (data.type === 'tool_use' && data.tools) {
        // Finalize streaming message
        const msgs = cache.messages;
        const last = msgs.length > 0 ? msgs[msgs.length - 1] : null;
        if (last && last.role === 'assistant' && last.isStreaming) {
          last.isStreaming = false;
          if (isContextSummary(last.content)) {
            last.role = 'context-summary';
            last.contextExpanded = false;
          }
        }
        for (const tool of data.tools) {
          const toolMsg = {
            id: ++cache.messageIdCounter, role: 'tool',
            toolId: tool.id, toolName: tool.name || 'unknown',
            toolInput: tool.input ? JSON.stringify(tool.input, null, 2) : '',
            hasResult: false, expanded: (tool.name === 'Edit' || tool.name === 'TodoWrite'),
            timestamp: new Date(),
          };
          msgs.push(toolMsg);
          if (tool.id) {
            if (!cache.toolMsgMap) cache.toolMsgMap = new Map();
            cache.toolMsgMap.set(tool.id, toolMsg);
          }
        }
      } else if (data.type === 'user' && data.tool_use_result) {
        const result = data.tool_use_result;
        const results = Array.isArray(result) ? result : [result];
        const tMap = cache.toolMsgMap || new Map();
        for (const r of results) {
          const toolMsg = tMap.get(r.tool_use_id);
          if (toolMsg) {
            toolMsg.toolOutput = typeof r.content === 'string'
              ? r.content : JSON.stringify(r.content, null, 2);
            toolMsg.hasResult = true;
          }
        }
      }
    } else if (msg.type === 'turn_completed' || msg.type === 'execution_cancelled') {
      // Finalize streaming message
      const msgs = cache.messages;
      const last = msgs.length > 0 ? msgs[msgs.length - 1] : null;
      if (last && last.role === 'assistant' && last.isStreaming) {
        last.isStreaming = false;
        if (isContextSummary(last.content)) {
          last.role = 'context-summary';
          last.contextExpanded = false;
        }
      }
      cache.isProcessing = false;
      cache.isCompacting = false;
      if (msg.usage) cache.usageStats = msg.usage;
      if (cache.toolMsgMap) cache.toolMsgMap.clear();
      processingConversations.value[convId] = false;
      if (msg.type === 'execution_cancelled') {
        cache.needsResume = true;
        cache.messages.push({
          id: ++cache.messageIdCounter, role: 'system',
          content: 'Generation stopped.', timestamp: new Date(),
        });
      }
      sidebar.requestSessionList();
      // Dequeue next message for this background conversation
      if (cache.queuedMessages && cache.queuedMessages.length > 0) {
        const queued = cache.queuedMessages.shift();
        cache.messages.push({
          id: ++cache.messageIdCounter, role: 'user', status: 'sent',
          content: queued.content, attachments: queued.attachments,
          timestamp: new Date(),
        });
        cache.isProcessing = true;
        processingConversations.value[convId] = true;
        wsSend(queued.payload);
      }
    } else if (msg.type === 'context_compaction') {
      if (msg.status === 'started') {
        cache.isCompacting = true;
        cache.messages.push({
          id: ++cache.messageIdCounter, role: 'system',
          content: 'Context compacting...', isCompactStart: true,
          timestamp: new Date(),
        });
      } else if (msg.status === 'completed') {
        cache.isCompacting = false;
        const startMsg = [...cache.messages].reverse().find(m => m.isCompactStart && !m.compactDone);
        if (startMsg) {
          startMsg.content = 'Context compacted';
          startMsg.compactDone = true;
        }
      }
    } else if (msg.type === 'error') {
      // Finalize streaming
      const msgs = cache.messages;
      const last = msgs.length > 0 ? msgs[msgs.length - 1] : null;
      if (last && last.role === 'assistant' && last.isStreaming) {
        last.isStreaming = false;
      }
      cache.messages.push({
        id: ++cache.messageIdCounter, role: 'system',
        content: msg.message, isError: true, timestamp: new Date(),
      });
      cache.isProcessing = false;
      cache.isCompacting = false;
      processingConversations.value[convId] = false;
    } else if (msg.type === 'command_output') {
      const msgs = cache.messages;
      const last = msgs.length > 0 ? msgs[msgs.length - 1] : null;
      if (last && last.role === 'assistant' && last.isStreaming) {
        last.isStreaming = false;
      }
      cache.messages.push({
        id: ++cache.messageIdCounter, role: 'system',
        content: msg.content, isCommandOutput: true, timestamp: new Date(),
      });
    } else if (msg.type === 'ask_user_question') {
      // Finalize streaming
      const msgs = cache.messages;
      const last = msgs.length > 0 ? msgs[msgs.length - 1] : null;
      if (last && last.role === 'assistant' && last.isStreaming) {
        last.isStreaming = false;
      }
      // Remove AskUserQuestion tool msg
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (m.role === 'tool' && m.toolName === 'AskUserQuestion') {
          msgs.splice(i, 1);
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
      msgs.push({
        id: ++cache.messageIdCounter,
        role: 'ask-question',
        requestId: msg.requestId,
        questions,
        answered: false,
        selectedAnswers,
        customTexts,
        timestamp: new Date(),
      });
    }
  }

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
    // Send first ping immediately, then every 10s
    wsSend({ type: 'ping', ts: Date.now() });
    pingTimer = setInterval(() => {
      wsSend({ type: 'ping', ts: Date.now() });
    }, 10000);
  }

  function stopPing() {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    latency.value = null;
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

    // Safety net: if streaming output arrives but isProcessing is false
    // (e.g. after reconnect before active_conversations response), self-correct
    if (!isProcessing.value) {
      isProcessing.value = true;
      if (currentConversationId && currentConversationId.value) {
        processingConversations.value[currentConversationId.value] = true;
      }
    }

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

      // ── Team messages: route before normal conversation routing ──
      if (team && (msg.type?.startsWith('team_') || (msg.type === 'claude_output' && msg.teamId))) {
        if (msg.type === 'claude_output' && msg.teamId) {
          team.handleTeamAgentOutput(msg);
        } else {
          team.handleTeamMessage(msg);
        }
        return;
      }

      // ── Multi-session: route messages to background conversations ──
      // Messages with a conversationId that doesn't match the current foreground
      // conversation are routed to their cached background state.
      if (msg.conversationId && currentConversationId
          && currentConversationId.value
          && msg.conversationId !== currentConversationId.value) {
        routeToBackgroundConversation(msg.conversationId, msg);
        return;
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
            workdirSwitching.value = true;
            setTimeout(() => { workdirSwitching.value = false; }, 10000);
            wsSend({ type: 'change_workdir', workDir: savedDir });
          }
          sidebar.requestSessionList();
          startPing();
          wsSend({ type: 'query_active_conversations' });
        } else {
          status.value = 'Waiting';
          error.value = 'Agent is not connected yet.';
        }
      } else if (msg.type === 'pong') {
        if (typeof msg.ts === 'number') {
          latency.value = Date.now() - msg.ts;
        }
      } else if (msg.type === 'agent_disconnected') {
        stopPing();
        status.value = 'Waiting';
        agentName.value = '';
        hostname.value = '';
        error.value = 'Agent disconnected. Waiting for reconnect...';
        isProcessing.value = false;
        isCompacting.value = false;
        queuedMessages.value = [];
        loadingSessions.value = false;
        // Clear processing state for all background conversations
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
        startPing();
        wsSend({ type: 'query_active_conversations' });
      } else if (msg.type === 'active_conversations') {
        // Agent's response is authoritative — first clear all processing state,
        // then re-apply only for conversations the agent reports as active.
        // This corrects any stale isProcessing=true left by the safety net or
        // from turns that finished while the socket was down.
        const activeSet = new Set();
        const convs = msg.conversations || [];
        for (const entry of convs) {
          if (entry.conversationId) activeSet.add(entry.conversationId);
        }

        // Clear foreground
        if (!activeSet.has(currentConversationId && currentConversationId.value)) {
          isProcessing.value = false;
          isCompacting.value = false;
        }
        // Clear all cached background conversations
        if (conversationCache) {
          for (const [convId, cached] of Object.entries(conversationCache.value)) {
            if (!activeSet.has(convId)) {
              cached.isProcessing = false;
              cached.isCompacting = false;
            }
          }
        }
        // Clear processingConversations map
        if (processingConversations) {
          for (const convId of Object.keys(processingConversations.value)) {
            if (!activeSet.has(convId)) {
              processingConversations.value[convId] = false;
            }
          }
        }

        // Now set state for actually active conversations
        for (const entry of convs) {
          const convId = entry.conversationId;
          if (!convId) continue;
          if (currentConversationId && currentConversationId.value === convId) {
            // Foreground conversation
            isProcessing.value = true;
            isCompacting.value = !!entry.isCompacting;
          } else if (conversationCache && conversationCache.value[convId]) {
            // Background conversation
            const cached = conversationCache.value[convId];
            cached.isProcessing = true;
            cached.isCompacting = !!entry.isCompacting;
          }
          if (processingConversations) {
            processingConversations.value[convId] = true;
          }
        }

        // Restore active team state on reconnect
        if (team && msg.activeTeam) {
          team.handleActiveTeamRestore(msg.activeTeam);
        }
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
        if (currentConversationId && currentConversationId.value) {
          processingConversations.value[currentConversationId.value] = false;
        }
        _dequeueNext();
      } else if (msg.type === 'claude_output') {
        handleClaudeOutput(msg, scheduleHighlight);
      } else if (msg.type === 'session_started') {
        // Claude session ID captured — update and refresh sidebar
        currentClaudeSessionId.value = msg.claudeSessionId;
        sidebar.requestSessionList();
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
        if (msg.usage) usageStats.value = msg.usage;
        if (currentConversationId && currentConversationId.value) {
          processingConversations.value[currentConversationId.value] = false;
        }
        if (msg.type === 'execution_cancelled') {
          needsResume.value = true;
          messages.value.push({
            id: streaming.nextId(), role: 'system',
            content: 'Generation stopped.', timestamp: new Date(),
          });
          scrollToBottom();
        }
        sidebar.requestSessionList();
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
      } else if (msg.type === 'session_renamed') {
        const session = historySessions.value.find(s => s.sessionId === msg.sessionId);
        if (session) session.title = msg.newTitle;
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
        if (msg.source === 'file_browser' && fileBrowser) {
          fileBrowser.handleDirectoryListing(msg);
        } else {
          folderPickerLoading.value = false;
          folderPickerEntries.value = (msg.entries || [])
            .filter(e => e.type === 'directory')
            .sort((a, b) => a.name.localeCompare(b.name));
          if (msg.dirPath != null) folderPickerPath.value = msg.dirPath;
        }
      } else if (msg.type === 'file_content') {
        if (filePreview) filePreview.handleFileContent(msg);
      } else if (msg.type === 'workdir_changed') {
        workdirSwitching.value = false;
        workDir.value = msg.workDir;
        localStorage.setItem(`agentlink-workdir-${sessionId.value}`, msg.workDir);
        sidebar.addToWorkdirHistory(msg.workDir);
        if (fileBrowser) fileBrowser.onWorkdirChanged();
        if (filePreview) filePreview.onWorkdirChanged();

        // Multi-session: switch to a new blank conversation for the new workdir.
        // Background conversations keep running and receiving output in their cache.
        if (switchConversation) {
          const newConvId = crypto.randomUUID();
          switchConversation(newConvId);
        } else {
          // Fallback for old code path (no switchConversation)
          messages.value = [];
          queuedMessages.value = [];
          toolMsgMap.clear();
          visibleLimit.value = 50;
          streaming.setMessageIdCounter(0);
          streaming.setStreamingMessageId(null);
          streaming.reset();
          currentClaudeSessionId.value = null;
          isProcessing.value = false;
        }
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
      stopPing();
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

  return { connect, wsSend, closeWs, submitPassword, setDequeueNext, setFileBrowser, setFilePreview, setTeam, getToolMsgMap, restoreToolMsgMap, clearToolMsgMap };
}
