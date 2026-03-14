// ── Progressive text streaming / reveal animation ────────────────────────────

const CHARS_PER_TICK = 20;
const TICK_MS = 50;

/**
 * Creates a streaming text reveal controller.
 * @param {object} deps
 * @param {import('vue').Ref} deps.messages - messages ref array
 * @param {() => void} deps.scrollToBottom - scroll callback
 */
export function createStreaming({ messages, scrollToBottom }) {
  let pendingText = '';
  let revealTimer = null;
  let streamingMessageId = null;
  let messageIdCounter = 0;

  function getMessageIdCounter() { return messageIdCounter; }
  function setMessageIdCounter(v) { messageIdCounter = v; }
  function getStreamingMessageId() { return streamingMessageId; }
  function setStreamingMessageId(v) { streamingMessageId = v; }
  function nextId() { return ++messageIdCounter; }

  function startReveal() {
    if (revealTimer !== null) return;
    revealTimer = setTimeout(revealTick, TICK_MS);
  }

  function revealTick() {
    revealTimer = null;
    if (!pendingText) return;

    const streamMsg = streamingMessageId !== null
      ? messages.value.find(m => m.id === streamingMessageId)
      : null;

    const chunk = pendingText.slice(0, CHARS_PER_TICK);
    pendingText = pendingText.slice(CHARS_PER_TICK);

    if (!streamMsg) {
      const id = ++messageIdCounter;
      const newMsg = {
        id, role: 'assistant', content: chunk,
        isStreaming: true, timestamp: new Date(),
        _chunks: [chunk],
      };
      messages.value.push(newMsg);
      streamingMessageId = id;
    } else {
      streamMsg._chunks.push(chunk);
      streamMsg.content = streamMsg._chunks.join('');
    }
    scrollToBottom();
    if (pendingText) revealTimer = setTimeout(revealTick, TICK_MS);
  }

  function flushReveal() {
    if (revealTimer !== null) { clearTimeout(revealTimer); revealTimer = null; }
    if (!pendingText) return;
    const streamMsg = streamingMessageId !== null
      ? messages.value.find(m => m.id === streamingMessageId) : null;
    if (streamMsg) {
      if (!streamMsg._chunks) streamMsg._chunks = [streamMsg.content];
      streamMsg._chunks.push(pendingText);
      streamMsg.content = streamMsg._chunks.join('');
    } else {
      const id = ++messageIdCounter;
      const newMsg = {
        id, role: 'assistant', content: pendingText,
        isStreaming: true, timestamp: new Date(),
        _chunks: [pendingText],
      };
      messages.value.push(newMsg);
      streamingMessageId = id;
    }
    pendingText = '';
    scrollToBottom();
  }

  function appendPending(text) {
    pendingText += text;
  }

  function reset() {
    pendingText = '';
    if (revealTimer !== null) { clearTimeout(revealTimer); revealTimer = null; }
  }

  function cleanup() {
    if (revealTimer !== null) { clearTimeout(revealTimer); revealTimer = null; }
  }

  function saveState() {
    flushReveal(); // flush pending text into the message before saving
    return {
      pendingText: '',
      streamingMessageId,
      messageIdCounter,
    };
  }

  function restoreState(saved) {
    flushReveal(); // clear any current pending
    pendingText = saved.pendingText || '';
    streamingMessageId = saved.streamingMessageId ?? null;
    messageIdCounter = saved.messageIdCounter || 0;
    if (pendingText) startReveal();
  }

  return {
    startReveal, flushReveal, appendPending, reset, cleanup,
    getMessageIdCounter, setMessageIdCounter,
    getStreamingMessageId, setStreamingMessageId,
    nextId, saveState, restoreState,
  };
}
