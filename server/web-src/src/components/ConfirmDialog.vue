<script setup>
import { inject } from 'vue';

const store = inject('store');
const sidebarStore = inject('sidebar');
const teamStore = inject('team');

const { t } = store;

const {
  deleteConfirmOpen, deleteConfirmTitle, cancelDeleteSession, confirmDeleteSession,
} = sidebarStore;

const {
  deleteTeamConfirmOpen, deleteTeamConfirmTitle, cancelDeleteTeam, confirmDeleteTeam,
} = teamStore;
</script>

<template>
  <!-- Delete Session Confirmation Dialog -->
  <div class="folder-picker-overlay" v-if="deleteConfirmOpen" @click.self="cancelDeleteSession">
    <div class="delete-confirm-dialog">
      <div class="delete-confirm-header">{{ t('dialog.deleteSession') }}</div>
      <div class="delete-confirm-body">
        <p>{{ t('dialog.deleteSessionConfirm') }}</p>
        <p class="delete-confirm-title">{{ deleteConfirmTitle }}</p>
        <p class="delete-confirm-warning">{{ t('dialog.cannotUndo') }}</p>
      </div>
      <div class="delete-confirm-footer">
        <button class="folder-picker-cancel" @click="cancelDeleteSession">{{ t('dialog.cancel') }}</button>
        <button class="delete-confirm-btn" @click="confirmDeleteSession">{{ t('dialog.delete') }}</button>
      </div>
    </div>
  </div>

  <!-- Delete Team Confirmation Dialog -->
  <div class="folder-picker-overlay" v-if="deleteTeamConfirmOpen" @click.self="cancelDeleteTeam">
    <div class="delete-confirm-dialog">
      <div class="delete-confirm-header">{{ t('dialog.deleteTeam') }}</div>
      <div class="delete-confirm-body">
        <p>{{ t('dialog.deleteTeamConfirm') }}</p>
        <p class="delete-confirm-title">{{ deleteTeamConfirmTitle }}</p>
        <p class="delete-confirm-warning">{{ t('dialog.cannotUndo') }}</p>
      </div>
      <div class="delete-confirm-footer">
        <button class="folder-picker-cancel" @click="cancelDeleteTeam">{{ t('dialog.cancel') }}</button>
        <button class="delete-confirm-btn" @click="confirmDeleteTeam">{{ t('dialog.delete') }}</button>
      </div>
    </div>
  </div>
</template>
