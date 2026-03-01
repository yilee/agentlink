// ── Message helpers: formatting, tool summaries, diff display ─────────────────
import { renderMarkdown } from './markdown.js';

// ── Helpers ──────────────────────────────────────────────────────────────────
const CONTEXT_SUMMARY_PREFIX = 'This session is being continued from a previous conversation';

export function isContextSummary(text) {
  return typeof text === 'string' && text.trimStart().startsWith(CONTEXT_SUMMARY_PREFIX);
}

export function formatRelativeTime(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function formatTimestamp(ts) {
  if (!ts) return '';
  const d = ts instanceof Date ? ts : new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · ' + d.toLocaleDateString();
}

export function getRenderedContent(msg) {
  if (msg.role !== 'assistant' && !msg.isCommandOutput) return msg.content;
  return renderMarkdown(msg.content);
}

export async function copyMessage(msg) {
  try {
    await navigator.clipboard.writeText(msg.content);
    msg.copied = true;
    setTimeout(() => { msg.copied = false; }, 2000);
  } catch {}
}

export function isPrevAssistant(visibleMessages, idx) {
  if (idx <= 0) return false;
  const prev = visibleMessages[idx - 1];
  return prev && (prev.role === 'assistant' || prev.role === 'tool');
}

export function toggleContextSummary(msg) {
  msg.contextExpanded = !msg.contextExpanded;
}

export function toggleTool(msg) {
  msg.expanded = !msg.expanded;
}

export function getToolSummary(msg) {
  const name = msg.toolName;
  const input = msg.toolInput;
  try {
    const obj = JSON.parse(input);
    if (name === 'Read' && obj.file_path) return obj.file_path;
    if (name === 'Edit' && obj.file_path) return obj.file_path;
    if (name === 'Write' && obj.file_path) return obj.file_path;
    if (name === 'Bash' && obj.command) return obj.command.length > 60 ? obj.command.slice(0, 60) + '...' : obj.command;
    if (name === 'Glob' && obj.pattern) return obj.pattern;
    if (name === 'Grep' && obj.pattern) return obj.pattern;
    if (name === 'TodoWrite' && obj.todos) {
      const done = obj.todos.filter(t => t.status === 'completed').length;
      return `${done}/${obj.todos.length} done`;
    }
    if (name === 'Task' && obj.description) return obj.description;
    if (name === 'WebSearch' && obj.query) return obj.query;
    if (name === 'WebFetch' && obj.url) return obj.url.length > 60 ? obj.url.slice(0, 60) + '...' : obj.url;
  } catch {}
  return '';
}

export function isEditTool(msg) {
  return msg.role === 'tool' && msg.toolName === 'Edit' && msg.toolInput;
}

export function getFormattedToolInput(msg) {
  if (!msg.toolInput) return null;
  try {
    const obj = JSON.parse(msg.toolInput);
    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const name = msg.toolName;

    if (name === 'Read' && obj.file_path) {
      let detail = esc(obj.file_path);
      if (obj.offset && obj.limit) {
        detail += `  <span class="tool-input-meta">lines ${obj.offset}\u2013${obj.offset + obj.limit - 1}</span>`;
      } else if (obj.offset) {
        detail += `  <span class="tool-input-meta">from line ${obj.offset}</span>`;
      } else if (obj.limit) {
        detail += `  <span class="tool-input-meta">first ${obj.limit} lines</span>`;
      }
      return detail;
    }

    if (name === 'Write' && obj.file_path) {
      const lines = (obj.content || '').split('\n').length;
      return esc(obj.file_path) + `  <span class="tool-input-meta">${lines} lines</span>`;
    }

    if (name === 'Bash' && obj.command) {
      let html = '<code class="tool-input-cmd">' + esc(obj.command) + '</code>';
      if (obj.description) html = '<span class="tool-input-meta">' + esc(obj.description) + '</span> ' + html;
      return html;
    }

    if (name === 'Glob' && obj.pattern) {
      let html = '<code class="tool-input-cmd">' + esc(obj.pattern) + '</code>';
      if (obj.path) html += '  <span class="tool-input-meta">in ' + esc(obj.path) + '</span>';
      return html;
    }

    if (name === 'Grep' && obj.pattern) {
      let html = '<code class="tool-input-cmd">' + esc(obj.pattern) + '</code>';
      if (obj.path) html += '  <span class="tool-input-meta">in ' + esc(obj.path) + '</span>';
      return html;
    }

    if (name === 'TodoWrite' && Array.isArray(obj.todos)) {
      let html = '<div class="todo-list">';
      for (const t of obj.todos) {
        const s = t.status;
        const icon = s === 'completed' ? '<span class="todo-icon done">\u2713</span>'
          : s === 'in_progress' ? '<span class="todo-icon active">\u25CF</span>'
          : '<span class="todo-icon">\u25CB</span>';
        const cls = s === 'completed' ? ' todo-done' : s === 'in_progress' ? ' todo-active' : '';
        html += '<div class="todo-item' + cls + '">' + icon + '<span class="todo-text">' + esc(t.content || t.activeForm || '') + '</span></div>';
      }
      html += '</div>';
      return html;
    }

    if (name === 'Task') {
      let html = '';
      if (obj.description) html += '<div class="task-field"><span class="tool-input-meta">Description</span> ' + esc(obj.description) + '</div>';
      if (obj.subagent_type) html += '<div class="task-field"><span class="tool-input-meta">Agent</span> <code class="tool-input-cmd">' + esc(obj.subagent_type) + '</code></div>';
      if (obj.prompt) {
        const short = obj.prompt.length > 200 ? obj.prompt.slice(0, 200) + '...' : obj.prompt;
        html += '<div class="task-field"><span class="tool-input-meta">Prompt</span></div><div class="task-prompt">' + esc(short) + '</div>';
      }
      if (html) return html;
    }

    if (name === 'WebSearch' && obj.query) {
      return '<code class="tool-input-cmd">' + esc(obj.query) + '</code>';
    }

    if (name === 'WebFetch' && obj.url) {
      let html = '<a class="tool-link" href="' + esc(obj.url) + '" target="_blank" rel="noopener">' + esc(obj.url) + '</a>';
      if (obj.prompt) html += '<div class="task-field"><span class="tool-input-meta">' + esc(obj.prompt) + '</span></div>';
      return html;
    }

  } catch {}
  return null;
}

export function getEditDiffHtml(msg) {
  try {
    const obj = JSON.parse(msg.toolInput);
    if (!obj.old_string && !obj.new_string) return null;
    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const filePath = obj.file_path || '';
    const oldLines = (obj.old_string || '').split('\n');
    const newLines = (obj.new_string || '').split('\n');
    let html = '';
    if (filePath) {
      html += '<div class="diff-file">' + esc(filePath) + (obj.replace_all ? ' <span class="diff-replace-all">(replace all)</span>' : '') + '</div>';
    }
    html += '<div class="diff-lines">';
    for (const line of oldLines) {
      html += '<div class="diff-removed">' + '<span class="diff-sign">-</span>' + esc(line) + '</div>';
    }
    for (const line of newLines) {
      html += '<div class="diff-added">' + '<span class="diff-sign">+</span>' + esc(line) + '</div>';
    }
    html += '</div>';
    return html;
  } catch { return null; }
}
