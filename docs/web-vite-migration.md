# Web Frontend Migration: CDN → Vite + Vue SFC

## Motivation

The current web frontend (`server/web/`) is ~4100 lines across 10 files, with `app.js` alone at 709 lines — 300 lines of JS setup logic and 400 lines of HTML template in a single template literal. All dependencies (Vue, marked, highlight.js, TweetNaCl, pako) are loaded from CDN `<script>` tags as globals.

This works but has growing problems:
- **Maintainability**: 400-line HTML template string has no syntax highlighting or IDE support
- **No scoped CSS**: one 2166-line `style.css` with manual class naming
- **CDN dependency**: offline/air-gapped environments can't load the page
- **No tree shaking**: entire libraries loaded even if only a fraction is used
- **No TypeScript**: the frontend is the only untyped part of the codebase

## Target Architecture

Vite + Vue 3 SFC (Single File Components) with npm-managed dependencies, built into static assets that the Express server serves.

## Directory Structure

```
server/
├── src/                   # Express server (unchanged)
├── web/                   # Vite build output (git-tracked)
│   ├── index.html
│   ├── landing.html       # Static landing page (copied as-is)
│   ├── favicon.svg
│   └── assets/
│       ├── index-[hash].js
│       └── index-[hash].css
└── web-src/               # NEW: Vite project (Vue SFC source)
    ├── package.json       # vue, marked, highlight.js, tweetnacl, pako
    ├── vite.config.ts
    ├── tsconfig.json       # optional, can migrate to TS incrementally
    ├── index.html          # Vite entry HTML
    ├── public/
    │   ├── favicon.svg
    │   └── landing.html    # Copied to output root
    └── src/
        ├── main.js         # createApp, mount, provide store
        ├── App.vue         # Top-level layout (~30 lines template)
        ├── store.js        # Reactive state + module wiring (provide/inject)
        ├── encryption.js   # TweetNaCl wrapper (from current encryption.js)
        ├── components/
        │   ├── TopBar.vue          # Status badge, agent name, theme toggle
        │   ├── Sidebar.vue         # Hostname, workDir, session list, version
        │   ├── MessageList.vue     # Message loop, empty state, load-more
        │   ├── MessageItem.vue     # Single message (user/assistant/tool/system)
        │   ├── AskQuestion.vue     # Interactive question card
        │   ├── ChatInput.vue       # Textarea, attachments, send/stop
        │   ├── FolderPicker.vue    # Directory browser modal
        │   ├── AuthDialog.vue      # Password entry + locked state
        │   └── DeleteDialog.vue    # Session deletion confirmation
        └── composables/            # Renamed from modules/, same pattern
            ├── useConnection.js    # WebSocket connect/reconnect, message routing
            ├── useStreaming.js     # Progressive text reveal
            ├── useSidebar.js      # Session list, folder picker, navigation
            ├── useFileAttachments.js  # File upload, drag-drop, paste
            └── useMarkdown.js     # marked.js setup, renderMarkdown
```

## Component Breakdown

### Current `app.js` → Split Into:

| Current section (app.js lines) | New file | Approx size |
|-------------------------------|----------|-------------|
| Reactive state (23–81) | `store.js` | ~80 lines |
| Scroll/highlight/send logic (99–237) | `store.js` + `ChatInput.vue` | split |
| Watchers + lifecycle (239–249) | `App.vue` | ~10 lines |
| Return object (251–302) | Eliminated (provide/inject) | 0 |
| Top bar template (305–321) | `TopBar.vue` | ~30 lines |
| Sidebar template (340–407) | `Sidebar.vue` | ~80 lines |
| Message list template (412–554) | `MessageList.vue` + `MessageItem.vue` + `AskQuestion.vue` | ~180 lines |
| Input area template (557–608) | `ChatInput.vue` | ~60 lines |
| Folder picker template (612–647) | `FolderPicker.vue` | ~40 lines |
| Delete dialog template (650–663) | `DeleteDialog.vue` | ~20 lines |
| Auth dialogs template (666–703) | `AuthDialog.vue` | ~45 lines |

### Current `modules/` → `composables/`

Minimal code changes. The factory function pattern (`createFoo(deps)`) maps directly to Vue composables:

```js
// Before (modules/streaming.js)
export function createStreaming({ messages, scrollToBottom }) { ... }

// After (composables/useStreaming.js)
export function useStreaming() {
  const { messages, scrollToBottom } = inject('store');
  // same logic
}
```

## State Management: provide/inject

Instead of passing dozens of props through component trees, `store.js` creates a single reactive store object and `provide()`s it at the app level. Components `inject('store')` to access state and methods.

```js
// store.js
export function createStore() {
  const status = ref('Connecting...');
  const messages = ref([]);
  // ... all reactive state
  // ... all module instances (streaming, sidebar, connection, etc.)
  return { status, messages, /* ... */ };
}

// main.js
const store = createStore();
app.provide('store', store);

// Any component
const { status, messages, sendMessage } = inject('store');
```

## CSS Strategy

Two options (decide at implementation time):

**Option A: Scoped CSS in SFC (recommended)**
- Move relevant styles from `style.css` into each component's `<style scoped>`
- Keep shared variables/reset in a global `base.css`
- Eliminates naming collisions, easier to maintain

**Option B: Keep single `style.css`**
- Import it in `main.js` as `import '../style.css'`
- Vite handles it automatically
- Faster migration, can incrementally move to scoped later

## Vite Configuration

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  root: '.',
  build: {
    outDir: '../web',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3456',
      '/ws': { target: 'ws://localhost:3456', ws: true },
    },
  },
});
```

## npm Dependencies (web-src/package.json)

```json
{
  "dependencies": {
    "vue": "^3.4",
    "marked": "^12.0",
    "highlight.js": "^11.9",
    "tweetnacl": "^1.0.3",
    "tweetnacl-util": "^0.15.1",
    "pako": "^2.1"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5",
    "vite": "^5"
  }
}
```

## Build & Dev Workflow

```bash
# Development (with HMR)
cd server/web-src
npm run dev          # Vite dev server on :5173, proxies API to :3456

# Build for production
cd server/web-src
npm run build        # Output to server/web/

# Full project build (add to root package.json scripts)
npm run build:web    # cd server/web-src && npm run build
npm run build        # existing TS build + web build

# Publish (server package includes built web/ assets)
npm publish --workspace server --access public
```

## Migration Steps

1. **Scaffold Vite project** in `server/web-src/`, install deps
2. **Copy `encryption.js` and `modules/`** into `src/`, minimal edits to imports
3. **Create `store.js`** — extract reactive state from `app.js` setup function
4. **Create `App.vue`** — top-level layout, provide store
5. **Extract components one by one** from the template literal:
   - Start with leaf components (DeleteDialog, AuthDialog)
   - Then containers (TopBar, Sidebar, ChatInput)
   - Finally MessageList + MessageItem (largest, most complex)
6. **Build and verify** — output to `server/web/`, test end-to-end
7. **Update `landing.html`** — move to `public/` (copied as-is by Vite)
8. **Remove old `server/web/*.js` and `modules/`** — replaced by `assets/index-[hash].js`
9. **Update `.gitignore`** — decide: track `web/` build output or generate in CI
10. **Update root `package.json`** scripts for the new build step
11. **Update e2e tests** — should work unchanged (same served HTML, same DOM structure)

## Decisions to Make Before Implementation

- [ ] Track `web/` build output in git (simpler deploy) vs generate in CI (cleaner repo)
- [ ] CSS Option A (scoped) vs Option B (single file, migrate later)
- [ ] TypeScript in SFC: start with JS, add TS incrementally, or go all-TS from day one
- [ ] Whether `web-src` is a separate npm workspace or just a subdirectory with its own package.json

## Risk Assessment

- **Low risk**: This is a pure frontend refactor. The WebSocket protocol, server API, and agent code are untouched.
- **E2e tests**: Should pass unchanged since the DOM structure stays the same (same CSS classes, same elements). Only the delivery mechanism changes (bundled JS vs CDN globals).
- **Rollback**: Keep the old `web/` files in a branch. If something breaks, revert the `web/` directory.
