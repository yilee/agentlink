<script setup>
import { ref, computed } from 'vue';
import { getSectionIcon } from '../modules/recap.js';

const props = defineProps({
  title: { type: String, required: true },
  sectionType: { type: String, required: true },
  items: { type: Array, default: () => [] },
  omittedCount: { type: Number, default: 0 },
  totalCount: { type: Number, default: 0 },
});

const THRESHOLD = 3;
const expanded = ref(false);

const icon = computed(() => getSectionIcon(props.sectionType));

const visibleItems = computed(() => {
  if (expanded.value) return props.items;
  if (props.items.length <= THRESHOLD) return props.items;
  return props.items.slice(0, 2);
});

const hiddenCount = computed(() => {
  if (expanded.value) return 0;
  if (props.items.length <= THRESHOLD) return 0;
  return props.items.length - 2 + props.omittedCount;
});
</script>

<template>
  <div class="recap-hook-section">
    <div class="recap-hook-header">
      <span class="recap-hook-icon">{{ icon }}</span>
      <span class="recap-hook-title">{{ title }}</span>
      <span v-if="totalCount" class="recap-hook-count">({{ totalCount }})</span>
    </div>
    <div class="recap-hook-items">
      <div v-for="(item, i) in visibleItems" :key="i" class="recap-hook-item">
        <span class="recap-hook-bullet">&bull;</span>
        <div class="recap-hook-item-content">
          <span v-if="item.tag" class="recap-hook-tag">[{{ item.tag }}]</span>
          <span>{{ item.text || item.action || item.description || '' }}</span>
          <span v-if="item.owner || item.championed_by" class="recap-hook-owner">
            &mdash; {{ item.owner || (Array.isArray(item.championed_by) ? item.championed_by.join(', ') : item.championed_by) }}
          </span>
          <span v-if="item.due" class="recap-hook-due"> &mdash; Due: {{ item.due }}</span>
        </div>
      </div>
    </div>
    <button v-if="hiddenCount > 0" class="recap-hook-show-more" @click="expanded = true">
      &middot;&middot;&middot; and {{ hiddenCount }} more
      <span class="recap-hook-expand-icon">&#x25BE;</span>
    </button>
    <button v-else-if="expanded && items.length > THRESHOLD" class="recap-hook-show-more" @click="expanded = false">
      Show less
      <span class="recap-hook-expand-icon">&#x25B4;</span>
    </button>
  </div>
</template>
