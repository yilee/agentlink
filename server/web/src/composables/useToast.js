import { ref } from 'vue';

// Module-level state — singleton shared across all callers
const toasts = ref([]);
let nextId = 0;

export function useToast() {
  function showToast(message, { type = 'warning', duration = 5000 } = {}) {
    const id = nextId++;
    toasts.value.push({ id, message, type });
    if (duration > 0) {
      setTimeout(() => dismissToast(id), duration);
    }
    return id;
  }

  function dismissToast(id) {
    toasts.value = toasts.value.filter(t => t.id !== id);
  }

  return { toasts, showToast, dismissToast };
}
