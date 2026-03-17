# Microsoft Entra ID (SPA + PKCE) Login Integration

## Context

AgentLink sessions at `https://msclaude.ai/s/xxxx` are currently accessible by anyone with the URL (optionally protected by session passwords). We need to add Microsoft Entra ID login to restrict access to `@microsoft.com` employees only.

The tenant policy blocks client secrets and certificates, so we use the **SPA + Authorization Code Flow with PKCE** approach — no server-side secrets needed. The user has already registered an Entra ID app with **SPA** platform type and redirect URI `http://localhost:3456/auth/callback`.

## Dual-Path Architecture

Two URL paths coexist, sharing the same session but with different access control:

| Path | Behavior | When generated |
|------|----------|----------------|
| `/s/:sessionId` | Original logic, no login required | Default (agent started without `--entra`) |
| `/ms/:sessionId` | Microsoft Entra ID login required | Agent started with `--entra` flag |

Both paths connect to the same underlying session and WebSocket protocol. `/ms/` is the "protected version" of `/s/`.

### Agent CLI

```bash
# Default — generates /s/ URL
agentlink-client start --server ws://localhost:3456

# With Entra — generates /ms/ URL
agentlink-client start --server ws://localhost:3456 --entra
```

`--entra` is a boolean flag (no arguments). Domain restriction is hardcoded to `@microsoft.com`.

### How it works

1. **Agent** starts with `--entra` → registers with server, includes `entra: true` in registration
2. **Server** sees `entra: true` → generates session URL with `/ms/` prefix instead of `/s/`
3. **Server** serves the same SPA `index.html` for both `/s/:sessionId` and `/ms/:sessionId`
4. **Frontend** (`main.js`) checks `window.location.pathname`:
   - Starts with `/ms/` → run MSAL login flow, verify `@microsoft.com` domain, then mount Vue app
   - Starts with `/s/` → mount Vue app directly (existing behavior)
5. **WebSocket** connection is identical for both paths — the session ID is the same

### Why path-based instead of env-var-based?

- Same build artifact serves both protected and unprotected sessions
- No rebuild needed to switch between modes — it's a per-session decision at agent startup
- Multiple agents can coexist: some with `--entra`, some without

## Approach

**Frontend-only MSAL.js integration** using `@azure/msal-browser`. The login gate runs before the WebSocket connection is established.

### Flow (for `/ms/` path)

1. User visits `/ms/xxxx`
2. `main.js` detects `/ms/` path → initializes MSAL and checks for an active session (silent token acquisition)
3. If no valid session → redirect to Microsoft login page
4. After login, Microsoft redirects back to `/auth/callback` with auth code
5. MSAL exchanges the code for tokens (PKCE, all in-browser)
6. `main.js` verifies the email ends with `@microsoft.com`
7. If valid → mount the Vue app normally
8. If invalid domain → show error, do not mount app

### Flow (for `/s/` path)

1. User visits `/s/xxxx`
2. `main.js` detects `/s/` path → mount Vue app directly (no MSAL, no login)

### Why frontend-only?

- No client secret/certificate needed (SPA + PKCE)
- Server code changes are minimal (route + passing `entra` flag in session URL)
- The existing session password auth remains as-is (defense in depth)
- WebSocket is already protected by session-level encryption

## Files to Modify

### 1. `server/web/package.json` — add dependency (already done)
```
"@azure/msal-browser": "^3.x"
```

### 2. `server/web/src/auth/msalConfig.js` — modify
Read Entra config from server-injected `<meta>` tag (Base64-encoded) instead of Vite env vars:
```js
function getEntraConfig() {
  const meta = document.querySelector('meta[name="entra-config"]');
  if (!meta?.content) return null;
  try { return JSON.parse(atob(meta.content)); } catch { return null; }
}

const entra = getEntraConfig();

export const msalConfig = {
  auth: {
    clientId: entra?.clientId || '',
    authority: `https://login.microsoftonline.com/${entra?.tenantId || 'common'}`,
    redirectUri: `${window.location.origin}/auth/callback`,
  },
  cache: { cacheLocation: 'localStorage' },
};
export const loginRequest = { scopes: ['openid', 'profile', 'email', 'User.Read'] };
```

### 3. `server/web/src/auth/msalAuth.js` — new file (already done)
Auth logic:
- `initAuth()` — create `PublicClientApplication`, call `handleRedirectPromise()`, try `acquireTokenSilent()`
- `requireLogin()` — call `loginRedirect()` if no account
- `getAccount()` — return current account
- `isAllowedDomain(account)` — check `account.username` ends with `@microsoft.com`
- `getUserPhoto()` — fetch profile photo from Microsoft Graph API, return blob URL
- `logout()` — call `logoutRedirect()`

### 4. `server/web/src/main.js` — modify
Check URL path instead of env var to decide whether to run MSAL:
```js
function mountApp() {
  createApp(App).mount('#app');
}

function showAccessDenied() {
  document.getElementById('app').innerHTML =
    '<div style="...">Access denied. A @microsoft.com account is required.</div>';
}

const isProtectedRoute = window.location.pathname.startsWith('/ms/');

if (isProtectedRoute) {
  import('./auth/msalAuth.js').then(({ initAuth, requireLogin, isAllowedDomain, getUserPhoto }) => {
    initAuth().then((account) => {
      if (!account) {
        requireLogin();
      } else if (!isAllowedDomain(account)) {
        showAccessDenied();
      } else {
        mountApp();
      }
    });
  });
} else {
  mountApp();
}
```

### 5. `server/src/http.ts` — inject Entra config + add routes

Server reads `ENTRA_CLIENT_ID` and `ENTRA_TENANT_ID` from environment variables at startup. If either is missing, the server exits with an error.

The `sendIndexHtml` handler reads `index.html`, injects a Base64-encoded `<meta>` tag into `<head>`, and serves the result:

```typescript
// At startup — fail fast if env vars are missing
const entraClientId = process.env.ENTRA_CLIENT_ID;
const entraTenantId = process.env.ENTRA_TENANT_ID;
if (!entraClientId || !entraTenantId) {
  console.error('ENTRA_CLIENT_ID and ENTRA_TENANT_ID environment variables are required');
  process.exit(1);
}

// Base64-encode the config once at startup
const entraConfigB64 = Buffer.from(JSON.stringify({
  clientId: entraClientId,
  tenantId: entraTenantId,
})).toString('base64');

// sendIndexHtml injects the <meta> tag into <head>
const sendIndexHtml = (_req, res) => {
  const html = fs.readFileSync(join(webDir, 'index.html'), 'utf-8');
  const injected = html.replace('<head>', `<head>\n    <meta name="entra-config" content="${entraConfigB64}">`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html');
  res.send(injected);
};

// Routes
app.get('/auth/callback', sendIndexHtml);
app.get('/ms/:sessionId', sendIndexHtml);
```

### 6. Agent CLI changes

#### `agent/src/cli.ts` — add `--entra` flag
```typescript
.option('--entra', 'Require Microsoft Entra ID login (generates /ms/ URL)')
```

#### `agent/src/connection.ts` — pass `entra` in registration query string
When `--entra` is set, include `entra=1` in the WebSocket registration URL:
```
?type=agent&id=NAME&name=NAME&workDir=PATH&entra=1
```

### 7. Server session URL generation

#### `server/src/ws-agent.ts` — read `entra` from query string
Store `entra: true` on the agent record when the query param is present.

#### `server/src/session-manager.ts` — use `/ms/` prefix when `entra` is set
When generating the session URL for the agent, use `/ms/:sessionId` if `agent.entra` is true, otherwise `/s/:sessionId`.

### 8. UI: display logged-in user's first name

#### `server/web/src/main.js`
When on `/ms/` route and login succeeds, store the user's first name on `window` so the Vue app can pick it up:
```js
if (isProtectedRoute) {
  import('./auth/msalAuth.js').then(({ initAuth, requireLogin, isAllowedDomain }) => {
    initAuth().then((account) => {
      if (!account) {
        requireLogin();
      } else if (!isAllowedDomain(account)) {
        showAccessDenied();
      } else {
        // Extract first name from account.name (e.g. "Kailun Shi" → "Kailun")
        window.__entraUser = { firstName: (account.name || '').split(' ')[0] || account.username };
        mountApp();
      }
    });
  });
}
```

#### `server/web/src/store.js`
After store initialization, check `window.__entraUser` and override `agentName`:
```js
// If Entra user is logged in, display their first name instead of agent name
if (window.__entraUser) {
  agentName.value = window.__entraUser.firstName;
}
```

#### `server/web/src/components/TopBar.vue`
No changes needed — it already renders `agentName` in the top-right. The override in `store.js` makes it show the user's first name instead.

### 9. Delete `server/web/.env` and `server/web/.env.example`
No longer needed — Entra config is injected at runtime by the server, not baked in at build time.

## Configuration

Entra ID config is provided via **server environment variables** (runtime, not build-time):
- `ENTRA_CLIENT_ID` — Application (client) ID from Azure Portal
- `ENTRA_TENANT_ID` — Directory (tenant) ID

If either variable is missing, the server **exits immediately** with an error message.

The server Base64-encodes these values and injects them into `index.html` via a `<meta>` tag at request time. The SPA reads the config from the `<meta>` tag — no Vite env vars, no build-time baking, no credentials in source code or git.

## Domain Allowlist

Initially hardcoded to `@microsoft.com`. Can be extended later via env var (`VITE_ALLOWED_DOMAINS`).

## What Does NOT Change

- WebSocket protocol
- Session encryption
- Session password auth (defense in depth — works on both `/s/` and `/ms/`)
- Existing `/s/` path behavior
- Any existing functionality

## Verification

1. **Server without env vars**: Server exits with error `ENTRA_CLIENT_ID and ENTRA_TENANT_ID environment variables are required`
2. **Agent without `--entra`**: URL is `/s/xxxx`, app loads directly — no login
3. **Agent with `--entra`**: URL is `/ms/xxxx`, redirects to Microsoft login → after login, app loads
4. **Direct `/s/` access to an `--entra` session**: Works without login (the session itself is not locked, only the `/ms/` entry point requires login)
5. **Non-Microsoft account on `/ms/`**: Login with a non-`@microsoft.com` account → "Access denied" message
6. **Auth callback route**: `/auth/callback` serves SPA for MSAL redirect handling
7. **View source on `/ms/` page**: `<meta name="entra-config" content="...">` contains Base64 (not plaintext GUIDs)
8. **Existing tests**: `npm test` and `npm run test:functional` still pass
