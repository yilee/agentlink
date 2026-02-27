const { createApp, ref, nextTick, onMounted, onUnmounted, computed } = Vue;

const App = {
  setup() {
    const status = ref('Connecting...');
    const agentName = ref('');
    const workDir = ref('');
    const sessionId = ref('');
    const error = ref('');
    const messages = ref([]);
    const inputText = ref('');
    const isProcessing = ref(false);
    let ws = null;
    let messageIdCounter = 0;

    const canSend = computed(() =>
      status.value === 'Connected' && inputText.value.trim() && !isProcessing.value
    );

    // Extract session ID from URL path: /s/:sessionId
    function getSessionId() {
      const match = window.location.pathname.match(/^\/s\/([^/]+)/);
      return match ? match[1] : null;
    }

    function scrollToBottom() {
      nextTick(() => {
        const el = document.querySelector('.message-list');
        if (el) el.scrollTop = el.scrollHeight;
      });
    }

    function sendMessage() {
      if (!canSend.value) return;

      const text = inputText.value.trim();
      inputText.value = '';

      // Add user message to UI
      messages.value.push({
        id: ++messageIdCounter,
        role: 'user',
        content: text,
        timestamp: new Date(),
      });

      isProcessing.value = true;
      scrollToBottom();

      // Send to server → agent
      ws.send(JSON.stringify({
        type: 'chat',
        prompt: text,
      }));
    }

    function handleKeydown(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    }

    function connect() {
      const sid = getSessionId();
      if (!sid) {
        status.value = 'No Session';
        error.value = 'No session ID in URL. Use a session URL provided by agentlink start.';
        return;
      }
      sessionId.value = sid;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/?type=web&sessionId=${sid}`;

      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        error.value = '';
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        if (msg.type === 'connected') {
          if (msg.agent) {
            status.value = 'Connected';
            agentName.value = msg.agent.name;
            workDir.value = msg.agent.workDir;
          } else {
            status.value = 'Waiting';
            error.value = 'Agent is not connected yet.';
          }
        } else if (msg.type === 'agent_disconnected') {
          status.value = 'Disconnected';
          agentName.value = '';
          workDir.value = '';
          error.value = 'Agent has disconnected.';
          isProcessing.value = false;
        } else if (msg.type === 'error') {
          status.value = 'Error';
          error.value = msg.message;
          isProcessing.value = false;
        } else if (msg.type === 'claude_output') {
          handleClaudeOutput(msg);
        } else if (msg.type === 'turn_completed') {
          isProcessing.value = false;
        }
      };

      ws.onclose = () => {
        if (status.value === 'Connected' || status.value === 'Connecting...') {
          status.value = 'Disconnected';
          error.value = 'Connection to server lost.';
        }
        isProcessing.value = false;
      };

      ws.onerror = () => {
        // onclose will follow
      };
    }

    function handleClaudeOutput(msg) {
      const data = msg.data;
      if (!data) return;

      if (data.type === 'assistant' && data.message) {
        const content = data.message.content || [];

        // Extract text blocks
        const textBlocks = content.filter(b => b.type === 'text').map(b => b.text);
        if (textBlocks.length > 0) {
          messages.value.push({
            id: ++messageIdCounter,
            role: 'assistant',
            content: textBlocks.join('\n'),
            timestamp: new Date(),
          });
          scrollToBottom();
        }

        // Extract tool_use blocks (SDK embeds them inside assistant messages)
        const toolBlocks = content.filter(b => b.type === 'tool_use');
        for (const tool of toolBlocks) {
          messages.value.push({
            id: ++messageIdCounter,
            role: 'tool',
            toolId: tool.id,
            toolName: tool.name || 'unknown',
            toolInput: tool.input ? JSON.stringify(tool.input, null, 2) : '',
            timestamp: new Date(),
          });
        }
        if (toolBlocks.length > 0) scrollToBottom();

      } else if (data.type === 'user' && data.tool_use_result) {
        // Tool result from SDK: find the matching tool message and attach output
        const result = data.tool_use_result;
        const results = Array.isArray(result) ? result : [result];
        for (const r of results) {
          const toolMsg = [...messages.value].reverse().find(
            m => m.role === 'tool' && m.toolId === r.tool_use_id
          );
          if (toolMsg) {
            toolMsg.toolOutput = typeof r.content === 'string'
              ? r.content
              : JSON.stringify(r.content, null, 2);
          }
        }
        scrollToBottom();

      } else if (data.type === 'result') {
        // Turn result with usage info — ignore for now
      }
    }

    onMounted(() => {
      connect();
    });

    onUnmounted(() => {
      if (ws) ws.close();
    });

    return {
      status, agentName, workDir, sessionId, error,
      messages, inputText, isProcessing, canSend,
      sendMessage, handleKeydown,
    };
  },
  template: `
    <div class="layout">
      <header class="top-bar">
        <h1>AgentLink</h1>
        <div class="top-bar-info">
          <span :class="['badge', status.toLowerCase()]">{{ status }}</span>
          <span v-if="agentName" class="agent-label">{{ agentName }}</span>
        </div>
      </header>

      <div v-if="status === 'No Session' || (status !== 'Connected' && status !== 'Connecting...' && messages.length === 0)" class="center-card">
        <div class="status-card">
          <p class="status">
            <span class="label">Status:</span>
            <span :class="['badge', status.toLowerCase()]">{{ status }}</span>
          </p>
          <p v-if="agentName" class="info">
            <span class="label">Agent:</span> {{ agentName }}
          </p>
          <p v-if="workDir" class="info">
            <span class="label">Directory:</span> {{ workDir }}
          </p>
          <p v-if="sessionId" class="info muted">
            <span class="label">Session:</span> {{ sessionId }}
          </p>
          <p v-if="error" class="error-msg">{{ error }}</p>
        </div>
      </div>

      <div v-else class="chat-area">
        <div class="message-list">
          <div v-if="messages.length === 0 && status === 'Connected'" class="empty-state">
            <p>Connected to <strong>{{ agentName }}</strong></p>
            <p class="muted">Working directory: {{ workDir }}</p>
            <p class="muted">Send a message to start.</p>
          </div>
          <div v-for="msg in messages" :key="msg.id" :class="['message', 'message-' + msg.role]">
            <div v-if="msg.role === 'user'" class="message-bubble user-bubble">
              <div class="message-content">{{ msg.content }}</div>
            </div>
            <div v-else-if="msg.role === 'assistant'" class="message-bubble assistant-bubble">
              <div class="message-content" v-html="msg.content"></div>
            </div>
            <div v-else-if="msg.role === 'tool'" class="message-bubble tool-bubble">
              <div class="tool-header">Tool: {{ msg.toolName }}</div>
              <pre v-if="msg.toolInput" class="tool-block">{{ msg.toolInput }}</pre>
              <pre v-if="msg.toolOutput" class="tool-block tool-output">{{ msg.toolOutput }}</pre>
            </div>
          </div>
          <div v-if="isProcessing" class="typing-indicator">
            <span></span><span></span><span></span>
          </div>
        </div>

        <div class="input-area">
          <div class="input-wrapper">
            <textarea
              v-model="inputText"
              @keydown="handleKeydown"
              :disabled="status !== 'Connected'"
              placeholder="Send a message..."
              rows="2"
            ></textarea>
            <button @click="sendMessage" :disabled="!canSend" class="send-btn">Send</button>
          </div>
        </div>
      </div>
    </div>
  `
};

const app = createApp(App);
app.mount('#app');
