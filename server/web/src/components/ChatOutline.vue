<script setup>
import { inject, computed, ref, watch, nextTick, onUnmounted } from 'vue';

const store = inject('store');
const chatSearch = inject('chatSearch');

const {
  messages, outlineOpen, toggleOutline,
  scrollToMessage, t,
} = store;

const { messageSearchQuery, messageSearchResults } = chatSearch;

// Build outline items from ALL messages
const outlineItems = computed(() => {
  const items = [];
  let qIndex = 0;
  for (let i = 0; i < messages.value.length; i++) {
    const msg = messages.value[i];
    if (msg.role === 'user') {
      qIndex++;
      let text = msg.content || '';
      if (!text && msg.attachments && msg.attachments.length) {
        text = '[Attachment]';
      }
      // Replace newlines with spaces, truncate
      text = text.replace(/\n/g, ' ').trim();
      if (text.length > 60) text = text.slice(0, 60) + '\u2026';
      items.push({ index: qIndex, msgIdx: i, msgId: msg.id, text });
    }
  }
  return items;
});

// Active (scroll-spy) tracking
const activeId = ref(null);

// IntersectionObserver for scroll-spy
let observer = null;

function setupObserver() {
  if (observer) observer.disconnect();

  // VList renders items inside a scrollable container; find it
  const root = document.querySelector('.message-list');
  if (!root) return;

  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        activeId.value = entry.target.dataset.msgId;
      }
    }
  }, {
    root,
    rootMargin: '-10% 0px -70% 0px',
  });

  // Observe all rendered user-message elements
  root.querySelectorAll('.message-user[data-msg-id]').forEach(el => {
    observer.observe(el);
  });
}

// Re-observe when messages change (virtua may render different items on scroll)
watch(messages, () => {
  if (!outlineOpen.value) return;
  nextTick(setupObserver);
}, { deep: false });

// Setup observer when panel opens
watch(outlineOpen, (open) => {
  if (open) {
    nextTick(setupObserver);
  } else if (observer) {
    observer.disconnect();
  }
});

onUnmounted(() => {
  if (observer) observer.disconnect();
});

function onItemClick(item) {
  scrollToMessage(item.msgIdx);
  activeId.value = item.msgId;
}

function onSearchResultClick(item) {
  scrollToMessage(item.msgIdx);
  toggleOutline();
}

function getSnippetParts(item) {
  const s = item.snippet;
  const start = item.matchStart;
  const len = item.matchLength;
  return {
    before: s.slice(0, start),
    match: s.slice(start, start + len),
    after: s.slice(start + len),
  };
}

function getRoleBadge(role) {
  return role === 'user' ? 'Q' : 'A';
}

// Track input-area height so panel stops above it
const inputAreaHeight = ref(0);
let resizeObserver = null;

watch(outlineOpen, (open) => {
  if (open) {
    nextTick(() => {
      const el = document.querySelector('.input-area');
      if (!el) return;
      inputAreaHeight.value = el.offsetHeight;
      resizeObserver = new ResizeObserver(([entry]) => {
        inputAreaHeight.value = entry.target.offsetHeight;
      });
      resizeObserver.observe(el);
    });
  } else {
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
  }
}, { immediate: true });

onUnmounted(() => {
  if (resizeObserver) resizeObserver.disconnect();
});
</script>

<template>
  <!-- Backdrop -->
  <div v-if="outlineOpen" class="chat-outline-backdrop" :style="{ bottom: inputAreaHeight + 'px' }" @click="toggleOutline"></div>

  <Transition name="file-panel">
    <div v-if="outlineOpen" class="chat-outline-panel" :style="{ bottom: inputAreaHeight + 'px' }">
      <div class="chat-outline-header">
        <span class="chat-outline-title">{{ t('outline.title') }}</span>
        <button class="chat-outline-close" @click="toggleOutline" :title="t('outline.close')">&times;</button>
      </div>
      <div class="chat-outline-search">
        <input
          v-model="messageSearchQuery"
          class="chat-outline-search-input"
          :placeholder="t('outline.searchPlaceholder')"
          @keydown.escape="messageSearchQuery = ''"
        />
      </div>
      <div class="chat-outline-body">
        <!-- Search results mode -->
        <template v-if="messageSearchQuery.trim()">
          <div v-if="messageSearchResults.length === 0" class="chat-outline-empty">
            {{ t('outline.searchNoResults') }}
          </div>
          <div v-else class="chat-outline-list">
            <div class="chat-outline-search-count">{{ t('outline.searchResultCount').replace('{n}', messageSearchResults.length) }}</div>
            <div
              v-for="item in messageSearchResults"
              :key="item.msgId + '-' + item.matchStart"
              class="chat-outline-item chat-search-result"
              @click="onSearchResultClick(item)"
            >
              <span :class="['chat-outline-index', 'chat-search-role', item.role === 'user' ? 'role-user' : 'role-assistant']">{{ getRoleBadge(item.role) }}</span>
              <span class="chat-outline-text">{{ getSnippetParts(item).before }}<mark>{{ getSnippetParts(item).match }}</mark>{{ getSnippetParts(item).after }}</span>
            </div>
          </div>
        </template>
        <!-- Default outline mode -->
        <template v-else>
          <div v-if="outlineItems.length === 0" class="chat-outline-empty">
            {{ t('outline.empty') }}
          </div>
          <div v-else class="chat-outline-list">
            <div
              v-for="item in outlineItems"
              :key="item.msgId"
              :class="['chat-outline-item', { active: activeId === item.msgId }]"
              @click="onItemClick(item)"
            >
              <span class="chat-outline-index">Q{{ item.index }}</span>
              <span class="chat-outline-text">{{ item.text }}</span>
            </div>
          </div>
        </template>
      </div>
    </div>
  </Transition>
</template>
