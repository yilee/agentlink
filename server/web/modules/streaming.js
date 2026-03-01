// ── Progressive text streaming / reveal animation ────────────────────────────

const CHARS_PER_TICK = 5;
const TICK_MS = 16;

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

    if (!streamMsg) {
      const id = ++messageIdCounter;
      const chunk = pendingText.slice(0, CHARS_PER_TICK);
      pendingText = pendingText.slice(CHARS_PER_TICK);
      messages.value.push({
        id, role: 'assistant', content: chunk,
        isStreaming: true, timestamp: new Date(),
      });
      streamingMessageId = id;
    } else {
      const chunk = pendingText.slice(0, CHARS_PER_TICK);
      pendingText = pendingText.slice(CHARS_PER_TICK);
      streamMsg.content += chunk;
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
      streamMsg.content += pendingText;
    } else {
      const id = ++messageIdCounter;
      messages.value.push({
        id, role: 'assistant', content: pendingText,
        isStreaming: true, timestamp: new Date(),
      });
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

  return {
    startReveal, flushReveal, appendPending, reset, cleanup,
    getMessageIdCounter, setMessageIdCounter,
    getStreamingMessageId, setStreamingMessageId,
    nextId,
  };
}
