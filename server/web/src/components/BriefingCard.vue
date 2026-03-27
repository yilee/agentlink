<script setup>
import { computed } from 'vue';

const props = defineProps({
  entry: { type: Object, required: true },
});

const formattedDate = computed(() => {
  try {
    const d = new Date(props.entry.date + 'T12:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return props.entry.date;
  }
});
</script>

<template>
  <div class="briefing-card" tabindex="0">
    <div class="briefing-card-header">
      <span class="briefing-card-icon">&#x1F4CA;</span>
      <span class="briefing-card-date">{{ formattedDate }}</span>
    </div>
    <div class="briefing-card-snippet">{{ entry.tldr }}</div>
    <div class="briefing-card-badges">
      <span v-if="entry.action_today > 0" class="briefing-badge briefing-badge-red">&#x1F534; {{ entry.action_today }} Today</span>
      <span v-if="entry.action_week > 0" class="briefing-badge briefing-badge-yellow">&#x1F7E1; {{ entry.action_week }} This Week</span>
      <span v-if="entry.fyi_count > 0" class="briefing-badge briefing-badge-gray">&#x26AA; {{ entry.fyi_count }} FYI</span>
    </div>
  </div>
</template>
