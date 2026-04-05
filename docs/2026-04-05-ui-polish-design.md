# UI Polish: Design Token System + Sidebar Layout Unification

**Date:** 2026-04-05
**Status:** Proposed
**Scope:** Pure CSS, no component structure changes

---

## Background

Font system overhaul just landed (commit `33501c0`): serif for AI, unified monospace, `80ch` max-width. With typography settled, the remaining visual inconsistencies become more noticeable:

- **Border-radius**: 7 different values (3px-16px) with no pattern
- **Shadows**: scattered, inconsistent between components, no theme awareness
- **Transitions**: 4 different durations (0.1s/0.15s/0.2s/0.3s) used randomly
- **Sidebar layout**: 11 font sizes, 3 different left-alignment baselines, cramped vertical spacing
- **Hardcoded colors**: link colors bypass the theme system

This document proposes a unified design token system and sidebar layout cleanup.

---

## Part 1: Design Tokens

Add to `:root` in `base.css`:

### Border-radius (3 tiers)

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | `4px` | Buttons, badges, small icons, code-copy-btn |
| `--radius-md` | `8px` | Input fields, session items, dropdowns, code blocks |
| `--radius-lg` | `12px` | Message bubbles, input-card, modals, slash-menu |

Key change: `input-card` drops from 16px to 12px to match message bubbles. Visually minimal, but the alignment is immediately noticeable.

### Shadows (3 tiers, theme-aware)

| Token | Dark theme | Light theme |
|-------|-----------|-------------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.2)` | `0 1px 3px rgba(0,0,0,0.06)` |
| `--shadow-md` | `0 4px 12px rgba(0,0,0,0.25)` | `0 4px 12px rgba(0,0,0,0.08)` |
| `--shadow-lg` | `0 8px 24px rgba(0,0,0,0.3)` | `0 8px 24px rgba(0,0,0,0.12)` |

Light theme shadows are automatically lighter - defined in the `[data-theme="light"]` block.

### Transitions (2 tiers)

| Token | Value | Usage |
|-------|-------|-------|
| `--transition-fast` | `0.12s ease` | Hover states, button feedback |
| `--transition-normal` | `0.2s ease` | Color/border changes, panel transitions |

---

## Part 2: Border-Radius Unification (13 changes)

| File | Selector | Current | New |
|------|----------|---------|-----|
| `chat.css` | `.message-bubble` | `10px` | `var(--radius-lg)` |
| `chat.css` | `.queue-item` | `8px` | `var(--radius-md)` |
| `base.css` | `.status-card` | `12px` | `var(--radius-lg)` |
| `base.css` | `.theme-toggle` | `8px` | `var(--radius-md)` |
| `base.css` | `.sidebar-toggle` | `4px` | `var(--radius-sm)` |
| `base.css` | `.badge` | `4px` | `var(--radius-sm)` |
| `input.css` | `.input-card` | `16px` | `var(--radius-lg)` |
| `input.css` | `.slash-menu` | `12px` | `var(--radius-lg)` |
| `markdown.css` | `.code-block-wrapper` | `8px` | `var(--radius-md)` |
| `markdown.css` | `.icon-btn` | `4px` | `var(--radius-sm)` |
| `markdown.css` | `.code-copy-btn` | `3px` | `var(--radius-sm)` |
| `tools.css` | `.tool-diff` / `.tool-block` | `4px` | `var(--radius-sm)` |
| `sidebar.css` | `.session-item` | `6px` | `var(--radius-md)` |

---

## Part 3: Shadow System (7 changes)

| File | Selector | Current | New |
|------|----------|---------|-----|
| `input.css` | `.input-card` | `0 2px 12px rgba(0,0,0,0.15)` | `var(--shadow-md)` |
| `input.css` | `.input-card:focus-within` | `0 2px 16px rgba(...)` | `var(--shadow-md), 0 0 0 2px rgba(107,159,206,0.15)` |
| `input.css` | `.slash-menu` | `0 4px 16px rgba(0,0,0,0.12)` | `var(--shadow-md)` |
| `input.css` | `.folder-picker-modal` | `0 8px 32px rgba(0,0,0,0.3)` | `var(--shadow-lg)` |
| `sidebar.css` | `.auth-form-dialog` | `0 8px 32px rgba(0,0,0,0.3)` | `var(--shadow-lg)` |
| `base.css` | `.status-card` | none | `var(--shadow-md)` |
| `responsive.css` | `.sidebar` (mobile) | `4px 0 24px rgba(0,0,0,0.5)` | `4px 0 20px rgba(0,0,0,0.3)` |

### Focus ring pattern

The input focus state changes from a simple border-color jump to a layered ring:

```
border-color: var(--accent);
box-shadow: var(--shadow-md), 0 0 0 2px rgba(107, 159, 206, 0.15);
```

This overlays the existing elevation shadow with a subtle 2px accent-colored outline, similar to Tailwind's `ring` utility. More refined than a hard border-color switch.

---

## Part 4: Micro-interactions

### Send button press feedback

```css
.send-btn:active {
  transform: scale(0.96);
}
```

### Link color cleanup

`markdown.css` has 4 hardcoded `#7aafe0` values and 2 light-theme `#2563eb` overrides. Replace all with `var(--accent)`:

- `.file-path-clickable` color
- `.markdown-body a` color
- Remove `[data-theme="light"] .file-path-clickable` override (now redundant)
- Remove `[data-theme="light"] .markdown-body a` override (now redundant)

Same for `tools.css` `.tool-summary.file-path-clickable`.

### Transition unification

Replace scattered `transition: ... 0.15s` with `var(--transition-fast)` for hover states, `var(--transition-normal)` for color/border changes. Only high-frequency components (base, chat, input, markdown, sidebar).

---

## Part 5: Message Bubble Tweaks

- User bubble padding: `0.6rem 0.9rem` -> `0.7rem 1rem` (slightly more breathing room)
- Border-radius unified via Part 2

---

## Part 6: Sidebar Layout Unification

### Problem: 11 font sizes with no hierarchy

Current sidebar uses these font-size values:

| Size | Elements |
|------|----------|
| 0.85rem | session title, workdir path |
| 0.82rem | new conversation btn |
| 0.80rem | sidebar search input |
| 0.78rem | global session item |
| 0.75rem | section header, session meta, workdir history |
| 0.72rem | recent history tab |
| 0.70rem | session delete overlay text |
| 0.68rem | global session workdir |
| 0.65rem | workdir history delete btn |
| 0.62rem | hostname |
| 0.60rem | version footer |

The 0.02-0.03rem gaps between sizes are imperceptible individually but create a collective feeling of "nothing quite lines up."

### Proposed: 4-tier font hierarchy

| Tier | Size | Usage |
|------|------|-------|
| **Body** | `0.82rem` | Session title, workdir path, new conversation btn, search input |
| **Secondary** | `0.75rem` | Section headers, session meta, tab labels, global session items, workdir history |
| **Tertiary** | `0.68rem` | Hostname, global session workdir path, timestamps |
| **Caption** | `0.60rem` | Version footer |

Each tier is 0.07rem apart - large enough to be visually distinct.

### Problem: Cramped vertical spacing

| Element | Current vertical padding |
|---------|------------------------|
| `.sidebar-section` | `0.1rem` (1.6px) - extremely tight |
| `.session-item` | `6px` |
| `.global-session-item` | `4px` |
| `.workdir-history-item` | `4px` |
| `.version-footer` | `6px` |

The section container padding of 1.6px is essentially zero - section headers press directly against their content with no breathing room.

### Proposed vertical spacing

| Element | New vertical padding | Rationale |
|---------|---------------------|-----------|
| `.sidebar-section` | `0.4rem` (6.4px) | Give section headers room to breathe |
| `.session-item` | `6px` | Keep as-is |
| `.global-session-item` | `6px` | Up from 4px, match session-item |
| `.workdir-history-item` | `6px` | Up from 4px, match session-item |

### Problem: 3 different left-alignment baselines

| Element | Effective left offset |
|---------|----------------------|
| Session items | ~16px (8px section + 8px item) |
| Global session items | ~14px (8px section + 6px item) |
| Version footer | 12px |

Text starts at three different vertical lines.

### Proposed horizontal alignment

Shift to "container owns the margin" pattern:

| Element | Change |
|---------|--------|
| `.sidebar-section` | Horizontal padding: `0.5rem` -> `0.75rem` (12px) |
| List items | Reduce horizontal padding so text aligns at the 12px baseline |
| `.version-footer` | Already at 12px, keep |

All text starts from the same 12px left edge.

### Sidebar border-radius cleanup

| Element | Current | New |
|---------|---------|-----|
| `.session-item` | `6px` | `var(--radius-md)` (8px) |
| `.global-session-item` | `4px` | `var(--radius-md)` (8px) |
| `.workdir-history-item` | `4px` | `var(--radius-md)` (8px) |
| `.new-conversation-btn` | `6px` | `var(--radius-md)` (8px) |
| `.workdir-history-delete` | `3px` | `var(--radius-sm)` (4px) |

### Bug fix

`.sidebar-search-input` uses `color: var(--text)` which is undefined. Should be `var(--text-primary)`. Currently works by accident (inherits from parent), but should be fixed.

---

## What We're NOT Doing

- **Color scheme** - dark/light palette is already solid
- **Component structure** - no Vue template changes
- **Skeleton loading** - significant engineering effort, out of scope
- **All sidebar font sizes identical** - information hierarchy needs some variation (hence 4 tiers, not 1)
- **git.css, file-browser.css, loop.css, team.css, proxy.css** - untouched

---

## Affected Files

| File | Changes |
|------|---------|
| `base.css` | New tokens, status-card shadow, radius/transition unification |
| `chat.css` | Bubble radius + padding, queue-item radius |
| `input.css` | Input-card radius/shadow/focus ring, slash-menu, folder-picker |
| `markdown.css` | Code-block radius, icon-btn radius, link color -> var(--accent) |
| `tools.css` | Tool-diff/tool-block radius, file-path color |
| `sidebar.css` | Font hierarchy, spacing, alignment, radius, search input bug fix, auth-dialog shadow |
| `responsive.css` | Mobile sidebar shadow |

Total: ~40 property changes across 7 CSS files.

---

## Verification

1. `npm run build` - no build errors
2. `npm test` + `npm run test:functional` - tests pass
3. Visual check:
   - Dark + Light themes: shadow depth looks appropriate
   - Input focus ring effect
   - Message bubble radius/padding consistency
   - Sidebar text alignment (all text starts at same left edge)
   - Sidebar font hierarchy (4 clear tiers)
   - Mobile sidebar overlay shadow
   - Links follow theme color correctly
