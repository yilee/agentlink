<script setup>
import { inject, ref } from 'vue';

const store = inject('store');
const filesStore = inject('files');

const { isMobile } = store;

const {
  proxyPanelOpen,
  proxy,
  filePanelWidth,
} = filesStore;

const newPort = ref('');
const newLabel = ref('');
const copiedPort = ref(null);

function handleAddPort() {
  const port = parseInt(newPort.value, 10);
  if (!port) return;
  proxy.addPort(port, newLabel.value);
  newPort.value = '';
  newLabel.value = '';
}

function handleCopy(port) {
  proxy.copyProxyUrl(port);
  copiedPort.value = port;
  setTimeout(() => { copiedPort.value = null; }, 1500);
}
</script>

<template>
  <!-- Proxy panel (desktop) -->
  <Transition name="file-panel">
  <div v-if="proxyPanelOpen && !isMobile" class="file-panel proxy-panel" :style="{ width: filePanelWidth + 'px' }">
    <div class="file-panel-header">
      <span class="file-panel-title">PORT PROXY</span>
      <div class="file-panel-actions">
        <button class="file-panel-btn" @click="proxy.closePanel()" title="Close">
          <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </div>
    </div>

    <!-- Global toggle -->
    <div v-if="proxy.loading.value" class="proxy-empty" style="padding: 16px; text-align: center;">Loading...</div>
    <template v-else>
    <div class="proxy-toggle-bar">
      <span class="proxy-toggle-label">Proxy</span>
      <button
        class="proxy-toggle-btn"
        :class="{ active: proxy.proxyEnabled.value }"
        @click="proxy.toggleProxy()"
      >
        {{ proxy.proxyEnabled.value ? 'ON' : 'OFF' }}
      </button>
    </div>

    <!-- Add port form -->
    <div class="proxy-add-form">
      <input
        v-model="newPort"
        type="number"
        min="1024"
        max="65535"
        placeholder="Port (1024-65535)"
        class="proxy-input proxy-port-input"
        @keydown.enter="handleAddPort"
      />
      <input
        v-model="newLabel"
        type="text"
        placeholder="Label (optional)"
        class="proxy-input proxy-label-input"
        @keydown.enter="handleAddPort"
      />
      <button class="proxy-add-btn" @click="handleAddPort" title="Add port">
        <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
      </button>
    </div>

    <!-- Port list -->
    <div class="proxy-port-list">
      <div v-if="!proxy.proxyPorts.value.length" class="proxy-empty">
        No ports configured. Add a port above.
      </div>

      <div
        v-for="p in proxy.proxyPorts.value"
        :key="p.port"
        class="proxy-port-item"
        :class="{ disabled: !p.enabled }"
      >
        <button
          class="proxy-port-toggle"
          :class="{ active: p.enabled }"
          @click="proxy.togglePort(p.port)"
          :title="p.enabled ? 'Disable' : 'Enable'"
        >
          <svg v-if="p.enabled" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
          <svg v-else viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>

        <div class="proxy-port-info">
          <span class="proxy-port-number">:{{ p.port }}</span>
          <span v-if="p.label" class="proxy-port-label">{{ p.label }}</span>
        </div>

        <div class="proxy-port-actions">
          <button
            class="proxy-action-btn"
            @click="handleCopy(p.port)"
            :title="copiedPort === p.port ? 'Copied!' : 'Copy URL'"
          >
            <svg v-if="copiedPort === p.port" viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
            <svg v-else viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
          </button>
          <button class="proxy-action-btn proxy-action-remove" @click="proxy.removePort(p.port)" title="Remove">
            <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </div>
      </div>
    </div>
    </template>
  </div>
  </Transition>
</template>
