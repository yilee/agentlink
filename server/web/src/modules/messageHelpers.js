// ── Message helpers: formatting, tool summaries, diff display ─────────────────
import { renderMarkdown } from './markdown.js';

// ── Helpers ──────────────────────────────────────────────────────────────────
const CONTEXT_SUMMARY_PREFIX = 'This session is being continued from a previous conversation';
const MEETING_CONTEXT_PREFIX = '[Meeting Context';
const BRIEFING_CONTEXT_PREFIX = '[Briefing Context';

function parseToolInput(msg) {
  if (msg._parsedInput !== undefined) return msg._parsedInput;
  try { msg._parsedInput = JSON.parse(msg.toolInput); }
  catch { msg._parsedInput = null; }
  return msg._parsedInput;
}

export function isContextSummary(text) {
  return typeof text === 'string' && text.trimStart().startsWith(CONTEXT_SUMMARY_PREFIX);
}

/**
 * Detect meeting/briefing context injected into the first chat message.
 * Returns { context, userText, type } if found, or null if not a context message.
 * type is 'meeting' or 'briefing'.
 */
export function parseMeetingContext(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trimStart();
  let type = null;
  if (trimmed.startsWith(MEETING_CONTEXT_PREFIX)) type = 'meeting';
  else if (trimmed.startsWith(BRIEFING_CONTEXT_PREFIX)) type = 'briefing';
  if (!type) return null;
  // Split on the first '---' separator between context and user question
  const sepIdx = trimmed.indexOf('\n---\n');
  if (sepIdx === -1) return null;
  return {
    context: trimmed.substring(0, sepIdx).trim(),
    userText: trimmed.substring(sepIdx + 5).trim(),   // skip '\n---\n'
    type,
  };
}

export function formatRelativeTime(ts, t) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t ? t('time.justNow') : 'just now';
  if (mins < 60) return t ? t('time.minutesAgo', { n: mins }) : `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t ? t('time.hoursAgo', { n: hours }) : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return t ? t('time.daysAgo', { n: days }) : `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function formatTimestamp(ts) {
  if (!ts) return '';
  const d = ts instanceof Date ? ts : new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · ' + d.toLocaleDateString();
}

export function getRenderedContent(msg) {
  if (msg.role !== 'assistant' && !msg.isCommandOutput) return msg.content;
  if (msg.isStreaming) {
    const t = msg.content || '';
    return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  }
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

export function getToolSummary(msg, t) {
  const name = msg.toolName;
  const obj = parseToolInput(msg);
  if (!obj) return '';
  try {
    if (name === 'Read' && obj.file_path) return obj.file_path;
    if (name === 'Edit' && obj.file_path) return obj.file_path;
    if (name === 'Write' && obj.file_path) return obj.file_path;
    if (name === 'Bash' && obj.command) return obj.command.length > 60 ? obj.command.slice(0, 60) + '...' : obj.command;
    if (name === 'Glob' && obj.pattern) return obj.pattern;
    if (name === 'Grep' && obj.pattern) return obj.pattern;
    if (name === 'TodoWrite' && obj.todos) {
      const doneCount = obj.todos.filter(td => td.status === 'completed').length;
      return t ? t('tool.done', { done: doneCount, total: obj.todos.length }) : `${doneCount}/${obj.todos.length} done`;
    }
    if (name === 'Task' && obj.description) return obj.description;
    if (name === 'Agent' && obj.description) return obj.description;
    if (name === 'Agent' && obj.prompt) return obj.prompt.length > 80 ? obj.prompt.slice(0, 80) + '...' : obj.prompt;
    if (name === 'WebSearch' && obj.query) return obj.query;
    if (name === 'WebFetch' && obj.url) return obj.url.length > 60 ? obj.url.slice(0, 60) + '...' : obj.url;
  } catch {}
  return '';
}

export function isEditTool(msg) {
  return msg.role === 'tool' && msg.toolName === 'Edit' && msg.toolInput;
}

export function getFormattedToolInput(msg, t) {
  if (!msg.toolInput) return null;
  const obj = parseToolInput(msg);
  if (!obj) return null;
  try {
    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const name = msg.toolName;

    if (name === 'Read' && obj.file_path) {
      let detail = esc(obj.file_path);
      if (obj.offset && obj.limit) {
        const meta = t ? t('tool.lines', { start: obj.offset, end: obj.offset + obj.limit - 1 }) : `lines ${obj.offset}\u2013${obj.offset + obj.limit - 1}`;
        detail += `  <span class="tool-input-meta">${meta}</span>`;
      } else if (obj.offset) {
        const meta = t ? t('tool.fromLine', { offset: obj.offset }) : `from line ${obj.offset}`;
        detail += `  <span class="tool-input-meta">${meta}</span>`;
      } else if (obj.limit) {
        const meta = t ? t('tool.firstLines', { limit: obj.limit }) : `first ${obj.limit} lines`;
        detail += `  <span class="tool-input-meta">${meta}</span>`;
      }
      return detail;
    }

    if (name === 'Write' && obj.file_path) {
      const lines = (obj.content || '').split('\n').length;
      const lineCount = t ? t('tool.lineCount', { n: lines }) : `${lines} lines`;
      return esc(obj.file_path) + `  <span class="tool-input-meta">${lineCount}</span>`;
    }

    if (name === 'Bash' && obj.command) {
      let html = '<code class="tool-input-cmd">' + esc(obj.command) + '</code>';
      if (obj.description) html = '<span class="tool-input-meta">' + esc(obj.description) + '</span> ' + html;
      return html;
    }

    if (name === 'Glob' && obj.pattern) {
      let html = '<code class="tool-input-cmd">' + esc(obj.pattern) + '</code>';
      if (obj.path) html += '  <span class="tool-input-meta">' + (t ? t('tool.inPath', { path: esc(obj.path) }) : 'in ' + esc(obj.path)) + '</span>';
      return html;
    }

    if (name === 'Grep' && obj.pattern) {
      let html = '<code class="tool-input-cmd">' + esc(obj.pattern) + '</code>';
      if (obj.path) html += '  <span class="tool-input-meta">' + (t ? t('tool.inPath', { path: esc(obj.path) }) : 'in ' + esc(obj.path)) + '</span>';
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

    if (name === 'Task' || name === 'Agent') {
      let html = '';
      const descLabel = t ? t('tool.description') : 'Description';
      const agentLabel = t ? t('tool.agent') : 'Agent';
      const promptLabel = t ? t('tool.prompt') : 'Prompt';
      if (obj.description) html += '<div class="task-field"><span class="tool-input-meta">' + descLabel + '</span> ' + esc(obj.description) + '</div>';
      if (obj.subagent_type) html += '<div class="task-field"><span class="tool-input-meta">' + agentLabel + '</span> <code class="tool-input-cmd">' + esc(obj.subagent_type) + '</code></div>';
      if (obj.prompt) {
        html += '<div class="task-field"><span class="tool-input-meta">' + promptLabel + '</span></div><div class="task-prompt">' + esc(obj.prompt) + '</div>';
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

export function getEditDiffHtml(msg, t) {
  const obj = parseToolInput(msg);
  if (!obj) return null;
  try {
    if (!obj.old_string && !obj.new_string) return null;
    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const filePath = obj.file_path || '';
    const oldLines = (obj.old_string || '').split('\n');
    const newLines = (obj.new_string || '').split('\n');
    let html = '';
    if (filePath) {
      html += '<div class="diff-file">' + esc(filePath) + (obj.replace_all ? ' <span class="diff-replace-all">' + (t ? t('tool.replaceAll') : '(replace all)') + '</span>' : '') + '</div>';
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
