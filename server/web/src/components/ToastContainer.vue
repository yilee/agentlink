<script setup>
import { useToast } from '../composables/useToast.js';

const { toasts, dismissToast } = useToast();
</script>

<template>
  <div class="toast-container">
    <TransitionGroup name="toast">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="toast-item"
        :class="'toast-' + toast.type"
      >
        <span class="toast-icon">
          <template v-if="toast.type === 'warning'">⚠</template>
          <template v-else-if="toast.type === 'error'">✕</template>
          <template v-else>ℹ</template>
        </span>
        <span class="toast-message" v-html="toast.message"></span>
        <button class="toast-close" @click="dismissToast(toast.id)">×</button>
      </div>
    </TransitionGroup>
  </div>
</template>
