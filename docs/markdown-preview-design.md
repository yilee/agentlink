# Markdown-to-HTML Online Preview Tool — Design Document

## 1. Overview

A standalone single-page web application that provides a real-time Markdown-to-HTML preview. The user types or pastes Markdown in a left pane and immediately sees the rendered HTML output in a right pane. The tool runs entirely in the browser with no build step, no server, and no dependencies beyond two CDN-loaded libraries.

### Goals

- Provide a fast, zero-install Markdown editing and preview experience
- Real-time rendering as the user types, with no perceptible lag
- Support full GitHub Flavored Markdown (headings, lists, tables, code blocks, links, images, blockquotes, task lists)
- Syntax highlighting for fenced code blocks
- Dark and light theme support
- Responsive layout for desktop and mobile
- Single self-contained `index.html` file

### Non-goals

- Server-side rendering or storage
- File import/export (open from disk, save to disk)
- Collaborative editing or sharing
- WYSIWYG editing (this is a source-to-preview tool, not a rich text editor)
- Custom Markdown extensions beyond what `marked` supports
- Print-optimized stylesheet

---

## 2. File Structure

```
tools/markdown-preview/
└── index.html        # Single file: HTML structure + embedded <style> + embedded <script>
```

All CSS lives in a single `<style>` block in the `<head>`. All JavaScript lives in a single `<script>` block (wrapped in an IIFE) before `</body>`. External dependencies are loaded via CDN `<script>` and `<link>` tags.

### External Dependencies (CDN)

| Library | Version | Purpose | CDN |
|---------|---------|---------|-----|
| `marked` | latest | Markdown-to-HTML parsing | `https://cdn.jsdelivr.net/npm/marked/marked.min.js` |
| `highlight.js` | 11.9.0 | Syntax highlighting for code blocks | `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js` |
| highlight.js CSS (light) | 11.9.0 | Light theme for code blocks | `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css` |
| highlight.js CSS (dark) | 11.9.0 | Dark theme for code blocks | `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css` |

Both highlight.js theme stylesheets are loaded; one is disabled at any time via the `disabled` attribute on the `<link>` element, toggled by the theme switch.

---

## 3. Layout Architecture

### 3.1 Top-Level Structure

```
html[data-theme="light"|"dark"]
└── body (margin: 0, height: 100%, display: flex, flex-direction: column)
    ├── header.toolbar (flex-shrink: 0)
    │   ├── h1 ("Markdown Preview", margin-right: auto)
    │   ├── button#theme-toggle (sun/moon icon toggle)
    │   ├── button#copy-html ("Copy HTML")
    │   └── button#clear-btn ("Clear")
    ├── main.main (flex: 1, display: flex, min-height: 0)
    │   ├── section.pane.pane-input (flex: 1 1 50%)
    │   │   └── textarea#markdown-input (width: 100%, height: 100%)
    │   ├── div.divider#divider (width: 5px, cursor: col-resize)
    │   └── section.pane.pane-preview#preview-pane (flex: 1 1 50%)
    │       └── div#preview (rendered HTML output)
    └── div.copy-feedback#copy-feedback (toast notification)
```

### 3.2 Flex-Based Split Pane

The `.main` container is a horizontal flex container. Both `.pane-input` and `.pane-preview` start with `flex: 1 1 50%`, giving them equal width. The user can drag the `.divider` to resize the panes.

Dragging is implemented by tracking `mousedown`/`touchstart` on the divider, then `mousemove`/`touchmove` on `document` to compute a new split ratio. The ratio is applied by setting explicit `flex` shorthand values (as percentages) on both panes. On `mouseup`/`touchend`, the drag state is cleared.

During a drag, `body.is-resizing` is added to prevent text selection.

```
Minimum pane size: 15% of container dimension (clamped)
Maximum pane size: 85% of container dimension (clamped)
Divider width: 5px
Divider visual: solid background, var(--divider) color
Divider hover/active: var(--divider-hover) color, .active class added during drag
```

### 3.3 Responsive Breakpoints

| Viewport Width | Layout |
|----------------|--------|
| > 768px | Side-by-side (horizontal flex), draggable divider visible |
| <= 768px | Stacked vertically (flex-direction: column), each pane gets 50% height, divider becomes horizontal (height: 5px, cursor: row-resize) |

On mobile (<= 768px), the `.main` container switches to `flex-direction: column`. Both panes take `flex: 1 1 50%` vertically. The divider remains visible but changes orientation (width -> height, col-resize -> row-resize). The drag logic detects mobile via `window.matchMedia` and uses Y-axis coordinates instead of X-axis.

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

---

## 4. Implementation Details

### 4.1 Markdown Parsing

The `marked` library is configured with a custom `Renderer` that overrides the `code` method to integrate highlight.js. This approach avoids a separate `markedHighlight` CDN dependency and works across both legacy and modern versions of `marked`.

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

### 4.2 Real-Time Preview with Debounce

The textarea listens for the `input` event. A debounce of **150ms** prevents excessive re-renders during fast typing while keeping the preview feeling immediate.

A generic `debounce(fn, delay)` helper is used to wrap the render function:

```javascript
function debounce(fn, delay) {
    let timer = null;
    return function () {
        clearTimeout(timer);
        timer = setTimeout(fn, delay);
    };
}

const debouncedRender = debounce(renderMarkdown, 150);
textarea.addEventListener('input', debouncedRender);

function renderMarkdown() {
    const md = textarea.value;
    preview.innerHTML = marked.parse(md);
}
```

### 4.3 Scroll Synchronization

**Not implemented.** Scroll synchronization between the textarea and the preview pane is a potential future enhancement. The two panes scroll independently.

### 4.4 Draggable Divider

The divider supports resizing on both desktop and mobile. It handles both mouse and touch events. A `body.is-resizing` class prevents text selection during drag.

The divider tracks the initial pointer position and the initial pane size on `pointerdown`. During `pointermove`, it calculates the delta and applies new flex percentages, clamped between 15% and 85% of the container size. On mobile, the logic uses the Y-axis instead of X-axis.

```javascript
divider.addEventListener('mousedown', onPointerDown);
document.addEventListener('mousemove', onPointerMove);
document.addEventListener('mouseup', onPointerUp);

// Touch events for mobile
divider.addEventListener('touchstart', onPointerDown, { passive: false });
document.addEventListener('touchmove', onPointerMove, { passive: false });
document.addEventListener('touchend', onPointerUp);
```

### 4.5 Copy HTML Button

Copies the rendered HTML from `preview.innerHTML` to the clipboard. On success or fallback, a toast notification (`div.copy-feedback`) is shown for 2 seconds by toggling its `.show` class.

```javascript
copyBtn.addEventListener('click', function () {
    const html = preview.innerHTML;
    navigator.clipboard.writeText(html).then(function () {
        copyFeedback.classList.add('show');
        setTimeout(function () { copyFeedback.classList.remove('show'); }, 2000);
    }).catch(function () {
        // Fallback: hidden textarea + execCommand('copy')
        // ... same toast feedback on success
    });
});
```

The toast is positioned `fixed` at bottom-right, styled with `var(--accent)` background and white text, with a fade+slide animation via CSS transitions on `opacity` and `transform`.

### 4.6 Clear Button

Clears the textarea content and immediately re-renders the (now empty) preview:

```javascript
clearBtn.addEventListener('click', function () {
    textarea.value = '';
    renderMarkdown();
});
```

### 4.7 Default Sample Content

The textarea is pre-filled on load with sample Markdown that demonstrates headings, bold text, bullet lists, code blocks with syntax highlighting, tables, blockquotes, task lists, and horizontal rules. The sample is defined as a JavaScript array joined by newlines.

The preview renders immediately on page load by calling `renderMarkdown()` after setting the textarea value.

---

## 5. CSS Theming

### 5.1 Approach: CSS Custom Properties

All colors are defined as CSS custom properties on `:root` (light theme) and `[data-theme="dark"]` (dark theme). The theme is toggled by setting `document.documentElement.setAttribute('data-theme', ...)`. A `--transition` custom property applies smooth `background-color`, `color`, and `border-color` transitions (0.25s ease).

The `<html>` element starts with `data-theme="light"`.

### 5.2 Custom Properties

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

### 5.3 Theme Toggle Logic

The theme is always explicitly set as an attribute (`data-theme="light"` or `data-theme="dark"`), never removed.

The icon convention is: sun icon displayed when the current theme is light; moon icon displayed when the current theme is dark.

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

// Restore saved theme; defaults to 'light' if not stored
const savedTheme = localStorage.getItem('md-preview-theme') || 'light';
applyTheme(savedTheme);
```

After toggling the theme, `renderMarkdown()` is called explicitly so that code highlighting picks up the newly active hljs stylesheet.

### 5.4 Highlight.js Theme Switching

Two `<link>` elements are included in the `<head>`, one for each highlight.js theme. Only one is active at a time:

```html
<link id="hljs-light" rel="stylesheet"
      href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css">
<link id="hljs-dark" rel="stylesheet"
      href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css"
      disabled>
```

When the theme toggles, the `disabled` attribute is swapped between the two `<link>` elements.

---

## 6. UI/UX Details

### 6.1 Toolbar

- Background: `var(--bg-toolbar)`
- Bottom border: `1px solid var(--border)`
- Box shadow: `var(--shadow)`
- Layout: flex row with `gap: 8px` and `padding: 8px 16px`
- Left: `<h1>` with title text "Markdown Preview" (font-weight 700, font-size 1.1rem, `margin-right: auto` to push buttons right)
- Right: action buttons in order: theme toggle, "Copy HTML", "Clear"
- Buttons: `6px 14px` padding, `border-radius: 6px`, `1px solid var(--border)` border, `var(--bg)` background
- Button hover: border and text change to `var(--accent)`
- Button active: `transform: scale(0.97)`
- Theme toggle button: larger font-size (1.1rem), narrower padding (6px 10px)

### 6.2 Editor Pane (Textarea)

- Full width and height of its container (`width: 100%; height: 100%`)
- `resize: none` (resizing is handled by the divider)
- Monospace font: `'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace` at `0.9rem`
- `line-height: 1.6`
- Padding: `20px`
- Background: `var(--bg-input)`
- Border: none
- `outline: none` on focus
- Placeholder text: "Type your Markdown here..." styled with `var(--text-secondary)` at `opacity: 0.6`

### 6.3 Preview Pane

- Padding: `20px 28px`
- Background: inherited from `var(--bg)` on body
- `overflow-wrap: break-word; word-wrap: break-word`
- `line-height: 1.7`
- Typography styled to approximate GitHub's Markdown rendering:
  - Headings: `margin-top: 1.4em`, `margin-bottom: 0.6em`, `font-weight: 600`, `line-height: 1.3`
  - `h1`: `2rem`, bottom border `1px solid var(--border)`, padding-bottom `0.3em`
  - `h2`: `1.5rem`, bottom border `1px solid var(--border)`, padding-bottom `0.25em`
  - `h3`: `1.25rem`; `h4`: `1.1rem`; `h5`: `1rem`; `h6`: `0.9rem` with `var(--text-secondary)` color
  - First `h1`/`h2`/`h3` child has `margin-top: 0`
  - `p`: `margin: 0.8em 0`
  - `code` (inline): `var(--bg-code)` background, `0.15em 0.4em` padding, border-radius `4px`, `0.88em` font-size
  - `pre code`: `padding: 0`, `background: transparent`, `font-size: 0.85rem`
  - `pre`: `var(--bg-code)` background, `16px` padding, border-radius `8px`, `overflow-x: auto`, `line-height: 1.5`, `margin: 1em 0`
  - `blockquote`: left border `4px solid var(--blockquote-border)`, background `var(--blockquote-bg)`, `padding: 12px 20px`, `border-radius: 0 6px 6px 0`, color `var(--text-secondary)`
  - `table`: `width: 100%`, border-collapse, `font-size: 0.92rem`, `margin: 1em 0`; `th`/`td`: `padding: 10px 14px`, `1px solid var(--border)`; `th`: `var(--bg-code)` background, `font-weight: 600`; even rows: `var(--bg-table-alt)` background
  - `img`: `max-width: 100%`, `border-radius: 6px`
  - `a`: `var(--accent)` color, `text-decoration: none`, underline on hover
  - `hr`: `border: none`, `border-top: 2px solid var(--border)`, `margin: 2em 0`
  - Task list (`ul.contains-task-list`): `list-style: none`, `padding-left: 1.2em`
  - List items: `margin: 0.3em 0`; checkboxes: `margin-right: 0.4em`

### 6.4 Divider

- Width: `5px` (desktop) / Height: `5px` (mobile)
- Background: `var(--divider)`
- Transition: `background-color 0.15s ease`
- On hover and during drag (`.active` class): background changes to `var(--divider-hover)`
- Cursor: `col-resize` (desktop) / `row-resize` (mobile)
- `flex-shrink: 0`

### 6.5 Copy Feedback Toast

- `position: fixed`, `bottom: 20px`, `right: 20px`
- Background: `var(--accent)`, text: `#fff`, `border-radius: 8px`
- Hidden by default (`opacity: 0`, `transform: translateY(10px)`, `pointer-events: none`)
- On `.show` class: `opacity: 1`, `transform: translateY(0)` with 0.25s transition
- Text: "HTML copied to clipboard!"
- z-index: 100

---

## 7. Accessibility

> **Note:** The following accessibility features are described as recommendations. The current implementation does not include ARIA attributes. These are areas for future improvement.

| Concern | Recommendation |
|---------|----------------|
| **Keyboard navigation** | All toolbar buttons are focusable and activate on Enter/Space. Textarea is natively keyboard-accessible. |
| **Labels** | Textarea should have `aria-label="Markdown input"`. Preview pane should have `role="region"` and `aria-label="HTML preview"`. |
| **Theme toggle** | Button should have `aria-label` updated dynamically (e.g., "Toggle dark mode" / "Toggle light mode"). Currently has `title="Toggle theme"`. |
| **Copy button** | Should have `aria-label="Copy rendered HTML to clipboard"`. |
| **Color contrast** | Both themes target WCAG AA-compliant contrast ratios. |
| **Focus indicators** | Relies on browser default focus indicators. |
| **Reduced motion** | Not implemented. Transitions could be wrapped in `@media (prefers-reduced-motion: no-preference)`. |

---

## 8. Error Handling

| Scenario | Status | Notes |
|----------|--------|-------|
| **CDN load failure** (marked or hljs) | **Not implemented** | No `onerror` handlers or fallback banners are present. If CDN scripts fail to load, the page will not render Markdown. |
| **Invalid Markdown** | Handled | `marked` is lenient and does not throw on malformed input. The custom renderer wraps `hljs.highlight()` calls in `try/catch` blocks. |
| **Clipboard API unavailable** | Handled | The copy button falls back to the `document.execCommand('copy')` approach using a hidden textarea. |
| **Very large input** | Partially handled | The 150ms debounce prevents UI freezing during fast typing. No explicit size limit or dynamic debounce scaling. |
| **XSS in rendered HTML** | **Not implemented** | No sanitization library (e.g., DOMPurify) is used. Since this is a local tool with no user-generated content from others, the risk is low. |

---

## 9. State Persistence

The following state is saved to `localStorage`:

| Key | Value | Purpose |
|-----|-------|---------|
| `md-preview-theme` | `'light'` or `'dark'` | Theme preference |

On page load, the saved theme is restored from `localStorage`, defaulting to `'light'` if nothing is stored. The `prefers-color-scheme` media query is **not** used as a fallback.

The following state is **not** persisted (reset on page refresh):

| State | Behavior on refresh |
|-------|-------------------|
| Textarea content | Resets to sample Markdown |
| Divider/split position | Resets to 50/50 |

---

## 10. Future Enhancements

Not part of the current implementation:

- **Content persistence** -- Save textarea content to `localStorage` and restore on page load
- **Split position persistence** -- Save divider position to `localStorage` and restore on page load
- **Scroll synchronization** -- Proportional scroll sync between textarea and preview pane
- **CDN failure handling** -- `onerror` handlers on script tags with fallback banners
- **System theme detection** -- Use `prefers-color-scheme` media query as fallback when no stored theme preference exists
- **ARIA attributes** -- Add `aria-label`, `role`, and `aria-live` attributes for screen reader support
- **Reduced motion** -- Wrap CSS transitions in `@media (prefers-reduced-motion: no-preference)`
- **Export to file** -- Save the rendered HTML or the Markdown source as a downloadable file
- **Import from file** -- Drag-and-drop or file picker to load a `.md` file into the editor
- **Multiple tabs/documents** -- Edit multiple Markdown documents in tabs
- **Custom CSS injection** -- Let users add custom styles for the preview pane
- **Word/character count** -- Live statistics in the toolbar
- **Table of contents generation** -- Auto-generated outline from headings
- **Mermaid diagram support** -- Render Mermaid code blocks as diagrams
- **Print stylesheet** -- Optimized CSS for printing the preview pane
- **PWA support** -- Service worker for offline use and "Add to Home Screen"
