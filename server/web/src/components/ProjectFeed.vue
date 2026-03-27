<script setup>
import { inject, onMounted } from 'vue';
import ProjectCard from './ProjectCard.vue';

const store = inject('store');
const project = inject('project');

const { currentView } = store;
const { projects, loading } = project;

function refresh() {
  project.loadFeed();
}

function openProject(entry) {
  project.selectProject(entry.name);
}

onMounted(() => {
  if (projects.value.length === 0) {
    project.loadFeed();
  }
});
</script>

<template>
  <div class="project-feed" v-if="currentView === 'project-feed'">
    <div class="project-feed-header">
      <div class="project-feed-title">
        <span class="project-feed-title-icon">&#x1F4DA;</span>
        Projects
      </div>
      <button class="project-feed-refresh" @click="refresh" :disabled="loading" title="Refresh">
        <svg :class="{ spinning: loading }" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading && projects.length === 0" class="project-feed-loading">
      <div class="project-feed-spinner"></div>
      <span>Loading projects...</span>
    </div>

    <!-- Grid -->
    <div v-else-if="projects.length > 0" class="project-feed-body">
      <div class="project-feed-grid">
        <ProjectCard
          v-for="entry in projects"
          :key="entry.name"
          :entry="entry"
          @click="openProject(entry)"
        />
      </div>
    </div>

    <!-- Empty -->
    <div v-else class="project-feed-empty">
      <div class="project-feed-empty-icon">&#x1F4DA;</div>
      <p>No projects yet</p>
      <p class="muted">Projects will appear here after Brain processes your project data.</p>
    </div>
  </div>
</template>
