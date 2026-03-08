# Markdown Preview Tool - Test Results

**Test Date:** 2026-03-08
**File Under Test:** `tools/markdown-preview.html`
**Test Method:** Automated browser testing via Playwright (Chromium, headless, 1280x800 viewport)
**Test Script:** `test/markdown-preview-playwright.cjs`

---

## TC1: Initial Page Load

**Steps:**
1. Navigate to `file:///Q:/src/agentlink/tools/markdown-preview.html`
2. Inspect the page for errors
3. Check that sample Markdown is pre-filled in the textarea
4. Check that the preview pane shows rendered HTML
5. Verify toolbar buttons are visible (Theme toggle, Copy HTML, Clear)

**Expected:** Page loads without errors, sample content is displayed, toolbar is complete.

**Actual:** **PASS**
- Title = "Markdown Preview" -- correct
- Sample content is present in the textarea (starts with `# Markdown Preview`)
- Preview pane is rendered (3172 chars of HTML)
- All three toolbar buttons present (`#theme-toggle`, `#copy-html`, `#clear-btn`)
- Note: One benign console error (`ERR_NAME_NOT_RESOLVED`) from the placeholder image URL in sample content (`via.placeholder.com`). This is expected in headless/offline environments and does not affect functionality.

---

## TC2: Real-time Markdown Rendering

**Steps:**
1. Clear the textarea
2. Type `# Hello World` and wait for debounce (300ms)
3. Verify preview shows an `<h1>` containing "Hello World"
4. Clear and type `**bold text**`
5. Verify preview shows `<strong>` containing "bold text"
6. Clear and type a fenced code block with language hint (`js`)
7. Verify syntax highlighting classes are applied

**Expected:** Each Markdown input renders to the correct HTML in real time.

**Actual:** **PASS**
- `# Hello World` renders as `<h1>` with text content "Hello World"
- `**bold text**` renders with `<strong>` element containing "bold text"
- Fenced code block with `js` language hint renders with `language-js hljs` class applied

---

## TC3: Theme Toggle

**Steps:**
1. Note the initial `data-theme` attribute on `<html>` (was "light")
2. Click the theme toggle button
3. Verify `data-theme` changes to "dark"
4. Verify highlight.js light stylesheet is disabled, dark is enabled
5. Click theme toggle again to restore original theme
6. Verify theme is restored to "light"

**Expected:** Theme toggles between light and dark, hljs stylesheets swap correctly.

**Actual:** **PASS**
- Initial theme: "light"
- After first toggle: "dark" -- `#hljs-light` disabled=true, `#hljs-dark` disabled=false
- After second toggle: restored to "light"

---

## TC4: Clear Button

**Steps:**
1. Filled textarea with `# Some content\n\nParagraph here.`
2. Verified content existed in both textarea and preview
3. Clicked the Clear button
4. Checked textarea value and preview innerHTML

**Expected:** Both textarea and preview are cleared.

**Actual:** **PASS**
- Textarea value is empty string (`""`) after clear
- Preview innerHTML is empty string (`""`) after clear

---

## TC5: Copy HTML Button

**Steps:**
1. Typed `# Test Copy` in the textarea and waited for render
2. Clicked the Copy HTML button
3. Checked toast notification visibility and text

**Expected:** Toast notification is shown after clicking Copy HTML.

**Actual:** **PASS**
- Toast element (`#copy-feedback`) has class `show` applied after clicking Copy HTML
- Toast text content: "HTML copied to clipboard!" -- matches expected text

---

## TC6: Draggable Divider Exists

**Steps:**
1. Checked that `#divider` element exists in the DOM
2. Read computed `cursor` style
3. Read computed `width` style

**Expected:** Divider element exists with proper cursor and width.

**Actual:** **PASS**
- Divider element exists
- Computed cursor: `col-resize`
- Computed width: `5px`

---

## TC7: Markdown Feature Support

**Steps:**
Entered a comprehensive Markdown document containing all features and verified each rendered element:

| # | Feature | Markdown Input | Expected HTML Element | Result |
|---|---------|----------------|----------------------|--------|
| 1 | Heading 1 | `# Heading 1` | `<h1>` with "Heading 1" | PASS |
| 2 | Heading 2 | `## Heading 2` | `<h2>` with "Heading 2" | PASS |
| 3 | Heading 3 | `### Heading 3` | `<h3>` with "Heading 3" | PASS |
| 4 | Heading 4 | `#### Heading 4` | `<h4>` with "Heading 4" | PASS |
| 5 | Heading 5 | `##### Heading 5` | `<h5>` with "Heading 5" | PASS |
| 6 | Heading 6 | `###### Heading 6` | `<h6>` with "Heading 6" | PASS |
| 7 | Bold | `**bold text**` | `<strong>` with "bold" | PASS |
| 8 | Italic | `*italic text*` | `<em>` with "italic" | PASS |
| 9 | Strikethrough | `~~strikethrough text~~` | `<del>` with "strikethrough" | PASS |
| 10 | Unordered list | `- item` | `<ul>` present | PASS |
| 11 | Ordered list | `1. item` | `<ol>` present | PASS |
| 12 | Table | pipe syntax | `<table>` present | PASS |
| 13 | Table header | pipe syntax | `<th>` present | PASS |
| 14 | Table cell | pipe syntax | `<td>` present | PASS |
| 15 | Blockquote | `> text` | `<blockquote>` present | PASS |
| 16 | Code block | fenced with js hint | `<pre><code>` present | PASS |
| 17 | Link | `[text](url)` | `<a href="...">` present | PASS |
| 18 | Horizontal rule | `---` | `<hr>` present | PASS |

**Expected:** All Markdown features render to correct HTML elements.

**Actual:** **PASS** -- All 18 feature checks passed.

---

## TC8: Layout Structure

**Steps:**
1. Inspected main container's computed display and flex-direction
2. Checked that input pane and preview pane elements exist
3. Verified textarea is a descendant of the input pane
4. Verified preview div is a descendant of the preview pane
5. Checked both panes have positive width and height
6. Verified side-by-side arrangement (input pane's right edge <= preview pane's left edge)

**Expected:** Two-panel side-by-side layout with proper flex structure.

**Actual:** **PASS**
- Main container: `display: flex`, `flex-direction: row`
- Input pane (`.pane-input`) exists, visible, contains `#markdown-input`
- Preview pane (`#preview-pane`) exists, visible, contains `#preview`
- Both panes have positive dimensions
- Side-by-side arrangement confirmed

---

## Summary

| Test Case | Result |
|-----------|--------|
| TC1: Initial Page Load | **PASS** |
| TC2: Real-time Markdown Rendering | **PASS** |
| TC3: Theme Toggle | **PASS** |
| TC4: Clear Button | **PASS** |
| TC5: Copy HTML Button | **PASS** |
| TC6: Draggable Divider Exists | **PASS** |
| TC7: Markdown Feature Support | **PASS** |
| TC8: Layout Structure | **PASS** |

**Overall: 8/8 tests passed. No failures detected.**

### Notes

- One benign console message (`ERR_NAME_NOT_RESOLVED`) occurred because the sample Markdown includes an `<img>` tag referencing `via.placeholder.com`, which cannot resolve in a headless/offline browser environment. This does not affect any tool functionality.
- All CDN-loaded libraries (marked.js, highlight.js) loaded and initialized correctly.
- The test script is located at `test/markdown-preview-playwright.cjs`.
