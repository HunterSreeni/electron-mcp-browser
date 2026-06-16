# Security & Code Analysis

Date: 2026-06-16

---

## Security risks

### HIGH - Path traversal via `/screenshot?out=` parameter

**File:** `src/electronium.js:41-45`

```js
const outPath = path.resolve(out);
await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, Buffer.from(shot.data, 'base64'));
```

`out` is a raw user-supplied query parameter resolved to an absolute path with no directory restriction. Any process on the machine can call:

```
GET http://127.0.0.1:17373/screenshot?out=/home/user/.ssh/authorized_keys
```

and overwrite arbitrary files with PNG data.

**Fix:** Restrict writes to a safe directory (e.g., `/tmp` or a configurable `ELECTRONIUM_SCREENSHOT_DIR`) and reject paths that escape it.

```js
const SAFE_DIR = process.env.ELECTRONIUM_SCREENSHOT_DIR || '/tmp';
const outPath = path.resolve(SAFE_DIR, path.basename(out));
```

---

### HIGH - No URL scheme validation in `navigate`

**File:** `src/cdp.js:123-128`, `src/electronium.js:85-88`

The `navigate` command passes the URL directly to `Page.navigate` with no validation. An AI agent or CLI caller could issue:

```
node src/electronium.js navigate javascript:alert(1)
node src/electronium.js navigate file:///etc/passwd
node src/electronium.js navigate chrome://settings
node src/electronium.js navigate data:text/html,<script>...
```

CDP will execute these. `file:` exposes the local filesystem. `javascript:` runs arbitrary code in the active page context.

**Fix:** Add a scheme allowlist before calling CDP.

```js
const BLOCKED_SCHEMES = ['javascript:', 'file:', 'data:', 'chrome:', 'devtools:', 'blob:'];
if (BLOCKED_SCHEMES.some(s => url.toLowerCase().startsWith(s))) {
    throw new Error(`Blocked URL scheme: ${url}`);
}
```

---

### MEDIUM - No authentication on the HTTP bridge

**File:** `src/electronium.js:57-65`

The HTTP server at `127.0.0.1:17373` has no token or authentication. Any local process can call it, including:
- malicious npm packages running in the same user context
- browser-based CSRF (a webpage can fetch `http://127.0.0.1:17373/page` and exfiltrate it to a remote server - CORS does not prevent the request, only the browser reading the response)

**Fix for CSRF:** Add a required `X-Electronium-Token` header and check it on every request. Generate the token on startup and write it to a local file that only the user can read.

---

### MEDIUM - CORS header is incomplete and misleading

**File:** `src/electronium.js:16`

```js
'access-control-allow-origin': 'http://127.0.0.1',
```

This only adds the header to responses. It does NOT block requests from other origins - browsers still send the request, they just refuse to let the page read the response. A malicious page can use `fetch()` with `mode: 'no-cors'` to fire a navigation or click action without reading the response.

The header also doesn't cover the loopback alias `http://localhost` or `http://[::1]`.

**Fix:** Pair CORS with a secret request token (see above). CORS alone is not sufficient access control for a localhost API.

---

### LOW - No HTTP method restriction

**File:** `src/electronium.js:21-54`

The server responds to all HTTP methods (POST, DELETE, PUT, PATCH, etc.) identically to GET. This is a minor surface area concern - any method triggers the same handlers.

**Fix:** Add a method check at the top of `handle()`.

```js
if (req.method !== 'GET') {
    sendJson(res, 405, { ok: false, error: 'Method not allowed' });
    return;
}
```

---

### LOW - Screenshots can leak session data

**File:** `src/cdp.js:109-121`

Screenshots capture the full visible page including cookies, session tokens displayed on screen, private DMs, email content, and financial data. The current design returns them as base64 JSON over the local HTTP API with no warning or access control.

This is not a bug but a design decision worth documenting: MCP clients or scripts that save screenshots to disk or log them should be considered sensitive.

---

## Code bugs

### BUG - JSON.parse crash in CDP message handler

**File:** `src/cdp.js:45`

```js
this.socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
```

If Chrome sends a malformed or non-JSON WebSocket frame (which can happen during certain error states or browser crashes), `JSON.parse` throws an uncaught exception inside the event listener. This kills the message handler silently - all subsequent CDP responses are ignored, all pending promises hang until their 15s timeout fires.

**Fix:**

```js
let message;
try {
    message = JSON.parse(event.data);
} catch {
    return;
}
```

---

### BUG - Pending promises not rejected on socket close

**File:** `src/cdp.js:72-74`

```js
close() {
    if (this.socket) this.socket.close();
}
```

`this.pending` is never drained on close. If `close()` is called while CDP commands are in-flight, those promises hang until each individual 15s timeout fires. In `withActivePage`, the `finally` block calls `session.close()`, so any error during a CDP call will leave orphaned promises waiting 15 seconds before rejecting.

**Fix:** Reject all pending promises on close.

```js
close() {
    if (this.socket) this.socket.close();
    for (const [id, { reject }] of this.pending) {
        reject(new Error('CDP session closed'));
        this.pending.delete(id);
    }
}
```

---

### BUG - `navigateTo` returns before navigation completes

**File:** `src/cdp.js:123-128`

```js
export async function navigateTo(url, options = {}) {
    return withActivePage(async (session) => {
        await session.send('Page.navigate', { url });
        return { ok: true, action: 'navigate', url };
    }, options);
}
```

`Page.navigate` resolves when the navigation starts, not when the page finishes loading. Immediately calling `getPageSnapshot` after `navigateTo` will return the old page or a blank loading state.

**Fix:** Wait for `Page.loadEventFired` or use `Page.navigate`'s response which includes a `frameId` and can be paired with `Page.frameStoppedLoading`.

---

### BUG - `clickText` fires synthetic `.click()` not a real mouse event

**File:** `src/cdp.js:146`

```js
el.click();
```

`el.click()` is a synthetic DOM click - it doesn't dispatch `mousedown`, `mouseenter`, `mousemove`, or `mouseup` events. Some SPAs and web apps only respond to real pointer events. For these, the click appears to do nothing.

**Fix:** Use `Input.dispatchMouseEvent` via CDP for a real pointer event sequence, or at minimum dispatch `pointerdown`/`mousedown`/`mouseup`/`click` in sequence.

---

### BUG - `typeText` sets `.value` directly, bypassing React/Vue state

**File:** `src/cdp.js:162-165`

```js
el.value = text;
el.dispatchEvent(new Event('input', { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
```

React's synthetic event system wraps the native input value property. Setting `.value` directly and firing a plain `Event` often does not trigger React's state update because React tracks value changes through its own descriptor. This is a known issue - React-controlled inputs will show the new value visually but the component state won't update, so submitting the form sends the old value.

**Fix:** Use the React internal fiber trick to override the value descriptor, or use `Input.dispatchKeyEvent` CDP commands to simulate real keystrokes, which works on all frameworks.

---

### BUG - `extract-medium-profile.js` has hardcoded username

**File:** `scripts/extract-medium-profile.js:26`

```js
const mediumPostLinks = links.filter((x) => x.href.includes('medium.com/@sreenivasan96/') || x.href.includes('medium.com/p/'));
```

The username `sreenivasan96` is hardcoded. This script cannot be reused for any other Medium profile without editing the source.

**Fix:** Accept the username as a CLI argument or read it from an environment variable.

---

### ISSUE - No reconnect logic for CDP session

**File:** `src/cdp.js`

`CdpSession` does not reconnect if Chrome restarts or the WebSocket drops. Every call to `withActivePage` creates a fresh session and closes it, so short-lived calls are fine. But if Chrome crashes mid-command, the active session gets an error and is not retried.

This is acceptable for MVP but worth noting before any long-running session feature is added.

---

### ISSUE - `getActiveTab` prefers any non-chrome:// tab over the truly active one

**File:** `src/cdp.js:19`

```js
return pages.find((tab) => tab.url && !tab.url.startsWith('chrome://')) || pages[0];
```

CDP's `/json` endpoint returns all tabs but doesn't indicate which is focused. This heuristic skips `chrome://` tabs but does not pick the most recently focused tab - it picks the first non-chrome tab in list order. If the user has multiple tabs open, the wrong tab may be used.

**Fix:** Track `Target.activatedTarget` events, or accept an explicit tab ID parameter from the caller.

---

## Summary table

| Severity | Issue | File |
|---|---|---|
| HIGH | Path traversal via `?out=` parameter | `electronium.js:41` |
| HIGH | No URL scheme validation in navigate | `cdp.js:125`, `electronium.js:86` |
| MEDIUM | No auth on HTTP bridge (CSRF/local process risk) | `electronium.js` |
| MEDIUM | CORS header incomplete | `electronium.js:16` |
| LOW | No HTTP method restriction | `electronium.js:21` |
| LOW | Screenshots leak session data (design note) | `cdp.js:109` |
| BUG | JSON.parse crash in CDP message handler | `cdp.js:45` |
| BUG | Pending promises not rejected on socket close | `cdp.js:72` |
| BUG | navigate returns before page load completes | `cdp.js:123` |
| BUG | click uses synthetic `.click()`, not real mouse events | `cdp.js:146` |
| BUG | typeText breaks React/Vue controlled inputs | `cdp.js:162` |
| BUG | Hardcoded username in extract-medium-profile.js | `scripts/extract-medium-profile.js:26` |
| ISSUE | No CDP reconnect logic | `cdp.js` |
| ISSUE | Active tab selection heuristic unreliable | `cdp.js:19` |
