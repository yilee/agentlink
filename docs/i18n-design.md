# Web UI Internationalization (i18n) Design

## Scope

Phase 1 + Phase 4 only: extract simple UI strings (buttons, labels, status messages, placeholders) and add a language switcher. **Excludes** Team/Loop prompt templates (Phase 3) and parameterized dynamic messages with pluralization (Phase 2).

## Approach

### Lightweight `t()` function — no framework dependency

Since the web SPA loads via CDN without a build step, we avoid `vue-i18n` and implement a minimal i18n module:

```
server/web/
├── modules/
│   └── i18n.js          # t() function, locale management
└── locales/
    ├── en.json           # English strings
    └── zh.json           # Chinese strings
```

### i18n.js API

```javascript
// Factory: createI18n() → { t, locale, setLocale }
//
// t(key)              → translated string
// t(key, { n: 5 })   → with parameter substitution: "attempt {n}" → "attempt 5"
// locale              → current locale ('en' | 'zh')
// setLocale(lang)     → switch language, persist to localStorage, reload strings
```

### Key format

Flat dot-notation keys grouped by module:

```json
{
  "status.connecting": "Connecting...",
  "status.connected": "Connected",
  "button.copy": "Copy",
  "button.send": "Send",
  "sidebar.today": "Today",
  "input.placeholder": "Send a message · Enter to send"
}
```

### Language detection priority

1. `localStorage.getItem('agentlink-language')` (user explicit choice)
2. `navigator.language` (browser preference, map `zh-*` → `zh`, else `en`)
3. Default: `en`

### Language switcher UI

A toggle button in the header bar (next to the theme toggle), cycling `EN ↔ 中`.

### Integration pattern

Each module that needs translations receives `t` via dependency injection (same factory pattern already used):

```javascript
// In app.js
const { t, locale, setLocale } = createI18n();

// Pass t to module factories
const sidebar = createSidebar({ ..., t });

// In Vue template: {{ t('button.send') }}
// In JS: element.textContent = t('status.connected');
```

### What gets translated (Phase 1)

- Button labels: Copy, Send, Refresh, Cancel, Confirm, Remove, etc.
- Status badges: Connecting, Connected, Waiting, Disconnected, etc.
- UI labels: Status, Agent, Directory, Session, Sessions, Chat, Team, Loop
- Placeholders: input box, password field
- Session grouping: Today, Yesterday, This week, Earlier
- Relative time: just now, Xm ago, Xh ago, Xd ago
- System messages: New conversation started, Context compacting, Generation stopped, etc.
- Theme toggle titles, sidebar toggle titles
- Error messages: Incorrect password, Unable to reconnect, etc.

### What stays in English (out of scope)

- Team/Loop prompt templates (AI instructions — translation risks degrading Claude behavior)
- Tool output from Claude (dynamic, not UI-controlled)
- File paths, session IDs, technical identifiers

### Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Missing key returns undefined | `t()` returns the key itself as fallback |
| Locale JSON fails to load | Bundle both locales inline or use sync fetch with fallback |
| Dynamic strings break | Simple `{param}` replacement, no complex ICU needed for Phase 1 |
