# Plan: Rename `server/web-src/` → `server/web/`

## Motivation

The current layout uses two sibling directories under `server/`:
- `web-src/` — Vue 3 + Vite source code
- `web/` — Build output (gitignored)

This `web` + `web-src` naming is non-standard and confusing. The common convention in frontend projects (Next.js, Nuxt, CRA, etc.) is to have source in a clean name like `web/`, `client/`, or `frontend/`, with build output in a `dist/` subdirectory inside it.

## Target Structure

```
server/
├── web/                     # Source (was web-src/)
│   ├── src/                 # Vue components, modules, composables
│   ├── public/              # Static assets
│   ├── dist/                # Build output (was server/web/)
│   ├── node_modules/        # Frontend deps (gitignored)
│   ├── package.json
│   ├── vite.config.ts
│   └── index.html
├── src/                     # Server TypeScript source
├── dist/                    # Server build output
└── package.json
```

## Files to Modify

### 1. Git move: `server/web-src/` → `server/web/`

```bash
# The old build output dir (server/web/) is gitignored, so git sees nothing there.
# Just rename the source directory.
git mv server/web-src server/web
```

### 2. `server/web/vite.config.ts` (was `server/web-src/vite.config.ts`)

```diff
  build: {
-   outDir: '../web',
+   outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
```

Output now goes to `server/web/dist/` instead of `server/web/`.

### 3. `server/src/index.ts`

```diff
- const webDir = join(__dirname, '../web');
+ const webDir = join(__dirname, '../web/dist');
```

Server serves static files from the new build output location.

### 4. `server/package.json`

**`files` field** — controls what gets included in the npm package:

```diff
  "files": [
    "dist",
-   "web"
+   "web/dist"
  ],
```

**`prepublishOnly` script:**

```diff
- "prepublishOnly": "cd web-src && npm install && npm run build && cd .. && npm run build"
+ "prepublishOnly": "cd web && npm install && npm run build && cd .. && npm run build"
```

### 5. Root `package.json`

```diff
- "build:web": "cd server/web-src && npm install && npm run build",
+ "build:web": "cd server/web && npm install && npm run build",
```

### 6. `.gitignore`

```diff
- # Vite build output (entire server/web/ is generated from server/web-src/)
- server/web/
- server/web-src/node_modules/
+ # Vite build output
+ server/web/dist/
+ server/web/node_modules/
```

### 7. `vitest.config.ts`

```diff
  coverage: {
    provider: 'v8',
    include: ['server/src/**/*.ts', 'agent/src/**/*.ts'],
-   exclude: ['**/node_modules/**', '**/dist/**', 'server/web/**'],
+   exclude: ['**/node_modules/**', '**/dist/**', 'server/web/dist/**'],
  },
```

### 8. Test imports (2 files)

**`test/web/appHelpers.test.ts`:**
```diff
- from '../../server/web-src/src/modules/appHelpers.js'
+ from '../../server/web/src/modules/appHelpers.js'
```

**`test/web/loopTemplates.test.ts`:**
```diff
- from '../../server/web-src/src/modules/loopTemplates.js'
+ from '../../server/web/src/modules/loopTemplates.js'
```

### 9. CI workflows (no changes needed)

Both `.github/workflows/ci.yml` and `release.yml` use `npm run build:web` — they reference the root package.json script, which we already update in step 5. No direct path references in workflow files.

### 10. Documentation updates

**`CLAUDE.md`:**
- Project tree: `server/web-src/` → `server/web/`
- Build pipeline description: update paths
- All references to `server/web-src/` in file paths

**`MEMORY.md`:**
- Update any path references to `server/web-src/`

**`docs/*.md`:**
- Update path references in design documents (best-effort, these are historical docs)

## Execution Order

1. `git mv server/web-src server/web` — rename the directory
2. Update `vite.config.ts` — change `outDir` to `dist`
3. Update `server/src/index.ts` — point to `web/dist`
4. Update `server/package.json` — `files` field + `prepublishOnly`
5. Update root `package.json` — `build:web` script
6. Update `.gitignore` — new ignore patterns
7. Update `vitest.config.ts` — coverage exclusion
8. Update test imports (2 files)
9. Update `CLAUDE.md` and `MEMORY.md`
10. Build and verify: `cd server/web && npm run build` + `npm run build` + `npm test`

## Verification

1. **Build:** `cd server/web && npm run build` — outputs to `server/web/dist/`
2. **Server build:** `npm run build` (workspace build) — compiles server TypeScript
3. **Tests:** `npm test` — all pass with updated import paths
4. **npm pack dry-run:** `cd server && npm pack --dry-run` — verify `web/dist/` is included
5. **Manual:** Start server locally, verify web UI loads from `server/web/dist/`
