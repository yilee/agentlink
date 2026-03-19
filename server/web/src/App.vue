<script setup>
import { provide } from 'vue';
import { createStore } from './store.js';

import BtwOverlay from './components/BtwOverlay.vue';
import FolderPickerDialog from './components/FolderPickerDialog.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import AuthDialog from './components/AuthDialog.vue';
import TopBar from './components/TopBar.vue';
import Sidebar from './components/Sidebar.vue';
import FilePanel from './components/FilePanel.vue';
import GitPanel from './components/GitPanel.vue';
import TeamView from './components/TeamView.vue';
import LoopView from './components/LoopView.vue';
import ChatView from './components/ChatView.vue';
import ChatInput from './components/ChatInput.vue';
import PreviewPanel from './components/PreviewPanel.vue';
import ToastContainer from './components/ToastContainer.vue';

// Create store inside component setup() so onMounted/onUnmounted hooks fire correctly
const store = createStore();
provide('store', store);
provide('team', store._team);
provide('loop', store._loop);
provide('sidebar', store._sidebar);
provide('files', store._files);

// Only destructure what App.vue template actually needs
const {
  status, displayStatus, agentName, workDir, sessionId, error,
  messages, viewMode, t,
  _files: { fileBrowser, fileContextMenu, filePanelOpen, previewPanelOpen },
  _sidebar: { sidebarOpen, workdirSwitching },
} = store;
</script>

<template>

    <div class="layout">
      <TopBar />

      <div v-if="status === 'No Session' || (status !== 'Connected' && status !== 'Connecting...' && status !== 'Reconnecting...' && messages.length === 0)" class="center-card">
        <div class="status-card">
          <p class="status">
            <span class="label">{{ t('statusCard.status') }}</span>
            <span :class="['badge', status.toLowerCase()]">{{ displayStatus }}</span>
          </p>
          <p v-if="agentName" class="info"><span class="label">{{ t('statusCard.agent') }}</span> {{ agentName }}</p>
          <p v-if="workDir" class="info"><span class="label">{{ t('statusCard.directory') }}</span> {{ workDir }}</p>
          <p v-if="sessionId" class="info muted"><span class="label">{{ t('statusCard.session') }}</span> {{ sessionId }}</p>
          <p v-if="error" class="error-msg">{{ error }}</p>
        </div>
      </div>

      <div v-else class="main-body">
        <Sidebar />

        <FilePanel />

        <GitPanel />

        <!-- Chat area -->
        <div class="chat-area">

          <!-- ══ Team Dashboard ══ -->
          <TeamView />

          <!-- ══ Loop Dashboard ══ -->
          <LoopView />

          <!-- ══ Normal Chat ══ -->
          <ChatView />

          <BtwOverlay />

          <!-- Input area (shown in both chat and team create mode) -->
          <ChatInput />

        </div>

        <PreviewPanel />

      </div>

      <FolderPickerDialog />

      <ConfirmDialog />

      <AuthDialog />

      <!-- Workdir switching overlay -->
      <Transition name="fade">
        <div v-if="workdirSwitching" class="workdir-switching-overlay">
          <div class="workdir-switching-spinner"></div>
          <div class="workdir-switching-text">{{ t('workdir.switching') }}</div>
        </div>
      </Transition>

      <!-- File context menu -->
      <div
        v-if="fileContextMenu"
        class="file-context-menu"
        :style="{ left: fileContextMenu.x + 'px', top: fileContextMenu.y + 'px' }"
      >
        <!-- Folder menu items -->
        <template v-if="fileContextMenu.isDirectory">
          <div class="file-context-item" @click="fileBrowser.startNewFile(fileContextMenu.path)">
            <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 14h-3v3h-2v-3H8v-2h3v-3h2v3h3v2zm-3-7V3.5L18.5 9H13z"/></svg>
            {{ t('file.newFile') }}
          </div>
          <div class="file-context-item" @click="fileBrowser.startNewFolder(fileContextMenu.path)">
            <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M20 6h-8l-2-2H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-1 8h-3v3h-2v-3h-3v-2h3V9h2v3h3v2z"/></svg>
            {{ t('file.newFolder') }}
          </div>
        </template>
        <!-- File menu items -->
        <template v-else>
          <div class="file-context-item" @click="fileBrowser.askClaudeRead()">
            <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zM5 15h14v2H5zm0-4h14v2H5zm0-4h14v2H5z"/></svg>
            {{ t('contextMenu.askClaudeRead') }}
          </div>
          <div class="file-context-item" @click="fileBrowser.copyPath()">
            <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
            {{ fileContextMenu.copied ? t('contextMenu.copied') : t('contextMenu.copyPath') }}
          </div>
          <div class="file-context-item" @click="fileBrowser.insertPath()">
            <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/></svg>
            {{ t('contextMenu.insertPath') }}
          </div>
        </template>
      </div>
    </div>

    <ToastContainer />
</template>
