<script setup>
import { computed } from 'vue';
import { getMeetingTypeBadge } from '../modules/recap.js';

const props = defineProps({
  entry: { type: Object, required: true },
});

const badge = computed(() => getMeetingTypeBadge(props.entry.meeting_type));

const formattedTime = computed(() => {
  try {
    const d = new Date(props.entry.date_local);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
});
</script>

<template>
  <div class="recap-card" tabindex="0">
    <div class="recap-card-title">{{ entry.meeting_name }}</div>
    <div class="recap-card-meta">
      <span class="recap-card-time">{{ formattedTime }}</span>
      <span :class="['recap-card-badge', 'recap-badge-' + badge.color]">{{ badge.label }}</span>
    </div>
    <div v-if="entry.for_you_count > 0" class="recap-card-foryou">
      <span class="recap-card-pin">&#x1F4CC;</span> {{ entry.for_you_count }}
    </div>
    <div class="recap-card-snippet">{{ entry.tldr_snippet }}</div>
  </div>
</template>
