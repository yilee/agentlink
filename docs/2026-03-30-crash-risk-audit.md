# Crash Risk Audit — Unhandled Exceptions That Kill Agent/Server

**Date:** 2026-03-30
**Context:** The recent WS close code validation fix (`c464138`) prevented invalid close codes from crashing the agent. This audit identifies all remaining crash risks of the same class — unhandled exceptions from external input or race conditions that can terminate the process.

## Summary

Found **19 distinct crash vectors** across agent and server. Grouped by priority:

| Priority | Count | Impact |
|----------|-------|--------|
| P0 — Critical | 6 | Agent or server process crash from normal operation |
| P1 — High | 7 | Crash under race conditions or edge cases |
| P2 — Medium | 6 | Crash under unusual but possible conditions |

---

## P0 — Critical (Must Fix)

### 1. `encryptAndSend()` has no try/catch — every outbound message can crash

**Files:** `agent/src/encryption.ts:75-82`, `server/src/encryption.ts:83-90`

```typescript
export async function encryptAndSend(ws, msg, sessionKey): Promise<void> {
  if (sessionKey) {
    const encrypted = await encrypt(msg, sessionKey); // can throw
    ws.send(JSON.stringify(encrypted));               // can throw
  } else {
    ws.send(JSON.stringify(msg));                      // can throw
  }
}
```

**Why it crashes:** `ws.send()` throws synchronously if the WebSocket is in CLOSING/CLOSED state. `encrypt()` can throw if gzip fails. The function accepts `readyState` in its type but **never checks it**. Every single outbound message in both agent and server flows through this function.

**Fix:** Wrap the entire body in try/catch, log the error, return silently.

---

### 2. Agent `send()` queue — no `.catch()`, stale `ws!` assertion

**File:** `agent/src/connection.ts:270-277`

```typescript
export function send(msg: Record<string, unknown>): void {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    sendQueue = sendQueue.then(() =>
      encryptAndSend(state.ws!, msg, state.sessionKey)); // no .catch()!
  }
}
```

**Why it crashes:** The `.then()` callback runs asynchronously — by then `state.ws` may be null (set to null by `disconnect()`). The `!` assertion bypasses TypeScript's null check. If `encryptAndSend` rejects, the rejection propagates on `sendQueue` with no `.catch()`. Node.js 15+ terminates on unhandled rejections.

**Fix:** Add `.catch()` to the chain, re-check `state.ws` inside the callback.

---

### 3. Agent `ws.on('message')` — no top-level try/catch

**File:** `agent/src/connection.ts:187-236`

```typescript
ws.on('message', async (data) => {
  // ...
  state.sessionKey = decodeKey(parsed.sessionKey); // can throw on invalid base64!
  // ...
  handleServerMessage(msg);  // no try/catch wrapping this!
});
```

**Why it crashes:** The `ws.on('message')` callback is `async`. The `ws` EventEmitter does NOT forward rejected promises from async listeners to the `'error'` event. Any throw inside becomes an unhandled rejection:
- `decodeKey()` throws on invalid base64 from server
- `handleServerMessage()` has no top-level try/catch — any case branch can throw
- `readSessionMessages()` and `loadSessionMetadata()` in the `resume_conversation` case (line 436-462) do file I/O without try/catch
- `processFilesForClaude()` does `writeFileSync`/`mkdirSync` without try/catch

**Fix:** Wrap the entire `ws.on('message')` body in try/catch.

---

### 4. Server — no `'error'` event handler on ANY WebSocket

**Files:** `server/src/ws-agent.ts` (agent WS), `server/src/ws-client.ts` (web client WS)

Neither `handleAgentConnection` nor `completeConnection`/`handleWebConnection` register a `ws.on('error', ...)` handler. In Node.js, an EventEmitter that emits `'error'` with no listener **throws the error as an uncaught exception**, crashing the process. Network glitches routinely trigger WebSocket 'error' events.

**Fix:** Add `ws.on('error', (err) => console.error(...))` in both `handleAgentConnection` and `completeConnection`.

---

### 5. Server — fire-and-forget `encryptAndSend` with no `.catch()`

**Files:** Multiple locations in server code

| File | Lines | Context |
|------|-------|---------|
| `ws-agent.ts` | 74-79 | Agent reconnect notification loop |
| `ws-agent.ts` | 99-103 | Agent disconnect notification loop |
| `tunnel.ts` | 303-339 | Browser↔agent tunnel relay |
| `index.ts` | 58-64 | Heartbeat dead connection notification |

All call `encryptAndSend(...)` (async, returns Promise) without `await` or `.catch()`. If the WebSocket closes between the readyState check and the actual `ws.send()`, the unhandled rejection crashes the server.

**Fix:** Add `.catch()` to all fire-and-forget `encryptAndSend` calls, or wrap them in a safe helper.

---

### 6. Agent — `streamToStdin()` fire-and-forget, no error handler on `child.stdin`

**Files:** `agent/src/claude.ts:830`, `agent/src/sdk.ts:149-159`

```typescript
// claude.ts — fire and forget
streamToStdin(inputStream, child.stdin, abortController.signal);

// sdk.ts — no error handling
export async function streamToStdin(stream, stdin, abort?) {
  for await (const message of stream) {
    if (abort?.aborted) break;
    stdin.write(JSON.stringify(message) + '\n');  // can throw/emit 'error'
  }
  stdin.end();
}
```

**Why it crashes:** Two issues:
1. `streamToStdin` returns a Promise that is never awaited or caught — any exception becomes an unhandled rejection
2. `child.stdin` has NO `'error'` event listener anywhere. If the Claude child process exits mid-write, `stdin.write()` emits an unhandled 'error' event which crashes the agent

**Fix:** Add `child.stdin.on('error', ...)` after spawn. Add `.catch()` to the `streamToStdin` call.

---

## P1 — High (Should Fix)

### 7. Agent `ws.ping()` can throw in heartbeat

**File:** `agent/src/connection.ts:142`

```typescript
if (ws.readyState !== WebSocket.OPEN) return;
ws.ping(); // TOCTOU race — readyState can change between check and call
```

**Fix:** Wrap in try/catch.

---

### 8. Server `ws.ping()` can throw in heartbeat

**File:** `server/src/session-manager.ts:110, 121`

```typescript
agent.ws.ping();  // no readyState check, no try/catch
client.ws.ping(); // same
```

**Fix:** Wrap in try/catch.

---

### 9. Server — bare `ws.send()` calls without try/catch

**File:** `server/src/ws-client.ts` — lines 22, 43, 54, 89, 97, 111, 118, 178
**File:** `server/src/ws-agent.ts` — line 65

All these are synchronous `ws.send(JSON.stringify(...))` calls during connection setup or auth. If the client/agent disconnects mid-flow, `ws.send()` throws and propagates up through the WSS connection handler.

**Fix:** Wrap in try/catch or create a `safeSend()` helper.

---

### 10. Agent — `spawn()` without try/catch in `startQuery()`

**File:** `agent/src/claude.ts:818-825`

```typescript
const child = spawn(command, [...prefixArgs, ...args], {
  cwd: workDir, // ...
});
```

`spawn()` throws synchronously if the command is not found or the cwd doesn't exist (`ENOENT`). Compare to `handleBtwQuestion()` (line 496) which correctly wraps its spawn in try/catch.

**Fix:** Wrap in try/catch, send an error message to the web client.

---

### 11. Agent — `processFilesForClaude()` file operations without try/catch

**File:** `agent/src/claude.ts:700-716`

```typescript
mkdirSync(attachDir, { recursive: true });
writeFileSync(diskPath, Buffer.from(file.data, 'base64'));
```

If disk is full, permissions are wrong, or base64 data is malformed, these throw. No try/catch anywhere in the call chain up to `handleServerMessage`.

**Fix:** Wrap in try/catch.

---

### 12. Agent — `readSessionMessages()` without try/catch in resume_conversation

**File:** `agent/src/connection.ts:436-462`

```typescript
let history = readSessionMessages(state.workDir, m.claudeSessionId);
// ... also loadSessionMetadata calls ...
```

File I/O + JSON parsing — if the JSONL file is corrupted, this throws inside `handleServerMessage` which has no top-level try/catch.

**Fix:** Covered by fix #3 (top-level try/catch in `handleServerMessage` or `ws.on('message')`).

---

### 13. Server — no `'error'` handler on HTTP server or WebSocketServer

**File:** `server/src/index.ts`

```typescript
const server = createServer(app);           // no .on('error')
const wss = new WebSocketServer({ ... });   // no .on('error')
const tunnelWss = new WebSocketServer({ ... }); // no .on('error')
```

`EADDRINUSE` or other server errors emit 'error' with no listener → crash.

**Fix:** Add `.on('error', ...)` handlers.

---

## P2 — Medium (Nice to Fix)

### 14. Agent — `processOutput()` close observers can crash

**File:** `agent/src/claude.ts` (close observers in `finally` block)

If a close observer throws inside the `finally` block of `processOutput()`, the exception escapes as an unhandled rejection (since `processOutput` is fire-and-forget).

**Fix:** Wrap observer calls in try/catch.

---

### 15. Agent — `child.stdin.write()` for control_response without error handling

**File:** `agent/src/claude.ts:423-425`

```typescript
pending.child.stdin.write(JSON.stringify(response) + '\n');
```

The `stdin.destroyed` check is there but `stdin.write()` can still emit async 'error' if the pipe breaks.

**Fix:** Covered by fix #6 (add `stdin.on('error', ...)`).

---

### 16. Agent — `readSessionMessages` reads entire JSONL into memory

**File:** `agent/src/history.ts:201, 261, 358`

Very large session files (tens of MB) could cause OOM. Not an exception per se, but crashes the process.

**Fix:** Consider streaming/limiting reads for very large files.

---

### 17. Server — `encrypt()` has no try/catch (unlike `decrypt()`)

**Files:** `agent/src/encryption.ts:13-35`, `server/src/encryption.ts:17-39`

`decrypt()` is correctly wrapped in try/catch, but `encrypt()` is completely unprotected. `JSON.stringify`, `gzip`, and `tweetnacl.secretbox` can all throw.

**Fix:** Covered by fix #1 (try/catch in `encryptAndSend`), but could also add to `encrypt()` itself for defense in depth.

---

### 18. Agent CLI — `spawn()` and `openSync()` without try/catch in daemon start

**File:** `agent/src/cli.ts:95-110`

If the log directory doesn't exist or the cwd is invalid, these crash the CLI with an ugly stack trace instead of a user-friendly message.

**Fix:** Wrap in try/catch with user-friendly error messages.

---

### 19. Agent — `history.ts` stream error handler gap

**File:** `agent/src/history.ts:497-504`

`createReadStream` can emit 'error' before the readline interface is fully wired up. No direct `.on('error')` on the stream object.

**Fix:** Register stream error handler immediately after creation.

---

## Recommended Fix Order

The fixes are largely independent, but for maximum impact with minimum effort:

1. **Fix `encryptAndSend()` in both encryption.ts files** (fixes #1, covers #5, #17) — single change, protects every outbound message path
2. **Add `ws.on('error')` to server WS handlers** (fixes #4) — 2 one-liners
3. **Add top-level try/catch in agent `ws.on('message')`** (fixes #3, covers #12) — protects entire inbound message path
4. **Fix agent `send()` queue** (fixes #2) — add `.catch()` + null re-check
5. **Add `child.stdin.on('error')` + `.catch()` on `streamToStdin`** (fixes #6, #15)
6. **Wrap `ws.ping()` calls** (fixes #7, #8)
7. **Server `safeSend()` helper** (fixes #9)
8. **Server error handlers on HTTP/WSS** (fixes #13)
9. **Agent `spawn()` try/catch** (fixes #10, #11, #18)
10. **Remaining P2 items** (fixes #14, #16, #19)
