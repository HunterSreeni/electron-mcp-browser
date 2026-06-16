# Electronium Browser

A local-first AI browser bridge that connects to your real, logged-in Chrome session via Chrome DevTools Protocol (CDP). Lets AI assistants observe and interact with websites you're already logged into - without touching cookies or credentials directly.

## Why it exists

Playwright-controlled browsers get blocked by Cloudflare and similar anti-bot layers. Your real Chrome doesn't. Electronium bridges that gap by connecting to your existing browser session instead of spinning up a fake one.

```
You log into Chrome normally
  -> Chrome exposes a local DevTools port
  -> Electronium reads page content/screenshots via CDP
  -> AI proposes actions in chat
  -> You approve
  -> Electronium executes one command
```

## Architecture

```
AI assistant (Hermes, Claude Desktop, etc.)
    |
    | HTTP / MCP
    v
electronium bridge  (src/electronium.js)  <-- 127.0.0.1:17373
    |
    | WebSocket (Chrome DevTools Protocol)
    v
Chrome  (127.0.0.1:9222)
    |
    | real browser session
    v
Logged-in websites
```

Two files:
- `src/cdp.js` - low-level CDP transport: WebSocket session, tab selection, page snapshot, screenshot, navigate, click, type
- `src/electronium.js` - HTTP server + CLI wrapper around cdp.js

## Prerequisites

- Node.js >= 20
- Google Chrome (or Chromium)

## Setup

```bash
git clone https://github.com/HunterSreeni/electron-mcp-browser.git
cd electron-mcp-browser
```

No dependencies to install - uses only Node built-ins and the global `fetch`/`WebSocket` APIs available in Node 20+.

## Quick start

**Step 1 - launch Chrome with remote debugging:**

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/electronium-chrome
```

Use a dedicated `--user-data-dir` to keep this profile separate from your default Chrome. Log into any sites you need inside this window.

**Step 2 - verify connection:**

```bash
npm run status
```

**Step 3 - start the HTTP bridge (for AI tool integration):**

```bash
npm start
```

## CLI commands

All CLI commands connect to Chrome at `127.0.0.1:9222` by default.

| Command | Description |
|---|---|
| `node src/electronium.js serve` | Start HTTP bridge on port 17373 |
| `node src/electronium.js status` | Print current page URL, title, and text preview |
| `node src/electronium.js tabs` | List all open tabs |
| `node src/electronium.js screenshot [path]` | Capture screenshot (default: `/tmp/electronium-screenshot.png`) |
| `node src/electronium.js navigate <url>` | Navigate active tab to URL |
| `node src/electronium.js click-text <text>` | Click first visible element matching text |
| `node src/electronium.js type <selector> <text>` | Type text into CSS selector |

## HTTP API

When running `npm start`, the bridge exposes a local-only API at `http://127.0.0.1:17373`.

| Endpoint | Description |
|---|---|
| `GET /health` | Liveness check |
| `GET /tabs` | List open tabs (id, type, title, url) |
| `GET /page` | Active page snapshot (url, title, body text up to 8000 chars) |
| `GET /screenshot` | Screenshot as base64 JSON |
| `GET /screenshot?out=/tmp/page.png` | Screenshot saved to file |

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `ELECTRONIUM_HOST` | `127.0.0.1` | HTTP bridge bind address |
| `ELECTRONIUM_PORT` | `17373` | HTTP bridge port |
| `ELECTRONIUM_CDP_PORT` | `9222` | Chrome DevTools port |

## Approval model

Actions (navigate, click, type) go through human approval in chat before execution:

```
AI: I propose clicking "Publish" on Medium. Approve?
You: yes
AI runs: node src/electronium.js click-text "Publish"
AI: Verifying result...
```

Observation endpoints (status, tabs, page, screenshot) run without approval.

## Roadmap

- v0.1 (current) - CDP bridge, HTTP API, CLI, chat-approved actions
- v0.2 - MCP server entrypoint (`@electronium/mcp`)
- v0.3 - in-browser approval overlay, pending action queue
- v0.4 - URL allowlist/denylist, scheme blocking, domain policy
- v0.5 - npm package (`@electronium/cli`, `@electronium/mcp`)
- later - optional Electron desktop wrapper

## Security model

- Bridge binds to `127.0.0.1` only - never exposed to LAN
- CDP port stays local - never proxied or forwarded
- Observe-first posture - reads require no approval, writes require explicit user approval
- No cookie/credential export
- Page content treated as untrusted data

See [MCP_SECURITY_DESIGN.md](./MCP_SECURITY_DESIGN.md) for the full security design.

## License

MIT
