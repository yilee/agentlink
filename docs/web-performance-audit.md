# Web UI Performance Audit Report

**Date**: 2026-03-13
**Scope**: Chat interface rendering, CSS animations, JavaScript execution efficiency

## Executive Summary

Full performance audit of the chat interface covering **message rendering**, **CSS animations**, and **JavaScript execution efficiency**. Found **1 critical, 5 high, 10+ medium** issues. The core bottlenecks are:

1. **Streaming messages trigger full Markdown re-parse every 50ms** — largest CPU consumer during active streaming
2. **`conversationCache` grows unbounded** — memory bloat over long sessions, especially dangerous on iPad
3. **Inline `.some()` array scans in template** — full message array traversal on every render cycle

---

## 1. Message Rendering Performance

### 🔴 P0-1: `conversationCache` Never Evicted (Critical)

- **File**: `app.js:126`
- **Issue**: Every conversation switch caches the full messages array (including tool outputs). No eviction ever occurs. Each cached conversation can be 5-10MB. After opening 30 conversations, memory can reach 150-300MB, triggering tab eviction on iPad.
- **Fix**: Implement LRU eviction — keep 5-10 most recently accessed conversations, evict oldest (excluding active and processing ones).

### 🔴 P0-2: Full Markdown Re-parse Every 50ms During Streaming (High)

- **Files**: `streaming.js:49`, `messageHelpers.js:29-32`, `markdown.js:16-51`
- **Issue**: Each streaming tick appends 20 chars to `msg.content`, triggering Vue re-render. Template calls `getRenderedContent(msg)` → `renderMarkdown()` → `marked.parse()` + highlight.js. Cache key is the full content string which changes every tick, so cache never hits. A 5,000-char response produces ~250 full Markdown parses with syntax highlighting.
- **Fix**: Skip Markdown rendering during streaming (show raw text or use simplified renderer); render once when streaming ends. Alternatively, debounce Markdown render to 300ms during streaming.

### 🔴 P1-1: `JSON.parse(msg.toolInput)` on Every Render (High)

- **Files**: `messageHelpers.js:56-78, 84-169, 171-193`
- **Issue**: `getToolSummary()`, `getFormattedToolInput()`, `getEditDiffHtml()` call `JSON.parse()` on every render for every visible tool message. Tool message content is immutable after creation — pure waste.
- **Fix**: Parse once and cache on `msg._parsedInput`.

### 🔴 P1-2: Inline `messages.some(m => m.isStreaming)` in Template (High)

- **File**: `app.js:2489`
- **Issue**: Not a computed — re-evaluated on every render. Scans full messages array. During streaming, triggers at 20Hz.
- **Fix**: Extract to computed property `hasStreamingMessage`.

### 🔴 P1-3: `isSessionProcessing()` O(n×m) in Sidebar `v-for` (High)

- **Files**: `sidebar.js:346-358`, template `app.js:1445`
- **Issue**: Each sidebar session item calls `isSessionProcessing()`, which iterates all `conversationCache` entries. 30 sessions × 10 cached = 300 iterations per render.
- **Fix**: Build computed `Set<sessionId>` of processing sessions, lookup becomes O(1).

### 🟡 P1-4: `canSend` Computed Scans Full Messages Array (Medium)

- **File**: `app.js:429-432`
- **Issue**: `messages.value.some(m => m.role === 'ask-question' && !m.answered)` runs every 50ms during streaming.
- **Fix**: Track with dedicated `ref` counter for unanswered questions.

### 🟡 P2-1: Markdown Cache Polluted by Streaming Intermediates (Medium)

- **File**: `markdown.js:48`
- **Issue**: Streaming produces ~250 one-time cache entries per message. At 500 entries, whole cache is cleared, evicting valid entries for finalized messages.
- **Fix**: Skip caching for streaming content, or switch to LRU eviction.

### 🟡 P2-2: `v-show` Keeps Collapsed Tool Content in DOM (Medium)

- **File**: `app.js:2393, 2414`
- **Issue**: All tool expand content (diff HTML, formatted input/output) stays in DOM even when collapsed. 200 tool calls = massive hidden DOM.
- **Fix**: Change to `v-if` — tool content is immutable after creation, no need to keep mounted.

### 🟡 P2-3: Streaming String Concatenation O(n²) (Medium)

- **Files**: `streaming.js:49`, `backgroundRouting.js:136`
- **Issue**: `streamMsg.content += chunk` creates new string each time. 10,000-char response ≈ 1,000 concatenations with progressively growing strings.
- **Fix**: Accumulate chunks in array, `join('')` on demand.

---

## 2. CSS Animation Performance

### 🔴 P2-4: `backdrop-filter: blur(2px)` (High)

- **File**: `input.css:228` (`.workdir-switching-overlay`)
- **Issue**: `backdrop-filter: blur()` is extremely expensive — forces separate compositing layer with real-time Gaussian blur. Given known iPad performance issues (see recent commits), should be removed. Existing `rgba(0,0,0,0.45)` background is sufficient.
- **Fix**: Remove `backdrop-filter: blur(2px)`.

### 🟡 P2-5: `@keyframes toolExpand` Animates `max-height` (Medium)

- **File**: `tools.css:99-102`
- **Issue**: `max-height` animation from 0 to 500px triggers layout recalculation on every frame. Fires on every tool expand click.
- **Fix**: Replace with `grid-template-rows: 0fr → 1fr` transition, or keep only `opacity` fade-in.

### 🟡 P2-6: 10 Instances of `transition: all 0.15s` (Medium)

- **Files**: `loop.css:188`, `team.css:24,197,261,296,357,503,518,534,1114`
- **Issue**: `transition: all` animates every changing property, including potentially expensive ones.
- **Fix**: Replace with explicit property lists: `transition: color 0.15s, background 0.15s, border-color 0.15s`.

### 🟢 P3-1: Duplicate `@keyframes` Definitions (Low)

- `spin` (file-browser.css:154) = `workdir-spin` (input.css:238) = `loop-spin` (loop.css:358)
- `pulse-dot` (sidebar.css:335) = `loop-pulse` (loop.css:433)
- **Fix**: Consolidate into shared definitions in `base.css`.

### 🟢 P3-2: No `prefers-reduced-motion` Support (Low)

- No `@media (prefers-reduced-motion: reduce)` anywhere.
- **Fix**: Add global reduced-motion override in `base.css`.

### ✅ Good: Most Animations Use Compositor-Friendly Properties

All typing dots, spinners, blink-cursor animations use only `opacity`/`transform`. Previous commit `e18ba23` already removed box-shadow transitions. No `box-shadow` transitions found.

---

## 3. JavaScript Execution Efficiency

### 🟡 P3-3: Unthrottled `resize` Event Handler (Medium)

- **File**: `app.js:410-411`
- **Issue**: `window.resize` directly updates `isMobile` ref at 60Hz with no rAF/debounce.
- **Fix**: Wrap in `requestAnimationFrame` guard.

### 🟡 P3-4: File Browser Drag Resize Without rAF Guard (Medium)

- **Files**: `fileBrowser.js:334-336`, `filePreview.js:153-155`
- **Issue**: `mousemove` handler directly updates reactive ref on every pixel movement.
- **Fix**: Gate behind rAF to limit to one update per frame.

### 🟡 P3-5: Array Copy + Reverse to Find Single Element (Medium)

- **Files**: `connection.js:472`, `backgroundRouting.js:209`
- **Issue**: `[...messages.value].reverse().find(...)` — allocates new array, copies all refs, reverses, for a single lookup.
- **Fix**: Use reverse `for` loop (`findLast` pattern).

### 🟡 P3-6: Background Conversation Messages Grow Unbounded (Medium)

- **Files**: `backgroundRouting.js`, `loop.js`, `team.js`
- **Issue**: Background session message arrays have no cap. Long-running sessions accumulate thousands of messages.
- **Fix**: Cap at ~500 messages, drop oldest non-streaming messages on overflow.

### 🟢 P3-7: `document.querySelectorAll` for Highlight Scanning (Low)

- **File**: `appHelpers.js:46-51`
- **Issue**: Scans entire DOM for unhighlighted code blocks. Debounced to 300ms, mitigated by `[data-highlighted]` selector.
- **Fix**: Scope query to `.message-list` container.

---

## 4. Priority Fix Summary

| Priority | ID | Issue | Expected Gain | Effort |
|----------|----|-------|---------------|--------|
| **P0** | P0-2 | Skip Markdown render during streaming | Eliminate ~20/s `marked.parse()` calls | Small |
| **P0** | P0-1 | `conversationCache` LRU eviction | Prevent unbounded memory growth | Medium |
| **P1** | P1-2 | Inline `.some()` → computed | Eliminate 20Hz full-array scan | Tiny |
| **P1** | P1-1 | Cache tool message JSON.parse | Eliminate per-render JSON parsing | Small |
| **P1** | P1-3 | `isSessionProcessing` → computed Set | O(n×m) → O(1) | Small |
| **P1** | P1-4 | `canSend` scan → ref counter | Eliminate 20Hz array scan | Small |
| **P2** | P2-4 | Remove `backdrop-filter: blur` | Improve iPad performance | Tiny |
| **P2** | P2-5 | `toolExpand` remove `max-height` anim | Eliminate expand layout thrashing | Small |
| **P2** | P2-6 | `transition: all` → explicit props | Prevent accidental expensive transitions | Small |
| **P2** | P2-1 | Markdown cache: skip streaming entries | Prevent cache pollution & eviction | Small |
| **P2** | P2-2 | `v-show` → `v-if` for tool expand | Reduce DOM node count | Tiny |
| **P2** | P2-3 | Streaming string concat → array join | Reduce O(n²) to O(n) | Small |
| **P3** | P3-3 | Resize handler rAF guard | Reduce 60Hz to ~16Hz updates | Tiny |
| **P3** | P3-4 | Drag resize rAF guard | Reduce mousemove reflows | Tiny |
| **P3** | P3-5 | Array reverse → findLast loop | Eliminate array allocation | Tiny |
| **P3** | P3-6 | Background message cap | Prevent memory growth | Small |
| **P3** | P3-1 | Consolidate duplicate keyframes | Code cleanup | Tiny |
| **P3** | P3-2 | Add `prefers-reduced-motion` | Accessibility | Tiny |
| **P3** | P3-7 | Scope highlight querySelectorAll | Minor DOM scan reduction | Tiny |

---

## 5. Implementation Progress

- [x] P2-4: Remove `backdrop-filter: blur` (input.css)
- [x] P3-1: Consolidate duplicate `@keyframes` (spin×4, pulse×2)
- [x] P2-6: `transition: all` → explicit properties (loop.css ×1, team.css ×9)
- [x] P3-2: Add `prefers-reduced-motion` global override (base.css)
- [x] P1-2: `messages.some(m => m.isStreaming)` → computed (app.js)
- [x] P1-4: `canSend` array scan → computed (app.js)
- [x] P1-1: Cache `JSON.parse(toolInput)` on `msg._parsedInput` (messageHelpers.js)
- [x] P3-3: Resize handler rAF guard (app.js)
- [x] P3-5: `[...arr].reverse().find()` → reverse for loop (connection.js, backgroundRouting.js)
- [x] P2-2: `v-show` → `v-if` for tool expand (app.js)
- [x] P0-2: Skip Markdown render during streaming (messageHelpers.js, markdown.js)
- [x] P2-1: Markdown cache — skip streaming entries (markdown.js) *(resolved by P0-2)*
- [ ] P2-3: Streaming string concat → array join (streaming.js, backgroundRouting.js)
- [ ] P2-5: `toolExpand` remove `max-height` animation (tools.css)
- [ ] P3-7: Scope highlight `querySelectorAll` to `.message-list` (appHelpers.js)
