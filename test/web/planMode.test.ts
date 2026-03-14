/**
 * Tests for Plan Mode feature — toggle behavior, message tagging,
 * conversation cache save/restore, and setPlanMode callback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('planMode', () => {
  // Minimal reactive ref helper (mirrors Vue's ref for testing)
  function ref<T>(val: T) {
    return { value: val };
  }

  describe('togglePlanMode', () => {
    it('flips planMode from false to true', () => {
      const planMode = ref(false);
      const isProcessing = ref(false);
      const sent: any[] = [];
      const wsSend = (msg: any) => sent.push(msg);
      const currentConversationId = ref('conv-1');

      function togglePlanMode() {
        if (isProcessing.value) return;
        planMode.value = !planMode.value;
        wsSend({ type: 'set_plan_mode', enabled: planMode.value, conversationId: currentConversationId.value });
      }

      togglePlanMode();
      expect(planMode.value).toBe(true);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toEqual({
        type: 'set_plan_mode',
        enabled: true,
        conversationId: 'conv-1',
      });
    });

    it('flips planMode from true to false', () => {
      const planMode = ref(true);
      const isProcessing = ref(false);
      const sent: any[] = [];
      const wsSend = (msg: any) => sent.push(msg);
      const currentConversationId = ref('conv-2');

      function togglePlanMode() {
        if (isProcessing.value) return;
        planMode.value = !planMode.value;
        wsSend({ type: 'set_plan_mode', enabled: planMode.value, conversationId: currentConversationId.value });
      }

      togglePlanMode();
      expect(planMode.value).toBe(false);
      expect(sent[0].enabled).toBe(false);
    });

    it('is a no-op when isProcessing is true', () => {
      const planMode = ref(false);
      const isProcessing = ref(true);
      const sent: any[] = [];
      const wsSend = (msg: any) => sent.push(msg);
      const currentConversationId = ref('conv-3');

      function togglePlanMode() {
        if (isProcessing.value) return;
        planMode.value = !planMode.value;
        wsSend({ type: 'set_plan_mode', enabled: planMode.value, conversationId: currentConversationId.value });
      }

      togglePlanMode();
      expect(planMode.value).toBe(false);
      expect(sent).toHaveLength(0);
    });
  });

  describe('message tagging', () => {
    it('tags user message with planMode when Plan Mode is active', () => {
      const planMode = ref(true);

      const userMsg = {
        id: 1, role: 'user',
        content: 'Analyze the codebase',
        planMode: planMode.value || undefined,
        timestamp: new Date(),
      };

      expect(userMsg.planMode).toBe(true);
    });

    it('does not tag user message when Plan Mode is inactive', () => {
      const planMode = ref(false);

      const userMsg = {
        id: 2, role: 'user',
        content: 'Write some code',
        planMode: planMode.value || undefined,
        timestamp: new Date(),
      };

      expect(userMsg.planMode).toBeUndefined();
    });
  });

  describe('conversationCache save/restore', () => {
    it('saves planMode in conversation cache', () => {
      const planMode = ref(true);
      const conversationCache: Record<string, any> = {};

      // Simulate saving current conversation state
      conversationCache['conv-A'] = {
        messages: [],
        isProcessing: false,
        planMode: planMode.value,
      };

      expect(conversationCache['conv-A'].planMode).toBe(true);
    });

    it('restores planMode from cached conversation', () => {
      const planMode = ref(false);
      const conversationCache: Record<string, any> = {
        'conv-B': {
          messages: [],
          isProcessing: false,
          planMode: true,
        },
      };

      // Simulate restoring cached conversation
      const cached = conversationCache['conv-B'];
      planMode.value = cached.planMode || false;

      expect(planMode.value).toBe(true);
    });

    it('defaults planMode to false for new blank conversation', () => {
      const planMode = ref(true);
      const conversationCache: Record<string, any> = {};

      // Simulate switching to a new conversation with no cache
      const cached = conversationCache['new-conv'];
      if (cached) {
        planMode.value = cached.planMode || false;
      } else {
        planMode.value = false;
      }

      expect(planMode.value).toBe(false);
    });

    it('restores planMode as false when cache has planMode false', () => {
      const planMode = ref(true);
      const conversationCache: Record<string, any> = {
        'conv-C': {
          messages: [],
          isProcessing: false,
          planMode: false,
        },
      };

      const cached = conversationCache['conv-C'];
      planMode.value = cached.planMode || false;

      expect(planMode.value).toBe(false);
    });
  });

  describe('setPlanMode', () => {
    it('sets planMode to true', () => {
      const planMode = ref(false);

      function setPlanMode(enabled: boolean) {
        planMode.value = enabled;
      }

      setPlanMode(true);
      expect(planMode.value).toBe(true);
    });

    it('sets planMode to false', () => {
      const planMode = ref(true);

      function setPlanMode(enabled: boolean) {
        planMode.value = enabled;
      }

      setPlanMode(false);
      expect(planMode.value).toBe(false);
    });
  });
});
