<script setup>
defineProps({
  items: { type: Array, required: true },
});
</script>

<template>
  <div class="recap-for-you">
    <div class="recap-for-you-header">
      <span class="recap-for-you-icon">&#x1F4CC;</span> FOR YOU
    </div>
    <div class="recap-for-you-list">
      <div v-for="(item, i) in items" :key="i" class="recap-for-you-item">
        <div class="recap-for-you-text">&bull; {{ item.text }}</div>
        <div v-if="item.reason" class="recap-for-you-reason">{{ item.reason }}</div>
      </div>
    </div>
  </div>
</template>
