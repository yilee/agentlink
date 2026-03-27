<script setup>
import { computed } from 'vue';

const props = defineProps({
  entry: { type: Object, required: true },
  type: { type: String, required: true }, // 'pr' | 'wi'
});

const statusClass = computed(() => {
  if (props.type === 'pr') {
    const s = (props.entry.status || '').toLowerCase();
    if (s === 'completed') return 'devops-status-green';
    if (s === 'draft') return 'devops-status-gray';
    if (s === 'abandoned') return 'devops-status-gray';
    return 'devops-status-blue';
  }
  const s = (props.entry.state || '').toLowerCase();
  if (s === 'active') return 'devops-status-yellow';
  if (s === 'resolved' || s === 'closed') return 'devops-status-green';
  return 'devops-status-blue';
});

const statusLabel = computed(() => {
  if (props.type === 'pr') return props.entry.status || 'Active';
  return props.entry.state || 'New';
});

const reviewerSummary = computed(() => {
  if (props.type !== 'pr' || !props.entry.reviewers) return null;
  const total = props.entry.reviewers.length;
  const approved = props.entry.reviewers.filter(r => r.vote === 'approved').length;
  return `${approved}/${total} approved`;
});

const mentionLabel = computed(() => {
  const n = props.entry.total_mentions || 0;
  return n === 1 ? '1 mention' : `${n} mentions`;
});

const priorityClass = computed(() => {
  if (props.type !== 'wi') return '';
  const p = props.entry.priority;
  if (p === '1') return 'devops-priority-high';
  if (p === '2') return 'devops-priority-medium';
  return 'devops-priority-low';
});
</script>

<template>
  <div class="devops-card" tabindex="0">
    <div class="devops-card-header">
      <span class="devops-card-id">#{{ type === 'pr' ? entry.pr_number : entry.work_item_id }}</span>
      <span :class="['devops-status-badge', statusClass]">{{ statusLabel }}</span>
    </div>
    <div class="devops-card-title">{{ entry.title || '(Untitled)' }}</div>
    <div class="devops-card-meta">
      <template v-if="type === 'pr'">
        <span class="devops-card-repo">{{ entry.repository }}</span>
      </template>
      <template v-else>
        <span :class="['devops-card-priority', priorityClass]">P{{ entry.priority || 'N/A' }}</span>
        <span class="devops-card-dot">&middot;</span>
        <span class="devops-card-project">{{ entry.project }}</span>
      </template>
    </div>
    <div class="devops-card-footer">
      <span v-if="reviewerSummary" class="devops-card-reviewers">{{ reviewerSummary }}</span>
      <span v-if="entry.total_mentions > 0" class="devops-card-mentions">{{ mentionLabel }}</span>
    </div>
  </div>
</template>
