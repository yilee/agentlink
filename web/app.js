const { createApp, ref, onMounted, onUnmounted } = Vue;

const App = {
  setup() {
    const status = ref('Connecting...');
    const agentName = ref('');
    const workDir = ref('');
    const sessionId = ref('');
    const error = ref('');
    let ws = null;

    // Extract session ID from URL path: /s/:sessionId
    function getSessionId() {
      const match = window.location.pathname.match(/^\/s\/([^/]+)/);
      return match ? match[1] : null;
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
        } else if (msg.type === 'error') {
          status.value = 'Error';
          error.value = msg.message;
        }
      };

      ws.onclose = () => {
        if (status.value === 'Connected' || status.value === 'Connecting...') {
          status.value = 'Disconnected';
          error.value = 'Connection to server lost.';
        }
      };

      ws.onerror = () => {
        // onclose will follow
      };
    }

    onMounted(() => {
      connect();
    });

    onUnmounted(() => {
      if (ws) ws.close();
    });

    return { status, agentName, workDir, sessionId, error };
  },
  template: `
    <div class="container">
      <h1>AgentLink</h1>
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
  `
};

const app = createApp(App);
app.mount('#app');
