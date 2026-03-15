<script setup>
import { inject } from 'vue';

const store = inject('store');
const {
  authRequired, authLocked, authPassword, authError, authAttempts,
  submitPassword, t
} = store;
</script>

<template>
  <!-- Password Authentication Dialog -->
  <div class="folder-picker-overlay" v-if="authRequired && !authLocked">
    <div class="auth-dialog">
      <div class="auth-dialog-header">
        <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
        <span>{{ t('auth.sessionProtected') }}</span>
      </div>
      <div class="auth-dialog-body">
        <p>{{ t('auth.passwordRequired') }}</p>
        <input
          type="password"
          class="auth-password-input"
          v-model="authPassword"
          @keydown.enter="submitPassword"
          :placeholder="t('auth.passwordPlaceholder')"
          autofocus
        />
        <p v-if="authError" class="auth-error">{{ authError }}</p>
        <p v-if="authAttempts" class="auth-attempts">{{ authAttempts }}</p>
      </div>
      <div class="auth-dialog-footer">
        <button class="auth-submit-btn" @click="submitPassword" :disabled="!authPassword.trim()">{{ t('auth.unlock') }}</button>
      </div>
    </div>
  </div>

  <!-- Auth Locked Out -->
  <div class="folder-picker-overlay" v-if="authLocked">
    <div class="auth-dialog auth-dialog-locked">
      <div class="auth-dialog-header">
        <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>
        <span>{{ t('auth.accessLocked') }}</span>
      </div>
      <div class="auth-dialog-body">
        <p>{{ authError }}</p>
        <p class="auth-locked-hint">{{ t('auth.tryAgainLater') }}</p>
      </div>
    </div>
  </div>
</template>
