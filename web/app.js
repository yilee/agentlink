const { createApp, ref } = Vue;

const App = {
  setup() {
    const status = ref('Disconnected');
    const serverUrl = ref(`ws://${window.location.host}`);

    return { status, serverUrl };
  },
  template: `
    <div class="container">
      <h1>AgentLink</h1>
      <p class="status">Status: <span :class="status.toLowerCase()">{{ status }}</span></p>
      <p class="muted">Server: {{ serverUrl }}</p>
    </div>
  `
};

const app = createApp(App);
app.mount('#app');
