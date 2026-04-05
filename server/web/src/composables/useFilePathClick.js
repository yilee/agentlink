// ── Clickable file paths: detect file paths in messages and open preview on click ──
import { onMounted, onUnmounted } from 'vue';

// Known file extensions (lowercase, no dot)
const KNOWN_EXTENSIONS = new Set([
  // Code
  'js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs', 'vue', 'svelte',
  'py', 'rb', 'rs', 'go', 'java', 'c', 'h', 'cpp', 'hpp', 'cs',
  'swift', 'kt', 'lua', 'r', 'pl', 'php', 'ex', 'exs', 'erl',
  'zig', 'nim', 'dart', 'scala', 'clj', 'hs', 'ml', 'fs', 'fsx',
  // Web
  'html', 'htm', 'css', 'scss', 'less', 'sass',
  // Data / config
  'json', 'json5', 'yaml', 'yml', 'toml', 'xml', 'csv', 'tsv',
  'ini', 'cfg', 'conf', 'env', 'properties',
  // Docs
  'md', 'mdx', 'txt', 'rst', 'adoc', 'tex', 'log',
  // Shell / scripts
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
  // Build / tooling
  'sql', 'graphql', 'proto', 'prisma', 'tf', 'hcl',
  'dockerfile', 'makefile', 'cmake',
  // Images
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp',
  // Other
  'pdf', 'wasm', 'lock', 'patch', 'diff',
]);

// Characters allowed in file paths (no spaces, no angle brackets, etc.)
const PATH_CHARS_RE = /^[\w.\-\/\\@:~]+$/;

/**
 * Check if a text string looks like a file path.
 * Conservative: requires a known extension and path-safe characters.
 */
export function looksLikeFilePath(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  if (t.length < 3 || t.length > 500) return false;
  // Reject URLs
  if (/^https?:\/\//i.test(t)) return false;
  // Reject bare commands / keywords (no slash or dot)
  if (!t.includes('/') && !t.includes('\\') && !t.includes('.')) return false;
  // Must have a file extension
  const dotIdx = t.lastIndexOf('.');
  if (dotIdx === -1 || dotIdx === t.length - 1) return false;
  const ext = t.substring(dotIdx + 1).toLowerCase();
  if (!KNOWN_EXTENSIONS.has(ext)) return false;
  // Only path-safe characters
  if (!PATH_CHARS_RE.test(t)) return false;
  // Reject if it looks like a version number (e.g., v1.2.3)
  if (/^v?\d+\.\d+\.\d+/.test(t) && !t.includes('/')) return false;
  return true;
}

/**
 * Normalize a file path for preview: strip leading ./ and collapse separators.
 */
function normalizePath(raw) {
  let p = raw.trim();
  // Strip leading ./
  if (p.startsWith('./')) p = p.substring(2);
  // Normalize backslashes to forward slashes
  p = p.replace(/\\/g, '/');
  return p;
}

/**
 * Check if a DOM element (or its ancestors up to container) is inside an <a> tag.
 */
function isInsideLink(el, container) {
  let node = el;
  while (node && node !== container) {
    if (node.tagName === 'A') return true;
    node = node.parentElement;
  }
  return false;
}

/**
 * Get the candidate file path text from a clicked element.
 * Supports: <code> elements, .tool-summary spans, .diff-file divs.
 */
function getFilePathText(el) {
  if (el.tagName === 'CODE') return el.textContent;
  if (el.classList?.contains('tool-summary')) return el.textContent;
  // diff-file may contain "(replace all)" suffix — extract just the path
  if (el.classList?.contains('diff-file')) {
    return el.childNodes[0]?.textContent || el.textContent;
  }
  return null;
}

const HOVER_CLASS = 'file-path-clickable';

/**
 * Composable: attach click + hover delegate to a container ref.
 * @param {import('vue').Ref<HTMLElement>} containerRef - ref to the scrollable message list element
 * @param {Function} openPreview - filePreview.openPreview function
 */
export function useFilePathClick(containerRef, openPreview) {
  function handleClick(e) {
    const el = e.target;
    if (!containerRef.value?.contains(el)) return;
    // Don't intercept clicks inside <a> links
    if (isInsideLink(el, containerRef.value)) return;
    const text = getFilePathText(el);
    if (text && looksLikeFilePath(text)) {
      e.preventDefault();
      e.stopPropagation();
      openPreview(normalizePath(text));
    }
  }

  function handleMouseOver(e) {
    const el = e.target;
    if (!containerRef.value?.contains(el)) return;
    if (isInsideLink(el, containerRef.value)) return;
    const isCandidate = el.tagName === 'CODE'
      || el.classList?.contains('tool-summary')
      || el.classList?.contains('diff-file');
    if (isCandidate && looksLikeFilePath(el.textContent)) {
      el.classList.add(HOVER_CLASS);
    }
  }

  function handleMouseOut(e) {
    const el = e.target;
    if (el.classList?.contains(HOVER_CLASS)) {
      el.classList.remove(HOVER_CLASS);
    }
  }

  onMounted(() => {
    const container = containerRef.value;
    if (!container) return;
    container.addEventListener('click', handleClick);
    container.addEventListener('mouseover', handleMouseOver);
    container.addEventListener('mouseout', handleMouseOut);
  });

  onUnmounted(() => {
    const container = containerRef.value;
    if (!container) return;
    container.removeEventListener('click', handleClick);
    container.removeEventListener('mouseover', handleMouseOver);
    container.removeEventListener('mouseout', handleMouseOut);
  });
}
