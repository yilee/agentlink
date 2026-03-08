# Markdown-to-HTML Online Preview Tool -- Design Document

## 1. Overview

A standalone, self-contained single-page HTML tool that provides real-time Markdown-to-HTML preview. The user types or pastes Markdown in a left pane and immediately sees the rendered HTML output in a right pane. The tool runs entirely in the browser with no build step, no server, and no dependencies beyond two CDN-loaded libraries.

### Goals

- Provide a fast, zero-install Markdown editing and preview experience
- Real-time rendering as the user types, with no perceptible lag
- Support full GitHub Flavored Markdown (headings, lists, tables, code blocks, links, images, blockquotes, task lists)
- Syntax highlighting for fenced code blocks
- Dark and light theme support
- Responsive layout for desktop and mobile
- Single self-contained HTML file with no build tooling required

### Non-goals

- Server-side rendering or storage
- File import/export (open from disk, save to disk)
- Collaborative editing or sharing
- WYSIWYG editing (this is a source-to-preview tool, not a rich text editor)
- Custom Markdown extensions beyond what `marked` supports
- Print-optimized stylesheet

---

## 2. Feature List

The following Markdown features are supported in the preview pane:

| Category | Features |
|----------|----------|
| **Headings** | `h1` through `h6` via `#` syntax |
| **Emphasis** | **Bold** (`**text**`), *italic* (`*text*`), ~~strikethrough~~ (`~~text~~`) |
| **Lists** | Ordered lists (`1.`), unordered lists (`-`, `*`, `+`), nested lists, task lists (`- [x]`) |
| **Code** | Inline code (`` `code` ``), fenced code blocks (`` ``` ``), syntax highlighting with language hint |
| **Links** | Inline links (`[text](url)`), autolinks |
| **Images** | Inline images (`![alt](url)`) with responsive max-width scaling |
| **Tables** | GFM pipe tables with header, alignment, and alternating row shading |
| **Blockquotes** | `>` blockquotes with styled left border and background |
| **Horizontal rules** | `---`, `***`, `___` |

Additional UI features:

| Feature | Description |
|---------|-------------|
| **Real-time preview** | Preview updates as the user types (150ms debounce) |
| **Draggable divider** | Resize left/right panes by dragging the center divider |
| **Dark/light theme** | Toggle between themes; preference persisted to `localStorage` |
| **Copy HTML** | Copy the rendered HTML output to the clipboard |
| **Clear** | Clear the editor and preview |
| **Responsive layout** | Side-by-side on desktop, stacked vertically on mobile |
| **Sample content** | Pre-filled sample Markdown on page load demonstrating all features |

---

## 3. File Location

```
tools/markdown-preview.html    # Single file: HTML + embedded <style> + embedded <script>
```

All CSS lives in a single `<style>` block in the `<head>`. All JavaScript lives in a single `<script>` block (wrapped in an IIFE) before `</body>`. External dependencies are loaded via CDN `<script>` and `<link>` tags.

---

## 4. Markdown Library Choice and Rationale

### Choice: marked.js

The `marked` library is selected as the Markdown parser. It is loaded from CDN at runtime:

```
https://cdn.jsdelivr.net/npm/marked/marked.min.js
```

### Rationale

| Criterion | marked.js | markdown-it | showdown |
|-----------|-----------|-------------|----------|
| **Bundle size** | ~40 KB min | ~100 KB min | ~70 KB min |
| **GFM support** | Built-in (`gfm: true`) | Requires plugins | Built-in |
| **Parse speed** | Fastest (benchmarked) | Fast | Moderate |
| **CDN availability** | jsDelivr, cdnjs, unpkg | jsDelivr, cdnjs | jsDelivr, cdnjs |
| **API simplicity** | `marked.parse(md)` | `md.render(src)` | `converter.makeHtml(md)` |
| **Custom renderer** | `new marked.Renderer()` | Plugin system | Extension system |
| **npm weekly downloads** | ~9M | ~6M | ~1.5M |
| **Active maintenance** | Yes | Yes | Less active |

**Why marked.js wins for this use case:**

1. **Smallest footprint.** At ~40 KB minified, it is the lightest full-featured Markdown parser, which matters for a single-file tool loaded from CDN.
2. **Built-in GFM.** Tables, task lists, strikethrough, and autolinks work out of the box with `gfm: true`, without additional plugins.
3. **Simple custom renderer.** The `Renderer` class allows overriding the `code` method to integrate highlight.js for syntax highlighting, avoiding the need for a separate `markedHighlight` plugin.
4. **Speed.** `marked` is consistently the fastest pure-JavaScript Markdown parser in benchmarks, ensuring real-time preview remains responsive even with large documents.
5. **Single global.** When loaded via `<script>` tag (no module bundler), `marked` exposes a clean global (`window.marked`) that works immediately.

### Syntax Highlighting: highlight.js

Code block syntax highlighting is handled by highlight.js, loaded from CDN:

```
https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js
```

Highlight.js is chosen because it auto-detects languages when no hint is provided, supports 190+ languages, and provides pre-built theme stylesheets that pair well with the light/dark theme toggle. Two theme stylesheets (`github` and `github-dark`) are loaded; one is disabled at any time via the `disabled` attribute on the `<link>` element.

### External Dependencies (CDN) -- Full List

| Library | Version | Purpose | CDN URL |
|---------|---------|---------|---------|
| `marked` | latest | Markdown-to-HTML parsing | `https://cdn.jsdelivr.net/npm/marked/marked.min.js` |
| `highlight.js` | 11.9.0 | Syntax highlighting for code blocks | `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js` |
| highlight.js CSS (light) | 11.9.0 | Light theme for code blocks | `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css` |
| highlight.js CSS (dark) | 11.9.0 | Dark theme for code blocks | `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css` |

---

## 5. UI Layout Specification

### 5.1 ASCII Diagram -- Desktop (> 768px)

```
+------------------------------------------------------------------+
|  [Markdown Preview]                    [theme] [Copy HTML] [Clear]|
+------------------------------------------------------------------+
|                          |     |                                  |
|   Markdown Input         |  D  |   HTML Preview                  |
|   (textarea)             |  i  |   (rendered output)              |
|                          |  v  |                                  |
|   # Heading              |  i  |   Heading                        |
|   Some **bold** text     |  d  |   Some bold text                 |
|   - list item            |  e  |   * list item                    |
|   ```js                  |  r  |   [syntax-highlighted block]     |
|   code()                 |     |                                  |
|   ```                    |     |                                  |
|                          |     |                                  |
|   [flex: 1 1 50%]        |5px  |   [flex: 1 1 50%]               |
|                          |     |                                  |
+------------------------------------------------------------------+
                                                  [HTML copied!]
                                                  (toast, bottom-right)
```

- The toolbar spans the full width, pinned to the top.
- The main area is a horizontal flex container with two equal panes separated by a 5px draggable divider.
- The divider can be dragged left/right to resize the panes (clamped to 15%--85%).

### 5.2 ASCII Diagram -- Mobile (<= 768px)

```
+----------------------------+
| [Markdown Preview] [T][C][X]|
+----------------------------+
|                            |
|  Markdown Input            |
|  (textarea)                |
|  [flex: 1 1 50%]           |
|                            |
+----------------------------+  <-- divider (5px, horizontal)
|                            |
|  HTML Preview              |
|  (rendered output)         |
|  [flex: 1 1 50%]           |
|                            |
+----------------------------+
```

- On viewports <= 768px, the layout switches to `flex-direction: column`.
- The divider becomes horizontal (height: 5px, cursor: row-resize).

---

## 6. Technical Architecture

### 6.1 HTML Structure

```
html[data-theme="light"|"dark"]
 +-- head
 |    +-- meta charset, viewport
 |    +-- title
 |    +-- link#hljs-light (highlight.js github theme)
 |    +-- link#hljs-dark  (highlight.js github-dark theme, disabled)
 |    +-- script (marked.js from CDN)
 |    +-- script (highlight.js from CDN)
 |    +-- style (all CSS, embedded)
 |
 +-- body (margin: 0, height: 100vh, display: flex, flex-direction: column)
      +-- header.toolbar (flex-shrink: 0)
      |    +-- h1 ("Markdown Preview")
      |    +-- button#theme-toggle
      |    +-- button#copy-html ("Copy HTML")
      |    +-- button#clear-btn ("Clear")
      |
      +-- main.main (flex: 1, display: flex, min-height: 0)
      |    +-- section.pane.pane-input (flex: 1 1 50%, overflow: hidden)
      |    |    +-- textarea#markdown-input (100% width, 100% height)
      |    |
      |    +-- div.divider#divider (width: 5px, cursor: col-resize)
      |    |
      |    +-- section.pane.pane-preview#preview-pane (flex: 1 1 50%, overflow-y: auto)
      |         +-- div#preview (rendered HTML inserted here)
      |
      +-- div.copy-feedback#copy-feedback ("HTML copied to clipboard!")
      |
      +-- script (all JS, embedded IIFE)
```

### 6.2 CSS Layout

All styles are embedded in a single `<style>` block. The layout uses CSS Flexbox throughout.

**Key layout rules:**

```css
html, body {
    margin: 0;
    padding: 0;
    height: 100%;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    transition: var(--transition);
}

.toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    background: var(--bg-toolbar);
    border-bottom: 1px solid var(--border);
    box-shadow: var(--shadow);
    flex-shrink: 0;
}

.main {
    flex: 1;
    display: flex;
    min-height: 0;    /* allows flex children to shrink below content size */
}

.pane {
    flex: 1 1 50%;
    overflow: hidden;
    min-width: 0;     /* prevents flex item overflow */
}

.pane-input { display: flex; }

.pane-preview { overflow-y: auto; }

#markdown-input {
    width: 100%;
    height: 100%;
    resize: none;
    border: none;
    outline: none;
    padding: 20px;
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
    font-size: 0.9rem;
    line-height: 1.6;
    background: var(--bg-input);
    color: var(--text);
    box-sizing: border-box;
}

.divider {
    width: 5px;
    flex-shrink: 0;
    background: var(--divider);
    cursor: col-resize;
    transition: background-color 0.15s ease;
}

.divider:hover, .divider.active {
    background: var(--divider-hover);
}
```

**Responsive rules (mobile, <= 768px):**

```css
@media (max-width: 768px) {
    .main {
        flex-direction: column;
    }
    .pane-input,
    .pane-preview {
        flex: 1 1 50%;
    }
    .divider {
        width: auto;
        height: 5px;
        cursor: row-resize;
    }
}
```

### 6.3 CSS Theming

All colors are defined as CSS custom properties on `:root` (light theme) and `[data-theme="dark"]` (dark theme). The theme is toggled by setting `document.documentElement.setAttribute('data-theme', ...)`.

**Light theme (`:root`):**

```css
:root {
    --bg:                #ffffff;
    --bg-toolbar:        #f8f9fa;
    --bg-input:          #f5f5f5;
    --bg-preview:        #ffffff;
    --bg-code:           #f0f0f0;
    --bg-table-alt:      #f9f9f9;
    --text:              #1a1a2e;
    --text-secondary:    #555555;
    --border:            #dcdcdc;
    --divider:           #cccccc;
    --divider-hover:     #888888;
    --accent:            #4a6cf7;
    --blockquote-bg:     #f0f4ff;
    --blockquote-border: #4a6cf7;
    --shadow:            0 1px 3px rgba(0,0,0,0.08);
    --transition:        background-color 0.25s ease, color 0.25s ease, border-color 0.25s ease;
}
```

**Dark theme (`[data-theme="dark"]`):**

```css
[data-theme="dark"] {
    --bg:                #1e1e2e;
    --bg-toolbar:        #181825;
    --bg-input:          #252538;
    --bg-preview:        #1e1e2e;
    --bg-code:           #2a2a3c;
    --bg-table-alt:      #262637;
    --text:              #cdd6f4;
    --text-secondary:    #a6adc8;
    --border:            #45475a;
    --divider:           #45475a;
    --divider-hover:     #89b4fa;
    --accent:            #89b4fa;
    --blockquote-bg:     #262640;
    --blockquote-border: #89b4fa;
    --shadow:            0 1px 3px rgba(0,0,0,0.3);
}
```

### 6.4 JavaScript Logic

All JavaScript is embedded in a single `<script>` block wrapped in an IIFE. The logic is organized into the following sections:

#### 6.4.1 DOM References

```javascript
const textarea = document.getElementById('markdown-input');
const preview  = document.getElementById('preview');
const divider  = document.getElementById('divider');
const themeBtn = document.getElementById('theme-toggle');
const copyBtn  = document.getElementById('copy-html');
const clearBtn = document.getElementById('clear-btn');
const copyFeedback = document.getElementById('copy-feedback');
const hljsLight = document.getElementById('hljs-light');
const hljsDark  = document.getElementById('hljs-dark');
const mainEl    = document.querySelector('.main');
const inputPane = document.querySelector('.pane-input');
const previewPane = document.getElementById('preview-pane');
```

#### 6.4.2 Markdown Parser Configuration

The `marked` library is configured with GitHub Flavored Markdown enabled and a custom renderer that integrates highlight.js for code blocks:

```javascript
var renderer = new marked.Renderer();

renderer.code = function (codeObj) {
    // marked v5+ passes an object { text, lang, escaped }
    // older versions pass (code, lang, escaped) as separate args
    var code, lang;
    if (typeof codeObj === 'object' && codeObj !== null && 'text' in codeObj) {
        code = codeObj.text;
        lang = codeObj.lang;
    } else {
        code = arguments[0];
        lang = arguments[1];
    }

    var highlighted;
    if (lang && hljs.getLanguage(lang)) {
        try {
            highlighted = hljs.highlight(code, { language: lang }).value;
        } catch (_) { highlighted = code; }
    } else {
        try {
            highlighted = hljs.highlightAuto(code).value;
        } catch (_) { highlighted = code; }
    }

    var langClass = lang ? ' class="language-' + lang + ' hljs"' : ' class="hljs"';
    return '<pre><code' + langClass + '>' + highlighted + '</code></pre>\n';
};

marked.setOptions({
    renderer: renderer,
    breaks: false,
    gfm: true
});
```

#### 6.4.3 Real-Time Rendering with Debounce

The textarea fires an `input` event on every keystroke. A 150ms debounce prevents excessive re-renders while keeping the preview feeling immediate:

```javascript
function debounce(fn, delay) {
    let timer = null;
    return function () {
        clearTimeout(timer);
        timer = setTimeout(fn, delay);
    };
}

function renderMarkdown() {
    const md = textarea.value;
    preview.innerHTML = marked.parse(md);
}

const debouncedRender = debounce(renderMarkdown, 150);
textarea.addEventListener('input', debouncedRender);
```

#### 6.4.4 Draggable Divider

The divider handles both mouse and touch events for cross-device support. During drag, `body.is-resizing` is added to prevent text selection. The split ratio is clamped between 15% and 85%.

```javascript
let isDragging = false;

function onPointerDown(e) {
    isDragging = true;
    divider.classList.add('active');
    document.body.classList.add('is-resizing');
    e.preventDefault();
}

function onPointerMove(e) {
    if (!isDragging) return;
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    const rect = mainEl.getBoundingClientRect();
    let ratio;
    if (isMobile) {
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        ratio = (clientY - rect.top) / rect.height;
    } else {
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        ratio = (clientX - rect.left) / rect.width;
    }
    ratio = Math.max(0.15, Math.min(0.85, ratio));
    inputPane.style.flex = '0 0 ' + (ratio * 100) + '%';
    previewPane.style.flex = '0 0 ' + ((1 - ratio) * 100) + '%';
}

function onPointerUp() {
    if (!isDragging) return;
    isDragging = false;
    divider.classList.remove('active');
    document.body.classList.remove('is-resizing');
}

divider.addEventListener('mousedown', onPointerDown);
document.addEventListener('mousemove', onPointerMove);
document.addEventListener('mouseup', onPointerUp);
divider.addEventListener('touchstart', onPointerDown, { passive: false });
document.addEventListener('touchmove', onPointerMove, { passive: false });
document.addEventListener('touchend', onPointerUp);
```

#### 6.4.5 Theme Toggle

The theme is persisted to `localStorage` under key `md-preview-theme`. On load, the saved value is restored (defaulting to `'light'`). The highlight.js theme stylesheet is swapped by toggling the `disabled` attribute on the two `<link>` elements.

```javascript
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (theme === 'dark') {
        themeBtn.innerHTML = '&#127769;';  // moon
        hljsLight.disabled = true;
        hljsDark.disabled  = false;
    } else {
        themeBtn.innerHTML = '&#9728;&#65039;';  // sun
        hljsLight.disabled = false;
        hljsDark.disabled  = true;
    }
    localStorage.setItem('md-preview-theme', theme);
}

const savedTheme = localStorage.getItem('md-preview-theme') || 'light';
applyTheme(savedTheme);

themeBtn.addEventListener('click', function () {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
    renderMarkdown();  // re-render so code blocks pick up new hljs theme
});
```

#### 6.4.6 Copy HTML Button

Copies `preview.innerHTML` to the clipboard. Falls back to `document.execCommand('copy')` via a hidden textarea if the Clipboard API is unavailable. Shows a toast notification for 2 seconds.

```javascript
copyBtn.addEventListener('click', function () {
    const html = preview.innerHTML;
    navigator.clipboard.writeText(html).then(function () {
        showCopyFeedback();
    }).catch(function () {
        // Fallback: create hidden textarea, select, execCommand
        var tmp = document.createElement('textarea');
        tmp.value = html;
        tmp.style.position = 'fixed';
        tmp.style.opacity = '0';
        document.body.appendChild(tmp);
        tmp.select();
        document.execCommand('copy');
        document.body.removeChild(tmp);
        showCopyFeedback();
    });
});

function showCopyFeedback() {
    copyFeedback.classList.add('show');
    setTimeout(function () { copyFeedback.classList.remove('show'); }, 2000);
}
```

#### 6.4.7 Clear Button

Clears the textarea and re-renders the empty preview:

```javascript
clearBtn.addEventListener('click', function () {
    textarea.value = '';
    renderMarkdown();
});
```

#### 6.4.8 Default Sample Content

On page load, the textarea is pre-filled with sample Markdown demonstrating all supported features (headings, bold, italic, lists, code blocks, tables, blockquotes, links, images, horizontal rules, task lists). The sample is defined as a JavaScript template literal. `renderMarkdown()` is called immediately after setting the value.

---

## 7. Detailed Component Descriptions

### 7.1 Toolbar

The toolbar is a fixed-height flex row pinned to the top of the page.

| Element | HTML | Behavior |
|---------|------|----------|
| **Title** | `<h1>Markdown Preview</h1>` | Static text; `margin-right: auto` pushes buttons to the right |
| **Theme toggle** | `<button id="theme-toggle">` | Toggles `data-theme` between `light` and `dark`; swaps hljs stylesheet; persists to localStorage; re-renders preview |
| **Copy HTML** | `<button id="copy-html">Copy HTML</button>` | Copies `preview.innerHTML` to clipboard; shows toast feedback |
| **Clear** | `<button id="clear-btn">Clear</button>` | Sets `textarea.value = ''` and calls `renderMarkdown()` |

**Styling:** `padding: 8px 16px`, `gap: 8px`, `background: var(--bg-toolbar)`, `border-bottom: 1px solid var(--border)`, `box-shadow: var(--shadow)`. Buttons have `border-radius: 6px`, `padding: 6px 14px`, border `1px solid var(--border)`. Hover: border and text change to `var(--accent)`. Active: `transform: scale(0.97)`.

### 7.2 Editor Pane (Left Panel)

A full-height textarea occupying the left half of the main area.

| Property | Value |
|----------|-------|
| Font | `'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace` |
| Font size | `0.9rem` |
| Line height | `1.6` |
| Padding | `20px` |
| Background | `var(--bg-input)` |
| Border | None |
| Resize | `none` (handled by divider) |
| Placeholder | `"Type your Markdown here..."` |
| Placeholder style | `var(--text-secondary)` at `opacity: 0.6` |

The textarea fills its parent via `width: 100%; height: 100%; box-sizing: border-box`. Focus removes the default outline (`outline: none`).

### 7.3 Divider (Center)

A thin draggable bar between the two panes.

| Property | Desktop | Mobile |
|----------|---------|--------|
| Dimension | `width: 5px` | `height: 5px` |
| Cursor | `col-resize` | `row-resize` |
| Background | `var(--divider)` | same |
| Hover/active | `var(--divider-hover)` | same |
| Flex | `flex-shrink: 0` | same |
| Transition | `background-color 0.15s ease` | same |

During drag, an `.active` class is added to the divider and `.is-resizing` is added to `<body>` (which sets `user-select: none; cursor: col-resize` globally to prevent text selection and ensure the cursor stays consistent).

### 7.4 Preview Pane (Right Panel)

The rendered HTML output, scrollable independently.

| Property | Value |
|----------|-------|
| Padding | `20px 28px` |
| Overflow | `overflow-y: auto` |
| Word wrap | `overflow-wrap: break-word; word-wrap: break-word` |
| Line height | `1.7` |

**Typography rules** (scoped to `#preview`):

| Element | Styling |
|---------|---------|
| `h1` | `font-size: 2rem`, bottom border, `padding-bottom: 0.3em` |
| `h2` | `font-size: 1.5rem`, bottom border, `padding-bottom: 0.25em` |
| `h3` | `font-size: 1.25rem` |
| `h4` | `font-size: 1.1rem` |
| `h5` | `font-size: 1rem` |
| `h6` | `font-size: 0.9rem`, `color: var(--text-secondary)` |
| All headings | `margin-top: 1.4em`, `margin-bottom: 0.6em`, `font-weight: 600`, `line-height: 1.3` |
| First heading child | `margin-top: 0` (via `:first-child` selector) |
| `p` | `margin: 0.8em 0` |
| `code` (inline) | `background: var(--bg-code)`, `padding: 0.15em 0.4em`, `border-radius: 4px`, `font-size: 0.88em` |
| `pre` | `background: var(--bg-code)`, `padding: 16px`, `border-radius: 8px`, `overflow-x: auto`, `line-height: 1.5`, `margin: 1em 0` |
| `pre code` | `padding: 0`, `background: transparent`, `font-size: 0.85rem` |
| `blockquote` | `border-left: 4px solid var(--blockquote-border)`, `background: var(--blockquote-bg)`, `padding: 12px 20px`, `border-radius: 0 6px 6px 0`, `color: var(--text-secondary)` |
| `table` | `width: 100%`, `border-collapse: collapse`, `font-size: 0.92rem`, `margin: 1em 0` |
| `th` / `td` | `padding: 10px 14px`, `border: 1px solid var(--border)` |
| `th` | `background: var(--bg-code)`, `font-weight: 600` |
| `tr:nth-child(even)` | `background: var(--bg-table-alt)` |
| `img` | `max-width: 100%`, `border-radius: 6px` |
| `a` | `color: var(--accent)`, `text-decoration: none`; hover: `text-decoration: underline` |
| `hr` | `border: none`, `border-top: 2px solid var(--border)`, `margin: 2em 0` |
| Task list `ul` | `list-style: none`, `padding-left: 1.2em` |
| `li` | `margin: 0.3em 0` |
| Checkbox | `margin-right: 0.4em` |

### 7.5 Copy Feedback Toast

A fixed-position notification shown briefly after copying HTML.

| Property | Value |
|----------|-------|
| Position | `fixed`, `bottom: 20px`, `right: 20px` |
| Background | `var(--accent)` |
| Text color | `#fff` |
| Border radius | `8px` |
| Padding | `12px 20px` |
| z-index | `100` |
| Default state | `opacity: 0`, `transform: translateY(10px)`, `pointer-events: none` |
| `.show` state | `opacity: 1`, `transform: translateY(0)` |
| Transition | `opacity 0.25s ease, transform 0.25s ease` |
| Text | `"HTML copied to clipboard!"` |
| Duration | Shown for 2 seconds |

---

## 8. Scroll Synchronization

**Not implemented.** The two panes scroll independently. Proportional scroll sync is listed as a future enhancement.

---

## 9. Accessibility

> **Note:** The following are recommendations. The initial implementation includes `title` attributes on buttons but does not include full ARIA markup.

| Concern | Recommendation |
|---------|----------------|
| **Keyboard navigation** | All toolbar buttons are natively focusable via Tab and activate on Enter/Space. Textarea is keyboard-accessible. |
| **Labels** | Textarea: `aria-label="Markdown input"`. Preview: `role="region"`, `aria-label="HTML preview"`. |
| **Theme toggle** | `aria-label` updated dynamically: "Toggle dark mode" / "Toggle light mode". |
| **Copy button** | `aria-label="Copy rendered HTML to clipboard"`. |
| **Color contrast** | Both themes target WCAG AA contrast ratios. |
| **Focus indicators** | Browser default focus indicators. |
| **Reduced motion** | CSS transitions could be wrapped in `@media (prefers-reduced-motion: no-preference)`. |

---

## 10. Error Handling

| Scenario | Status | Notes |
|----------|--------|-------|
| **CDN load failure** (marked or hljs) | Not implemented | No `onerror` handlers. If scripts fail to load, the page will not render Markdown. |
| **Invalid Markdown** | Handled | `marked` is lenient and does not throw on malformed input. The custom renderer wraps `hljs.highlight()` in `try/catch`. |
| **Clipboard API unavailable** | Handled | Falls back to `document.execCommand('copy')` via hidden textarea. |
| **Very large input** | Partially handled | 150ms debounce prevents UI freezing. No explicit size limit. |
| **XSS in rendered HTML** | Not implemented | No DOMPurify. Acceptable for a local-only tool with no external user content. |

---

## 11. State Persistence

| Key | Value | Storage | Purpose |
|-----|-------|---------|---------|
| `md-preview-theme` | `'light'` or `'dark'` | `localStorage` | Theme preference across sessions |

State that is **not** persisted (resets on page refresh):

| State | Behavior on refresh |
|-------|-------------------|
| Textarea content | Resets to sample Markdown |
| Divider/split position | Resets to 50/50 |

---

## 12. Future Enhancements

Not part of the current implementation:

- **Content persistence** -- Save textarea content to `localStorage`
- **Split position persistence** -- Save divider position to `localStorage`
- **Scroll synchronization** -- Proportional scroll sync between textarea and preview
- **CDN failure handling** -- `onerror` handlers with fallback banners
- **System theme detection** -- `prefers-color-scheme` media query as fallback
- **ARIA attributes** -- Full `aria-label`, `role`, `aria-live` support
- **Reduced motion** -- `@media (prefers-reduced-motion: no-preference)` guards
- **Export to file** -- Download rendered HTML or Markdown source
- **Import from file** -- Drag-and-drop or file picker for `.md` files
- **Multiple tabs/documents** -- Tabbed editing of multiple Markdown documents
- **Custom CSS injection** -- User-provided preview styles
- **Word/character count** -- Live statistics in the toolbar
- **Table of contents** -- Auto-generated outline from headings
- **Mermaid diagrams** -- Render Mermaid code blocks as SVG diagrams
- **Print stylesheet** -- Print-optimized CSS for the preview pane
- **PWA support** -- Service worker for offline use
