import { ref, computed, watch, nextTick, onUnmounted } from 'vue';

const SLASH_COMMANDS = [
  { command: '/btw', descKey: 'slash.btw', isPrefix: true },
  { command: '/cost', descKey: 'slash.cost' },
  { command: '/context', descKey: 'slash.context' },
  { command: '/compact', descKey: 'slash.compact' },
];

const BRAIN_COMMANDS = [
  // Data
  { category: 'Data' },
  { command: '/update', desc: 'Incremental data fetch' },
  { command: '/runner-start', desc: 'Start background data runner' },
  { command: '/runner-stop', desc: 'Stop data runner' },
  { command: '/runner-status', desc: 'Check runner status' },
  // Queries
  { category: 'Queries' },
  { command: '/brain-query', desc: 'Query messages with filters' },
  { command: '/search-brain', desc: 'Full-text search across all data' },
  { command: '/brain-status', desc: 'Data coverage status' },
  // Reports
  { category: 'Reports' },
  { command: '/daily-briefing', desc: 'Generate daily activity summary' },
  { command: '/daily-update', desc: 'Update project memory' },
  { command: '/meeting-recap', desc: 'Generate meeting recap' },
  // Communication
  { category: 'Communication' },
  { command: '/teams', desc: 'Teams chat & meeting operations' },
  { command: '/teams-channel', desc: 'Teams channel posts' },
  { command: '/email', desc: 'Outlook email operations' },
  // Dev Tools
  { category: 'Dev Tools' },
  { command: '/azure-devops', desc: 'ADO PRs, work items, code search' },
  { command: '/sharepoint', desc: 'SharePoint/OneDrive file access' },
  // Output
  { category: 'Output' },
  { command: '/ppt-gen', desc: 'Generate PowerPoint presentations' },
  // System
  { category: 'System' },
  { command: '/bootstrap', desc: 'First-time Brain setup' },
  { command: '/troubleshoot', desc: 'Diagnostics & repair' },
  { command: '/bug-report', desc: 'File Brain system issues' },
  { command: '/contribute', desc: 'Submit code changes' },
];

/**
 * Manages the slash command menu (visibility, filtering, navigation, selection).
 * @param {Object} deps
 * @param {import('vue').Ref<string>} deps.inputText
 * @param {import('vue').Ref} deps.inputRef
 * @param {import('vue').Ref<boolean>} [deps.brainMode]
 */
export function useSlashMenu({ inputText, inputRef, brainMode }) {
  const slashMenuIndex = ref(0);
  const slashMenuOpen = ref(false);

  const slashMenuVisible = computed(() => {
    if (slashMenuOpen.value) return true;
    const txt = inputText.value;
    return txt.startsWith('/') && !/\s/.test(txt.slice(1));
  });

  /** All available commands (base + brain if active) */
  const allCommands = computed(() => {
    if (!brainMode || !brainMode.value) return SLASH_COMMANDS;
    // In brain mode, combine base commands with brain commands (including category headers)
    return [...SLASH_COMMANDS, ...BRAIN_COMMANDS];
  });

  /** Selectable commands only (no category headers), for keyboard navigation */
  const selectableCommands = computed(() => {
    return filteredSlashCommands.value.filter(c => !c.category);
  });

  const filteredSlashCommands = computed(() => {
    const cmds = allCommands.value;
    if (slashMenuOpen.value && !inputText.value.startsWith('/')) return cmds;
    if (!inputText.value.startsWith('/')) return cmds;
    const txt = inputText.value.toLowerCase();
    // Filter commands, keep category headers if any of their commands match
    const filtered = [];
    let currentCategory = null;
    let categoryHasMatch = false;
    for (const item of cmds) {
      if (item.category) {
        // Flush previous category if it had matches
        if (currentCategory && categoryHasMatch) {
          filtered.push(currentCategory);
          // Add buffered commands
          for (const bc of currentCategory._buffered) filtered.push(bc);
        }
        currentCategory = { ...item, _buffered: [] };
        categoryHasMatch = false;
      } else if (currentCategory) {
        if (item.command.startsWith(txt)) {
          categoryHasMatch = true;
          currentCategory._buffered.push(item);
        }
      } else {
        // Base commands (no category)
        if (item.command.startsWith(txt)) filtered.push(item);
      }
    }
    // Flush last category
    if (currentCategory && categoryHasMatch) {
      filtered.push(currentCategory);
      for (const bc of currentCategory._buffered) filtered.push(bc);
    }
    // Clean up _buffered from output
    return filtered.map(item => {
      if (item._buffered) {
        const { _buffered, ...rest } = item;
        return rest;
      }
      return item;
    });
  });

  watch(filteredSlashCommands, () => { slashMenuIndex.value = 0; });

  function selectSlashCommand(cmd) {
    if (cmd.category) return; // Can't select category headers
    slashMenuOpen.value = false;
    inputText.value = cmd.command + (cmd.isPrefix ? ' ' : '');
    nextTick(() => inputRef.value?.focus());
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
    if (!slashMenuVisible.value || selectableCommands.value.length === 0 || e.isComposing) {
      return false;
    }
    const selectable = selectableCommands.value;
    const len = selectable.length;
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
      selectSlashCommand(selectable[slashMenuIndex.value]);
      return true;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      inputText.value = selectable[slashMenuIndex.value].command;
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
