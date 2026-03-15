// ── Markdown rendering, code copy, tool icons ────────────────────────────────
import { marked } from 'marked';
import hljs from 'highlight.js';

marked.setOptions({
  breaks: true,
  gfm: true,
  highlight: function(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try { return hljs.highlight(code, { language: lang }).value; } catch {}
    }
    return code;
  },
});

const _mdCache = new Map();

export function renderMarkdown(text) {
  if (!text) return '';
  const cached = _mdCache.get(text);
  if (cached) return cached;
  let html;
  try {
    html = marked.parse(text);
    // Add copy buttons to code blocks
    html = html.replace(/<pre><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g,
      (match, attrs, code) => {
        const langMatch = attrs.match(/class="language-(\w+)"/);
        const lang = langMatch ? langMatch[1] : '';
        return `<div class="code-block-wrapper">
            <div class="code-block-header">
              <span class="code-lang">${lang}</span>
              <button class="code-copy-btn" onclick="window.__copyCodeBlock(this)" title="Copy">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
              </button>
            </div>
            <pre><code${attrs}>${code}</code></pre>
          </div>`;
      }
    );
  } catch {
    html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  if (_mdCache.size > 500) _mdCache.clear();
  _mdCache.set(text, html);
  return html;
}

// Global code copy handler
window.__copyCodeBlock = async function(btn) {
  const wrapper = btn.closest('.code-block-wrapper');
  const code = wrapper?.querySelector('code');
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code.textContent);
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
    setTimeout(() => {
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
    }, 2000);
  } catch {}
};

// Tool icons (monochrome SVG)
const TOOL_SVG = {
  Read:      '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M1 2.5A2.5 2.5 0 0 1 3.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75H3.5a1 1 0 0 0-1 1h9.25a.75.75 0 0 1 0 1.5H3.5A2.5 2.5 0 0 1 1 14V2.5zm3 0v7l1.5-1.25L7 9.5v-7H4z"/></svg>',
  Edit:      '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25a1.75 1.75 0 0 1 .445-.758l8.61-8.61zM11.524 2.2l-8.61 8.61a.25.25 0 0 0-.064.108l-.57 1.996 1.996-.57a.25.25 0 0 0 .108-.064l8.61-8.61a.25.25 0 0 0 0-.354l-1.086-1.086a.25.25 0 0 0-.354 0z"/></svg>',
  Write:     '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M8.75 1.75a.75.75 0 0 0-1.5 0V6H2.75a.75.75 0 0 0 0 1.5H7.25v4.25a.75.75 0 0 0 1.5 0V7.5h4.25a.75.75 0 0 0 0-1.5H8.75V1.75z"/></svg>',
  Bash:      '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25V2.75zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25H1.75zM7 11a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 0 1.5h-3.5A.75.75 0 0 1 7 11zm-3.22-4.53a.75.75 0 0 1 1.06 0l2 2a.75.75 0 0 1 0 1.06l-2 2a.75.75 0 0 1-1.06-1.06L5.25 9 3.78 7.53a.75.75 0 0 1 0-1.06z"/></svg>',
  Glob:      '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 1 1-1.06 1.06l-3.04-3.04zM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7z"/></svg>',
  Grep:      '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 1 1-1.06 1.06l-3.04-3.04zM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7z"/></svg>',
  Task:      '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25V2.75C0 1.784.784 1 1.75 1zm0 1.5a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25H1.75zM3.5 5h9v1.5h-9V5zm0 3h9v1.5h-9V8zm0 3h5v1.5h-5V11z"/></svg>',
  Agent:     '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M10.5 5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zm.061 3.073a4 4 0 1 0-5.123 0 6.004 6.004 0 0 0-3.431 5.142.75.75 0 0 0 1.498.07 4.5 4.5 0 0 1 8.99 0 .75.75 0 1 0 1.498-.07 6.004 6.004 0 0 0-3.432-5.142z"/></svg>',
  WebFetch:  '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zm3.7 5.3a.75.75 0 0 0-1.06-1.06l-5.5 5.5a.75.75 0 1 0 1.06 1.06l5.5-5.5zM8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z"/></svg>',
  WebSearch: '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zm3.7 5.3a.75.75 0 0 0-1.06-1.06l-5.5 5.5a.75.75 0 1 0 1.06 1.06l5.5-5.5zM8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z"/></svg>',
  TodoWrite: '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 1.042-1.08L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z"/></svg>',
};
const TOOL_SVG_DEFAULT = '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M7.429 1.525a3.751 3.751 0 0 1 4.41.899l.04.045a.75.75 0 0 1-.17 1.143l-2.2 1.378a1.25 1.25 0 0 0-.473 1.58l.614 1.341a1.25 1.25 0 0 0 1.412.663l2.476-.542a.75.75 0 0 1 .848.496 3.75 3.75 0 0 1-1.468 4.155 3.751 3.751 0 0 1-4.41-.898l-.04-.046a.75.75 0 0 1 .17-1.142l2.2-1.378a1.25 1.25 0 0 0 .473-1.58l-.614-1.342a1.25 1.25 0 0 0-1.412-.662l-2.476.541a.75.75 0 0 1-.848-.496 3.75 3.75 0 0 1 1.468-4.155z"/></svg>';

export function getToolIcon(name) { return TOOL_SVG[name] || TOOL_SVG_DEFAULT; }
