<script setup>
import { inject } from 'vue';
import { useConfirmDialog } from '../composables/useConfirmDialog.js';

const store = inject('store');
const { t } = store;

const {
  confirmOpen, confirmTitle, confirmMessage, confirmItemName,
  confirmWarning, confirmButtonText, doConfirm, doCancel,
} = useConfirmDialog();
</script>

<template>
  <div class="confirm-overlay" v-if="confirmOpen" @click.self="doCancel">
    <div class="confirm-dialog">
      <div class="confirm-dialog-header">{{ confirmTitle }}</div>
      <div class="confirm-dialog-body">
        <p>{{ confirmMessage }}</p>
        <p v-if="confirmItemName" class="confirm-dialog-item">{{ confirmItemName }}</p>
        <p v-if="confirmWarning" class="confirm-dialog-warning">{{ confirmWarning }}</p>
      </div>
      <div class="confirm-dialog-footer">
        <button class="confirm-dialog-cancel" @click="doCancel">{{ t('dialog.cancel') }}</button>
        <button class="confirm-dialog-btn" @click="doConfirm">{{ confirmButtonText || t('dialog.delete') }}</button>
      </div>
    </div>
  </div>
</template>
