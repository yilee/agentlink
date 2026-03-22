<script setup>
import { inject, ref, onMounted, onUnmounted } from 'vue';

const store = inject('store');
const sidebar = inject('sidebar');

const {
  status,
  theme,
  viewMode,
  isMsRoute,
  agentName,
  latency,
  displayStatus,
  toggleTheme,
  toggleLocale,
  localeLabel,
  t
} = store;

const { toggleSidebar } = sidebar;

const entraPhotoUrl = ref(window.__entraUser?.photoUrl || null);
const onPhotoReady = (e) => { entraPhotoUrl.value = e.detail; };
onMounted(() => window.addEventListener('entra-photo-ready', onPhotoReady));
onUnmounted(() => window.removeEventListener('entra-photo-ready', onPhotoReady));
</script>

<template>
      <header class="top-bar">
        <div class="top-bar-left">
          <button class="sidebar-toggle" @click="toggleSidebar" :title="t('header.toggleSidebar')">
            <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>
          </button>
          <h1>AgenticWorker</h1>
        </div>
        <div class="top-bar-info">
          <span :class="['badge', status.toLowerCase()]">{{ displayStatus }}</span>
          <span v-if="latency !== null && status === 'Connected'" class="latency" :class="{ good: latency < 100, ok: latency >= 100 && latency < 500, bad: latency >= 500 }">{{ latency }}ms</span>
          <span v-if="agentName" class="agent-label">
            <img v-if="entraPhotoUrl" :src="entraPhotoUrl" class="user-avatar" alt="" />
            {{ agentName }}
          </span>
          <div class="team-mode-toggle">
            <button :class="['team-mode-btn', { active: viewMode === 'chat' }]" @click="viewMode = 'chat'">{{ t('header.chat') }}</button>
            <button v-if="isMsRoute" :class="['team-mode-btn', { active: viewMode === 'feed' }]" @click="viewMode = 'feed'">Feed</button>
            <button :class="['team-mode-btn', { active: viewMode === 'team' }]" @click="viewMode = 'team'">{{ t('header.team') }}</button>
            <button :class="['team-mode-btn', { active: viewMode === 'loop' }]" @click="viewMode = 'loop'">{{ t('header.loop') }}</button>
          </div>
          <select class="team-mode-select" :value="viewMode" @change="viewMode = $event.target.value">
            <option value="chat">{{ t('header.chat') }}</option>
            <option v-if="isMsRoute" value="feed">Feed</option>
            <option value="team">{{ t('header.team') }}</option>
            <option value="loop">{{ t('header.loop') }}</option>
          </select>
          <button class="theme-toggle" @click="toggleTheme" :title="theme === 'dark' ? t('header.lightMode') : t('header.darkMode')">
            <svg v-if="theme === 'dark'" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58a.996.996 0 0 0-1.41 0 .996.996 0 0 0 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37a.996.996 0 0 0-1.41 0 .996.996 0 0 0 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0a.996.996 0 0 0 0-1.41l-1.06-1.06zm1.06-10.96a.996.996 0 0 0 0-1.41.996.996 0 0 0-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36a.996.996 0 0 0 0-1.41.996.996 0 0 0-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z"/></svg>
            <svg v-else viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/></svg>
          </button>
          <button class="theme-toggle" @click="toggleLocale" :title="localeLabel">{{ localeLabel }}</button>
        </div>
      </header>
</template>
