# Slash Command Autocomplete

## Overview

Add slash command autocomplete to the Web UI input box. When the user types `/`, a command menu appears above the input area. Commands can be selected via keyboard or mouse and sent immediately.

## Supported Commands

| Command | Description |
|---------|-------------|
| `/cost` | Show token usage and cost |
| `/context` | Show context usage |
| `/compact` | Compact context |

The command list is defined as a top-level constant array — adding a new command requires only one extra line. Descriptions are translated via the existing `t()` i18n function (see `modules/i18n.js`).

## UI Design

### Menu Position and Styling

- Appears **directly above** `.input-card` (`position: absolute; bottom: 100%`)
- Same width as `.input-card` (inherits `max-width: 768px`)
- Rounded card using existing CSS variables: `var(--bg-secondary)` background, `var(--border)` border
- Subtle `box-shadow` so the menu visually floats above the input area
- Each command on one line: **`/command`** (accent color) + gray description text

### Visual Mockup

```
┌──────────────────────────────────┐
│  /compact   Compact context      │  ← keyboard-selected highlight
│  /cost      Show token usage     │
│  /context   Show context usage   │
└──────────────────────────────────┘
┌──────────────────────────────────┐
│  /co█                            │
│                           [Send] │
└──────────────────────────────────┘
```

### Trigger Conditions

- Menu is shown when input text starts with `/` and contains no spaces after the `/`
- As the user types, results are filtered in real time (e.g. `/co` shows both `/compact` and `/cost`)
- Menu is hidden when:
  - Input is empty or does not start with `/`
  - Input contains a space after `/` (e.g. `/compact some text`)
  - No commands match the filter

### Interactions

| Action | Behavior |
|--------|----------|
| `ArrowUp` / `ArrowDown` | Move highlighted item |
| `Enter` | Select highlighted command → fill input → send immediately |
| `Tab` | Autocomplete command into input (does not send), user can continue editing |
| `Escape` | Close menu |
| Mouse hover | Highlight item |
| Mouse click | Select command → fill input → send immediately |

When the menu is visible, `ArrowUp`/`ArrowDown`/`Enter`/`Tab`/`Escape` must call `e.preventDefault()` to suppress default behavior (cursor movement, newline, etc.).

### IME Compatibility

The existing `handleKeydown` already checks `e.isComposing`. Slash commands are pure ASCII, so the menu logic is not triggered during IME composition.

## Implementation

### Architecture: Frontend-only, Zero Protocol Changes

The command text (e.g. `/cost`) is sent as a regular prompt to the agent, which forwards it as-is to the Claude CLI. Command output is returned via the existing `command_output` message type and displayed in the Web UI.

**No changes to agent or server code required.**

### Files to Modify

| File | Changes |
|------|---------|
| `server/web/app.js` | See details below |
| `server/web/style.css` | Add menu styles |
| `server/web/locales/en.json` | Add `slash.*` keys |
| `server/web/locales/zh.json` | Add `slash.*` keys |

### app.js Changes

**1. New constant**

```js
const SLASH_COMMANDS = [
  { command: '/cost', descKey: 'slash.cost' },
  { command: '/context', descKey: 'slash.context' },
  { command: '/compact', descKey: 'slash.compact' },
];
```

**2. New reactive state**

```js
const slashMenuIndex = ref(0);  // currently highlighted index
```

**3. New computed properties**

```js
const slashMenuVisible = computed(() => { /* inputText starts with / and has no spaces */ });
const filteredSlashCommands = computed(() => { /* filter SLASH_COMMANDS by inputText */ });
```

**4. Modify `handleKeydown`**

Insert menu key handling before the existing Enter-to-send logic:

- Menu visible: `ArrowUp`/`ArrowDown` move `slashMenuIndex`, `Enter` calls `selectSlashCommand`, `Tab` autocompletes, `Escape` clears input
- Menu not visible: existing behavior unchanged

**5. New method**

```js
function selectSlashCommand(cmd) {
  inputText.value = cmd.command;
  sendMessage();
}
```

**6. Template changes**

Insert menu DOM before `.input-card` (inside `.input-area`):

```html
<div v-if="slashMenuVisible && filteredSlashCommands.length > 0" class="slash-menu">
  <div v-for="(cmd, i) in filteredSlashCommands" :key="cmd.command"
       :class="['slash-menu-item', { active: i === slashMenuIndex }]"
       @mouseenter="slashMenuIndex = i"
       @click="selectSlashCommand(cmd)">
    <span class="slash-menu-cmd">{{ cmd.command }}</span>
    <span class="slash-menu-desc">{{ t(cmd.descKey) }}</span>
  </div>
</div>
```

### style.css New Styles

```css
.slash-menu { /* positioned above input-card, absolute positioning */ }
.slash-menu-item { /* single-line layout, padding, cursor pointer */ }
.slash-menu-item.active { /* highlighted background color */ }
.slash-menu-cmd { /* command name, accent color, font-weight 600 */ }
.slash-menu-desc { /* description, text-secondary color */ }
```

Note: `.input-area` needs `position: relative` added as the positioning context (not currently set).

### Locale Keys

Add to `server/web/locales/en.json`:

```json
"slash.cost": "Show token usage and cost",
"slash.context": "Show context usage",
"slash.compact": "Compact context"
```

Add to `server/web/locales/zh.json`:

```json
"slash.cost": "显示 Token 用量和费用",
"slash.context": "显示上下文用量",
"slash.compact": "压缩上下文"
```

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Input `/ cost` (space after `/`) | No match, menu hidden |
| Input `/xyz` (no match) | Menu hidden |
| `slashMenuIndex` out of bounds | Reset to 0 when filtered results change |
| Agent not connected | Menu not shown (follows textarea disabled state) |
| Mobile | Works normally, touch triggers click |
