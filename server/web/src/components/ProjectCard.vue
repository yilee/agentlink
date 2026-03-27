<script setup>
import { computed } from 'vue';

const props = defineProps({
  entry: { type: Object, required: true },
});

const description = computed(() => {
  return props.entry.description || '';
});

const statsItems = computed(() => {
  const items = [];
  if (props.entry.workstreamCount > 0) {
    items.push({ label: 'workstreams', count: props.entry.workstreamCount });
  }
  if (props.entry.blockerCount > 0) {
    items.push({ label: 'blockers', count: props.entry.blockerCount, warn: true });
  }
  if (props.entry.pendingDecisionCount > 0) {
    items.push({ label: 'pending', count: props.entry.pendingDecisionCount });
  }
  if (props.entry.staleItemCount > 0) {
    items.push({ label: 'stale', count: props.entry.staleItemCount });
  }
  return items;
});

const lastModifiedLabel = computed(() => {
  if (!props.entry.lastModified) return '';
  const d = new Date(props.entry.lastModified);
  return d.toLocaleDateString();
});
</script>

<template>
  <div class="project-card" tabindex="0">
    <div class="project-card-header">
      <span class="project-card-name">{{ entry.title || entry.name }}</span>
    </div>
    <div v-if="description" class="project-card-description">{{ description }}</div>
    <div v-if="statsItems.length" class="project-card-stats">
      <span v-for="(stat, i) in statsItems" :key="stat.label" :class="['project-card-stat', { 'project-card-stat-warn': stat.warn }]">
        <template v-if="i > 0"><span class="project-card-dot">&middot;</span></template>
        {{ stat.count }} {{ stat.label }}
      </span>
    </div>
    <div v-if="lastModifiedLabel" class="project-card-footer">
      <span class="project-card-date">{{ lastModifiedLabel }}</span>
    </div>
  </div>
</template>
