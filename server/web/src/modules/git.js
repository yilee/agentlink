// ── Git panel state management, diff parsing, preview integration ──
import { ref } from 'vue';

export function createGit(deps) {
  const {
    wsSend, workDir,
    gitPanelOpen, filePanelOpen, memoryPanelOpen,
    previewFile, previewPanelOpen,
    isMobile, sidebarView, workdirMenuOpen,
    t,
  } = deps;

  // Internal reactive state
  const gitInfo = ref(null);        // git_status_result data
  const gitLoading = ref(false);
  const gitDiffLoading = ref(false);
  const expandedGroups = ref({ staged: true, modified: true, untracked: false });

  function openPanel() {
    workdirMenuOpen.value = false;
    if (isMobile.value) {
      sidebarView.value = 'git';
    } else {
      filePanelOpen.value = false;
      memoryPanelOpen.value = false;
      gitPanelOpen.value = true;
    }
    if (!gitInfo.value) {
      refresh();
    }
  }

  function closePanel() {
    gitPanelOpen.value = false;
  }

  function refresh() {
    gitLoading.value = true;
    wsSend({ type: 'git_status' });
  }

  function toggleGroup(group) {
    expandedGroups.value[group] = !expandedGroups.value[group];
  }

  function openFileDiff(entry, isStaged) {
    previewFile.value = {
      fileName: entry.path.split('/').pop(),
      filePath: entry.path,
      isDiff: true,
      staged: isStaged,
      status: entry.status,
      oldPath: entry.oldPath,
      diffLoading: true,
      hunks: [],
      binary: false,
      error: null,
    };
    previewPanelOpen.value = true;
    gitDiffLoading.value = true;
    wsSend({ type: 'git_diff', filePath: entry.path, staged: isStaged });
  }

  function handleGitStatus(msg) {
    gitLoading.value = false;
    gitInfo.value = msg;
  }

  function handleGitDiff(msg) {
    gitDiffLoading.value = false;
    if (!previewFile.value?.isDiff) return;
    if (previewFile.value.filePath !== msg.filePath) return; // stale response
    previewFile.value = {
      ...previewFile.value,
      diffLoading: false,
      hunks: msg.binary ? [] : parseDiff(msg.diff || ''),
      binary: msg.binary || false,
      error: msg.error || null,
    };
  }

  function parseDiff(rawDiff) {
    if (!rawDiff) return [];
    const lines = rawDiff.split('\n');
    const hunks = [];
    let currentHunk = null;
    let oldLine = 0;
    let newLine = 0;

    for (const line of lines) {
      // Hunk header
      const hunkMatch = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)/);
      if (hunkMatch) {
        currentHunk = {
          header: line,
          oldStart: parseInt(hunkMatch[1], 10),
          oldCount: parseInt(hunkMatch[2] || '1', 10),
          newStart: parseInt(hunkMatch[3], 10),
          newCount: parseInt(hunkMatch[4] || '1', 10),
          context: hunkMatch[5] || '',
          lines: [],
          collapsed: false,
        };
        hunks.push(currentHunk);
        oldLine = currentHunk.oldStart;
        newLine = currentHunk.newStart;
        continue;
      }

      if (!currentHunk) continue; // skip diff header lines (diff --git, index, ---, +++)

      if (line.startsWith('+')) {
        currentHunk.lines.push({ type: 'add', content: line.substring(1), oldLine: null, newLine: newLine++ });
      } else if (line.startsWith('-')) {
        currentHunk.lines.push({ type: 'remove', content: line.substring(1), oldLine: oldLine++, newLine: null });
      } else if (line.startsWith(' ') || line === '') {
        currentHunk.lines.push({ type: 'context', content: line.substring(1), oldLine: oldLine++, newLine: newLine++ });
      } else if (line.startsWith('\\')) {
        // "\ No newline at end of file" -- skip
      }
    }
    return hunks;
  }

  function onWorkdirChanged() {
    gitInfo.value = null;
    gitLoading.value = false;
    if (gitPanelOpen.value) {
      refresh();
    }
  }

  return {
    gitInfo,
    gitLoading,
    gitDiffLoading,
    expandedGroups,
    openPanel,
    closePanel,
    refresh,
    toggleGroup,
    openFileDiff,
    handleGitStatus,
    handleGitDiff,
    parseDiff,
    onWorkdirChanged,
  };
}
