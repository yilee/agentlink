<script setup>
import { inject } from 'vue';

const store = inject('store');
const sidebarStore = inject('sidebar');

const { t } = store;

const {
  folderPickerOpen, folderPickerLoading, folderPickerPath,
  folderPickerEntries, folderPickerSelected,
  folderPickerNavigateUp, folderPickerSelectItem, folderPickerEnter,
  folderPickerGoToPath, confirmFolderPicker,
} = sidebarStore;
</script>

<template>
  <!-- Folder Picker Modal -->
  <div class="folder-picker-overlay" v-if="folderPickerOpen" @click.self="folderPickerOpen = false">
    <div class="folder-picker-dialog">
      <div class="folder-picker-header">
        <span>{{ t('folderPicker.title') }}</span>
        <button class="folder-picker-close" @click="folderPickerOpen = false">&times;</button>
      </div>
      <div class="folder-picker-nav">
        <button class="folder-picker-up" @click="folderPickerNavigateUp" :disabled="!folderPickerPath" :title="t('folderPicker.parentDir')">
          <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
        </button>
        <input class="folder-picker-path-input" type="text" v-model="folderPickerPath" @keydown.enter="folderPickerGoToPath" :placeholder="t('folderPicker.pathPlaceholder')" spellcheck="false" />
      </div>
      <div class="folder-picker-list">
        <div v-if="folderPickerLoading" class="folder-picker-loading">
          <div class="history-loading-spinner"></div>
          <span>{{ t('preview.loading') }}</span>
        </div>
        <template v-else>
          <div
            v-for="entry in folderPickerEntries" :key="entry.name"
            :class="['folder-picker-item', { 'folder-picker-selected': folderPickerSelected === entry.name }]"
            @click="folderPickerSelectItem(entry)"
            @dblclick="folderPickerEnter(entry)"
          >
            <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
            <span>{{ entry.name }}</span>
          </div>
          <div v-if="folderPickerEntries.length === 0" class="folder-picker-empty">{{ t('folderPicker.noSubdirs') }}</div>
        </template>
      </div>
      <div class="folder-picker-footer">
        <button class="folder-picker-cancel" @click="folderPickerOpen = false">{{ t('folderPicker.cancel') }}</button>
        <button class="folder-picker-confirm" @click="confirmFolderPicker" :disabled="!folderPickerPath">{{ t('folderPicker.open') }}</button>
      </div>
    </div>
  </div>
</template>
