<script setup>
import { inject, ref } from 'vue';

const store = inject('store');
const filesStore = inject('files');

const { isMobile } = store;

const {
  gitPanelOpen,
  git,
  filePanelWidth,
} = filesStore;
</script>

<template>
        <!-- Git panel (desktop) -->
        <Transition name="file-panel">
        <div v-if="gitPanelOpen && !isMobile" class="file-panel git-panel" :style="{ width: filePanelWidth + 'px' }">
          <div class="file-panel-header">
            <span class="file-panel-title">GIT</span>
            <div class="file-panel-actions">
              <button class="file-panel-btn" @click="git.refresh()" title="Refresh">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
              </button>
              <button class="file-panel-btn" @click="git.closePanel()" title="Close">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
              </button>
            </div>
          </div>

          <!-- Branch bar -->
          <div v-if="git.gitInfo.value && (git.gitInfo.value.branch || git.gitInfo.value.detachedHead)" class="git-branch-bar">
            <div class="git-branch-name">
              <svg class="git-branch-icon" viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                <path fill-rule="evenodd" d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 101.5 0 .75.75 0 00-1.5 0zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z"/>
              </svg>
              <span>{{ git.gitInfo.value.detachedHead || git.gitInfo.value.branch }}</span>
            </div>
            <div v-if="git.gitInfo.value.upstream" class="git-tracking">
              {{ git.gitInfo.value.upstream }}
              <template v-if="git.gitInfo.value.ahead > 0">
                <span class="git-ahead">↑{{ git.gitInfo.value.ahead }}</span>
              </template>
              <template v-if="git.gitInfo.value.behind > 0">
                <span class="git-behind">↓{{ git.gitInfo.value.behind }}</span>
              </template>
            </div>
          </div>

          <!-- Loading -->
          <div v-if="git.gitLoading.value" class="file-panel-loading">Loading...</div>

          <!-- Not a repo -->
          <div v-else-if="git.gitInfo.value && !git.gitInfo.value.isRepo" class="git-not-repo">
            Not a git repository
          </div>

          <!-- File list -->
          <div v-else-if="git.gitInfo.value" class="git-file-list">
            <!-- Clean state -->
            <div v-if="!git.gitInfo.value.staged?.length && !git.gitInfo.value.modified?.length && !git.gitInfo.value.untracked?.length" class="git-clean-state">
              <svg viewBox="0 0 24 24" width="32" height="32"><path fill="currentColor" opacity="0.5" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
              <span>Clean working tree</span>
            </div>

            <template v-else>
              <!-- Staged -->
              <template v-if="git.gitInfo.value.staged?.length">
                <div class="git-group-header" @click="git.toggleGroup('staged')">
                  <span class="git-group-arrow" :class="{ expanded: git.expandedGroups.value.staged }">&#9654;</span>
                  <span class="git-group-label">Staged ({{ git.gitInfo.value.staged.length }})</span>
                  <div class="git-group-actions" @click.stop>
                    <button class="git-action-btn git-action-unstage" @click="git.unstageAll(git.gitInfo.value.staged)" title="Unstage All">
                      <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M19 13H5v-2h14v2z"/></svg>
                    </button>
                  </div>
                </div>
                <template v-if="git.expandedGroups.value.staged">
                  <div v-for="entry in git.gitInfo.value.staged" :key="'s-' + entry.path"
                       class="git-file-item" @click="git.openFileDiff(entry, true)">
                    <span class="git-status-icon" :class="'git-status-' + entry.status">{{ entry.status }}</span>
                    <span class="git-file-name">{{ entry.path.split('/').pop() }}</span>
                    <span v-if="entry.path.includes('/')" class="git-file-dir">{{ entry.path.split('/').slice(0, -1).join('/') }}</span>
                    <div class="git-file-actions" @click.stop>
                      <button class="git-action-btn git-action-unstage" @click="git.unstageFile(entry.path)" title="Unstage">
                        <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M19 13H5v-2h14v2z"/></svg>
                      </button>
                    </div>
                  </div>
                </template>
              </template>

              <!-- Modified -->
              <template v-if="git.gitInfo.value.modified?.length">
                <div class="git-group-header" @click="git.toggleGroup('modified')">
                  <span class="git-group-arrow" :class="{ expanded: git.expandedGroups.value.modified }">&#9654;</span>
                  <span class="git-group-label">Modified ({{ git.gitInfo.value.modified.length }})</span>
                  <div class="git-group-actions" @click.stop>
                    <button class="git-action-btn git-action-stage" @click="git.stageAll(git.gitInfo.value.modified)" title="Stage All">
                      <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                    </button>
                  </div>
                </div>
                <template v-if="git.expandedGroups.value.modified">
                  <div v-for="entry in git.gitInfo.value.modified" :key="'m-' + entry.path"
                       class="git-file-item" @click="git.openFileDiff(entry, false)">
                    <span class="git-status-icon" :class="'git-status-' + entry.status">{{ entry.status }}</span>
                    <span class="git-file-name">{{ entry.path.split('/').pop() }}</span>
                    <span v-if="entry.path.includes('/')" class="git-file-dir">{{ entry.path.split('/').slice(0, -1).join('/') }}</span>
                    <div class="git-file-actions" @click.stop>
                      <button class="git-action-btn git-action-stage" @click="git.stageFile(entry.path)" title="Stage">
                        <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                      </button>
                      <button class="git-action-btn git-action-discard" @click="git.requestDiscard(entry.path)" title="Discard Changes">
                        <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg>
                      </button>
                    </div>
                  </div>
                </template>
              </template>

              <!-- Untracked -->
              <template v-if="git.gitInfo.value.untracked?.length">
                <div class="git-group-header" @click="git.toggleGroup('untracked')">
                  <span class="git-group-arrow" :class="{ expanded: git.expandedGroups.value.untracked }">&#9654;</span>
                  <span class="git-group-label">Untracked ({{ git.gitInfo.value.untracked.length }})</span>
                  <div class="git-group-actions" @click.stop>
                    <button class="git-action-btn git-action-stage" @click="git.stageAll(git.gitInfo.value.untracked)" title="Stage All">
                      <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                    </button>
                  </div>
                </div>
                <template v-if="git.expandedGroups.value.untracked">
                  <div v-for="entry in git.gitInfo.value.untracked" :key="'u-' + entry.path"
                       class="git-file-item" @click="git.openFileDiff(entry, false)">
                    <span class="git-status-icon git-status-U">?</span>
                    <span class="git-file-name">{{ entry.path.split('/').pop() }}</span>
                    <span v-if="entry.path.includes('/')" class="git-file-dir">{{ entry.path.split('/').slice(0, -1).join('/') }}</span>
                    <div class="git-file-actions" @click.stop>
                      <button class="git-action-btn git-action-stage" @click="git.stageFile(entry.path)" title="Stage">
                        <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                      </button>
                    </div>
                  </div>
                </template>
              </template>

              <!-- Commit section -->
              <div v-if="git.gitInfo.value.staged?.length" class="git-commit-section">
                <textarea
                  class="git-commit-input"
                  v-model="git.commitMessage.value"
                  placeholder="Commit message..."
                  rows="3"
                  @keydown.ctrl.enter="git.commit()"
                  @keydown.meta.enter="git.commit()"
                ></textarea>
                <button
                  class="git-commit-btn"
                  :disabled="!git.commitMessage.value.trim() || git.commitInProgress.value"
                  @click="git.commit()"
                >
                  {{ git.commitInProgress.value ? 'Committing...' : 'Commit' }}
                </button>
              </div>
            </template>
          </div>

          <!-- Discard confirmation overlay -->
          <div v-if="git.discardConfirmFile.value" class="git-discard-overlay" @click="git.cancelDiscard()">
            <div class="git-discard-dialog" @click.stop>
              <div class="git-discard-title">Discard Changes</div>
              <div class="git-discard-message">
                Discard changes to <strong>{{ git.discardConfirmFile.value.split('/').pop() }}</strong>?
                This cannot be undone.
              </div>
              <div class="git-discard-actions">
                <button class="git-discard-cancel" @click="git.cancelDiscard()">Cancel</button>
                <button class="git-discard-confirm" @click="git.confirmDiscard()">Discard</button>
              </div>
            </div>
          </div>
        </div>
        </Transition>
</template>
