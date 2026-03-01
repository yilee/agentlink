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
    messages, isProcessing, isCompacting, visibleLimit,
    historySessions, currentClaudeSessionId, needsResume, loadingSessions, loadingHistory,
    folderPickerLoading, folderPickerEntries, folderPickerPath,
    streaming, sidebar,
    scrollToBottom,
  } = deps;

  let ws = null;
  let sessionKey = null;
  let reconnectAttempts = 0;
  let reconnectTimer = null;

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
        messages.value.push({
          id: streaming.nextId(), role: 'tool',
          toolId: tool.id, toolName: tool.name || 'unknown',
          toolInput: tool.input ? JSON.stringify(tool.input, null, 2) : '',
          hasResult: false, expanded: (tool.name === 'Edit' || tool.name === 'TodoWrite'), timestamp: new Date(),
        });
      }
      scrollToBottom();
      return;
    }

    if (data.type === 'user' && data.tool_use_result) {
      const result = data.tool_use_result;
      const results = Array.isArray(result) ? result : [result];
      for (const r of results) {
        const toolMsg = [...messages.value].reverse().find(
          m => m.role === 'tool' && m.toolId === r.tool_use_id
        );
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
    const wsUrl = `${protocol}//${window.location.host}/?type=web&sessionId=${sid}`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => { error.value = ''; reconnectAttempts = 0; };

    ws.onmessage = (event) => {
      let msg;
      const parsed = JSON.parse(event.data);

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
        if (msg.agent) {
          status.value = 'Connected';
          agentName.value = msg.agent.name;
          hostname.value = msg.agent.hostname || '';
          workDir.value = msg.agent.workDir;
          // Restore processing state (e.g. page refresh mid-turn)
          if (msg.agent.processing) {
            isProcessing.value = true;
          }
          // Restore active Claude session so next message resumes it
          if (msg.agent.claudeSessionId) {
            currentClaudeSessionId.value = msg.agent.claudeSessionId;
            needsResume.value = true;
          }
          const savedDir = localStorage.getItem('agentlink-workdir');
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
      } else if (msg.type === 'agent_reconnected') {
        status.value = 'Connected';
        error.value = '';
        if (msg.agent) {
          agentName.value = msg.agent.name;
          hostname.value = msg.agent.hostname || '';
          workDir.value = msg.agent.workDir;
        }
        sidebar.requestSessionList();
      } else if (msg.type === 'error') {
        status.value = 'Error';
        error.value = msg.message;
        isProcessing.value = false;
        isCompacting.value = false;
      } else if (msg.type === 'claude_output') {
        handleClaudeOutput(msg, scheduleHighlight);
      } else if (msg.type === 'command_output') {
        streaming.flushReveal();
        finalizeStreamingMsg(scheduleHighlight);
        messages.value.push({
          id: streaming.nextId(), role: 'user',
          content: msg.content, isCommandOutput: true,
          timestamp: new Date(),
        });
        scrollToBottom();
      } else if (msg.type === 'context_compaction') {
        if (msg.status === 'started') {
          isCompacting.value = true;
        } else if (msg.status === 'completed') {
          isCompacting.value = false;
        }
      } else if (msg.type === 'turn_completed' || msg.type === 'execution_cancelled') {
        isProcessing.value = false;
        isCompacting.value = false;
        streaming.flushReveal();
        finalizeStreamingMsg(scheduleHighlight);
        if (msg.type === 'execution_cancelled') {
          messages.value.push({
            id: streaming.nextId(), role: 'system',
            content: 'Generation stopped.', timestamp: new Date(),
          });
          scrollToBottom();
        }
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
      } else if (msg.type === 'buffered_messages' && Array.isArray(msg.messages)) {
        // Replay buffered messages instantly (no streaming animation)
        let textAcc = '';
        const toolBatch = [];
        for (const m of msg.messages) {
          if (m.type === 'session_started' && m.claudeSessionId) {
            currentClaudeSessionId.value = m.claudeSessionId;
          } else if (m.type === 'claude_output' && m.data) {
            const data = m.data;
            if (data.type === 'content_block_delta' && data.delta) {
              textAcc += data.delta;
            } else if (data.type === 'tool_use' && data.tools) {
              // Flush accumulated text before tools
              if (textAcc) {
                streaming.flushReveal();
                finalizeStreamingMsg(scheduleHighlight);
                messages.value.push({
                  id: streaming.nextId(), role: 'assistant',
                  content: textAcc, timestamp: new Date(),
                });
                textAcc = '';
              }
              for (const tool of data.tools) {
                messages.value.push({
                  id: streaming.nextId(), role: 'tool',
                  toolId: tool.id, toolName: tool.name || 'unknown',
                  toolInput: tool.input ? JSON.stringify(tool.input, null, 2) : '',
                  hasResult: false, expanded: (tool.name === 'Edit' || tool.name === 'TodoWrite'), timestamp: new Date(),
                });
              }
            } else if (data.type === 'user' && data.tool_use_result) {
              const result = data.tool_use_result;
              const results = Array.isArray(result) ? result : [result];
              for (const r of results) {
                const toolMsg = [...messages.value].reverse().find(
                  m2 => m2.role === 'tool' && m2.toolId === r.tool_use_id
                );
                if (toolMsg) {
                  toolMsg.toolOutput = typeof r.content === 'string'
                    ? r.content : JSON.stringify(r.content, null, 2);
                  toolMsg.hasResult = true;
                }
              }
            }
          } else if (m.type === 'turn_completed' || m.type === 'execution_cancelled') {
            isProcessing.value = false;
            isCompacting.value = false;
          } else if (m.type === 'context_compaction') {
            if (m.status === 'completed') isCompacting.value = false;
          }
        }
        // Flush remaining text
        if (textAcc) {
          streaming.flushReveal();
          finalizeStreamingMsg(scheduleHighlight);
          messages.value.push({
            id: streaming.nextId(), role: 'assistant',
            content: textAcc, timestamp: new Date(),
          });
        }
        // Finalize so subsequent real-time messages create fresh streaming entries
        finalizeStreamingMsg(scheduleHighlight);
        scrollToBottom();
      } else if (msg.type === 'sessions_list') {
        historySessions.value = msg.sessions || [];
        loadingSessions.value = false;
      } else if (msg.type === 'session_started') {
        currentClaudeSessionId.value = msg.claudeSessionId;
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
              } else {
                batch.push({
                  id: streaming.nextId(), role: 'user',
                  content: h.content, isCommandOutput: !!h.isCommandOutput,
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
        }
        loadingHistory.value = false;
        messages.value.push({
          id: streaming.nextId(), role: 'system',
          content: 'Session restored. You can continue the conversation.',
          timestamp: new Date(),
        });
        scrollToBottom();
      } else if (msg.type === 'directory_listing') {
        folderPickerLoading.value = false;
        folderPickerEntries.value = (msg.entries || [])
          .filter(e => e.type === 'directory')
          .sort((a, b) => a.name.localeCompare(b.name));
        if (msg.dirPath != null) folderPickerPath.value = msg.dirPath;
      } else if (msg.type === 'workdir_changed') {
        workDir.value = msg.workDir;
        localStorage.setItem('agentlink-workdir', msg.workDir);
        messages.value = [];
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
      // Finalize any in-flight streaming message so reconnect starts clean
      streaming.flushReveal();
      finalizeStreamingMsg(scheduleHighlight);

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

  return { connect, wsSend, closeWs };
}
