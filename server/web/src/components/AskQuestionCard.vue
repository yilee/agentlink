<script setup>
import { inject } from 'vue';

defineProps(['msg']);

const store = inject('store');

const {
  t,
  selectQuestionOption,
  submitQuestionAnswer,
  hasQuestionAnswer,
  getQuestionResponseSummary,
  getRenderedContent,
} = store;
</script>

<template>
  <div class="ask-question-wrapper">
    <div v-if="!msg.answered" class="ask-question-card">
      <div v-for="(q, qi) in msg.questions" :key="qi" class="ask-question-block">
        <div v-if="q.header" class="ask-question-header">{{ q.header }}</div>
        <div class="ask-question-text">{{ q.question }}</div>
        <div class="ask-question-options">
          <div
            v-for="(opt, oi) in q.options" :key="oi"
            :class="['ask-question-option', {
              selected: q.multiSelect
                ? (msg.selectedAnswers[qi] || []).includes(opt.label)
                : msg.selectedAnswers[qi] === opt.label
            }]"
            @click="selectQuestionOption(msg, qi, opt.label)"
          >
            <div class="ask-option-label">{{ opt.label }}</div>
            <div v-if="opt.description" class="ask-option-desc">{{ opt.description }}</div>
          </div>
        </div>
        <div class="ask-question-custom">
          <input
            type="text"
            v-model="msg.customTexts[qi]"
            :placeholder="t('chat.customResponse')"
            @input="msg.selectedAnswers[qi] = q.multiSelect ? [] : null"
            @keydown.enter="hasQuestionAnswer(msg) && submitQuestionAnswer(msg)"
          />
        </div>
      </div>
      <div class="ask-question-actions">
        <button class="ask-question-submit" :disabled="!hasQuestionAnswer(msg)" @click="submitQuestionAnswer(msg)">
          {{ t('chat.submit') }}
        </button>
      </div>
    </div>
    <div v-else class="ask-question-answered">
      <span class="ask-answered-icon">&#x2713;</span>
      <span class="ask-answered-text">{{ getQuestionResponseSummary(msg) }}</span>
    </div>
  </div>
</template>
