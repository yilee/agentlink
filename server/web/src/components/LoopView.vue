<script setup>
import { inject } from 'vue';
import LoopExecDetail from './LoopExecDetail.vue';
import LoopDetail from './LoopDetail.vue';
import LoopCreatePanel from './LoopCreatePanel.vue';

const store = inject('store');
const loopStore = inject('loop');

const { t, viewMode } = store;

const {
  selectedLoop,
  selectedExecution,
  hasRunningLoop,
  firstRunningLoop,
  loopDeleteConfirmOpen,
  loopDeleteConfirmName,
  confirmDeleteLoop,
  cancelDeleteLoop,
  viewLoop,
} = loopStore;
</script>

<template>
  <template v-if="viewMode === 'loop'">

    <!-- Execution detail view -->
    <LoopExecDetail v-if="selectedLoop && selectedExecution" />

    <!-- Loop detail view (execution history) -->
    <LoopDetail v-else-if="selectedLoop" />

    <!-- Loop creation panel (default) -->
    <LoopCreatePanel v-else />

    <!-- Running Loop notification banner -->
    <div v-if="hasRunningLoop && !selectedLoop" class="loop-running-banner">
      <span class="loop-running-banner-dot"></span>
      <span>{{ firstRunningLoop.name }} {{ t('loop.isRunning') }}</span>
      <button class="loop-action-btn loop-action-sm" @click="viewLoop(firstRunningLoop.loopId)">{{ t('loop.view') }}</button>
    </div>

    <!-- Loop delete confirm dialog -->
    <div v-if="loopDeleteConfirmOpen" class="modal-overlay" @click.self="cancelDeleteLoop()">
      <div class="modal-dialog">
        <div class="modal-title">{{ t('loop.deleteLoop') }}</div>
        <div class="modal-body" v-html="t('loop.deleteConfirm', { name: loopDeleteConfirmName })"></div>
        <div class="modal-actions">
          <button class="modal-confirm-btn" @click="confirmDeleteLoop()">{{ t('loop.delete') }}</button>
          <button class="modal-cancel-btn" @click="cancelDeleteLoop()">{{ t('loop.cancel') }}</button>
        </div>
      </div>
    </div>
  </template>
</template>
