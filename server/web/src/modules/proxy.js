// ── Port proxy panel state management ──
import { ref, computed } from 'vue';

export function createProxy(deps) {
  const {
    wsSend, sessionId,
    proxyPanelOpen, filePanelOpen, memoryPanelOpen, gitPanelOpen,
    isMobile, sidebarView, workdirMenuOpen,
  } = deps;

  // Internal reactive state
  const proxyConfig = ref({ enabled: false, ports: [] });

  const proxyEnabled = computed(() => proxyConfig.value.enabled);
  const proxyPorts = computed(() => proxyConfig.value.ports);

  function sendConfig() {
    wsSend({ type: 'proxy_config_update', config: proxyConfig.value });
  }

  function toggleProxy() {
    proxyConfig.value = { ...proxyConfig.value, enabled: !proxyConfig.value.enabled };
    sendConfig();
  }

  function addPort(port, label) {
    port = parseInt(port, 10);
    if (!port || port < 1024 || port > 65535) return;
    if (proxyConfig.value.ports.some(p => p.port === port)) return;
    proxyConfig.value = {
      ...proxyConfig.value,
      ports: [...proxyConfig.value.ports, { port, enabled: true, label: label || '' }],
    };
    sendConfig();
  }

  function removePort(port) {
    proxyConfig.value = {
      ...proxyConfig.value,
      ports: proxyConfig.value.ports.filter(p => p.port !== port),
    };
    sendConfig();
  }

  function togglePort(port) {
    proxyConfig.value = {
      ...proxyConfig.value,
      ports: proxyConfig.value.ports.map(p =>
        p.port === port ? { ...p, enabled: !p.enabled } : p
      ),
    };
    sendConfig();
  }

  function updatePortLabel(port, label) {
    proxyConfig.value = {
      ...proxyConfig.value,
      ports: proxyConfig.value.ports.map(p =>
        p.port === port ? { ...p, label } : p
      ),
    };
    sendConfig();
  }

  function getProxyUrl(port) {
    const sid = sessionId.value;
    if (!sid) return '';
    return `${window.location.origin}/s/${sid}/proxy/${port}/`;
  }

  function copyProxyUrl(port) {
    const url = getProxyUrl(port);
    if (url) navigator.clipboard.writeText(url);
  }

  function openPanel() {
    workdirMenuOpen.value = false;
    if (isMobile.value) {
      sidebarView.value = 'proxy';
    } else {
      filePanelOpen.value = false;
      memoryPanelOpen.value = false;
      gitPanelOpen.value = false;
      proxyPanelOpen.value = true;
    }
  }

  function closePanel() {
    proxyPanelOpen.value = false;
  }

  // ── Message handler ──

  function handleProxyConfigUpdated(msg) {
    if (msg.config) {
      proxyConfig.value = msg.config;
    }
  }

  function onWorkdirChanged() {
    proxyConfig.value = { enabled: false, ports: [] };
    proxyPanelOpen.value = false;
  }

  return {
    proxyConfig,
    proxyEnabled,
    proxyPorts,
    toggleProxy,
    addPort,
    removePort,
    togglePort,
    updatePortLabel,
    getProxyUrl,
    copyProxyUrl,
    openPanel,
    closePanel,
    handleProxyConfigUpdated,
    onWorkdirChanged,
  };
}
