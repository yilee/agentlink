import { ref, computed, watch, nextTick, onUnmounted } from 'vue';

const SLASH_COMMANDS = [
  { command: '/btw', descKey: 'slash.btw', isPrefix: true },
  { command: '/cost', descKey: 'slash.cost' },
  { command: '/context', descKey: 'slash.context' },
  { command: '/compact', descKey: 'slash.compact' },
];

/**
 * Manages the slash command menu (visibility, filtering, navigation, selection).
 * @param {Object} deps
 * @param {import('vue').Ref<string>} deps.inputText
 * @param {import('vue').Ref} deps.inputRef
 * @param {Function} deps.sendMessage
 */
export function useSlashMenu({ inputText, inputRef, sendMessage }) {
  const slashMenuIndex = ref(0);
  const slashMenuOpen = ref(false);

  const slashMenuVisible = computed(() => {
    if (slashMenuOpen.value) return true;
    const txt = inputText.value;
    return txt.startsWith('/') && !/\s/.test(txt.slice(1));
  });

  const filteredSlashCommands = computed(() => {
    if (slashMenuOpen.value && !inputText.value.startsWith('/')) return SLASH_COMMANDS;
    if (!inputText.value.startsWith('/')) return SLASH_COMMANDS;
    const txt = inputText.value.toLowerCase();
    return SLASH_COMMANDS.filter(c => c.command.startsWith(txt));
  });

  watch(filteredSlashCommands, () => { slashMenuIndex.value = 0; });

  function selectSlashCommand(cmd) {
    slashMenuOpen.value = false;
    if (cmd.isPrefix) {
      inputText.value = cmd.command + ' ';
      nextTick(() => inputRef.value?.focus());
    } else {
      inputText.value = cmd.command;
      sendMessage();
    }
  }

  function openSlashMenu() {
    slashMenuOpen.value = !slashMenuOpen.value;
    slashMenuIndex.value = 0;
  }

  // Close slash menu on outside click
  function _slashMenuClickOutside(e) {
    if (slashMenuOpen.value && !e.target.closest('.slash-btn') && !e.target.closest('.slash-menu')) {
      slashMenuOpen.value = false;
    }
  }
  document.addEventListener('click', _slashMenuClickOutside);
  onUnmounted(() => {
    document.removeEventListener('click', _slashMenuClickOutside);
  });

  /**
   * Handle keyboard events for the slash menu.
   * Returns true if the event was consumed, false otherwise.
   */
  function handleSlashMenuKeydown(e) {
    if (!slashMenuVisible.value || filteredSlashCommands.value.length === 0 || e.isComposing) {
      return false;
    }
    const len = filteredSlashCommands.value.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      slashMenuIndex.value = (slashMenuIndex.value + 1) % len;
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      slashMenuIndex.value = (slashMenuIndex.value - 1 + len) % len;
      return true;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      selectSlashCommand(filteredSlashCommands.value[slashMenuIndex.value]);
      return true;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      inputText.value = filteredSlashCommands.value[slashMenuIndex.value].command;
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      slashMenuOpen.value = false;
      inputText.value = '';
      return true;
    }
    return false;
  }

  return {
    slashMenuIndex,
    slashMenuOpen,
    slashMenuVisible,
    filteredSlashCommands,
    selectSlashCommand,
    openSlashMenu,
    handleSlashMenuKeydown,
  };
}
