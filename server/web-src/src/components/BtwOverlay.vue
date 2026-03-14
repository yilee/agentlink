<script setup>
import { inject } from 'vue';

const store = inject('store');
const { btwState, dismissBtw, renderMarkdown, isMobile, t } = store;
</script>

<template>
  <!-- ══ Side question overlay ══ -->
  <Transition name="fade">
    <div v-if="btwState" class="btw-overlay" @click.self="dismissBtw">
      <div class="btw-panel">
        <div class="btw-header">
          <span class="btw-title">{{ t('btw.title') }}</span>
          <button class="btw-close" @click="dismissBtw" :aria-label="t('btw.dismiss')">&#10005;</button>
        </div>
        <div class="btw-body">
          <div class="btw-question">{{ btwState.question }}</div>
          <div v-if="btwState.error" class="btw-error">{{ btwState.error }}</div>
          <template v-else>
            <div v-if="btwState.answer" class="btw-answer markdown-body" v-html="renderMarkdown(btwState.answer)"></div>
            <div v-if="!btwState.done" class="btw-loading">
              <span class="btw-loading-dots"><span></span><span></span><span></span></span>
              <span v-if="!btwState.answer" class="btw-loading-text">{{ t('btw.thinking') }}</span>
            </div>
          </template>
        </div>
        <div v-if="btwState.done && !btwState.error" class="btw-hint">
          {{ isMobile ? t('btw.tapDismiss') : t('btw.escDismiss') }}
        </div>
      </div>
    </div>
  </Transition>
</template>
