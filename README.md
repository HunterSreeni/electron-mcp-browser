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
AI assistant (Claude Desktop, Claude Code, Cursor, etc.)
    |
    | stdio (MCP) or HTTP
    v
electronium bridge  (src/mcp-server.js or src/electronium.js)
    |
    | WebSocket (Chrome DevTools Protocol)
    v
Chrome  (127.0.0.1:9222)
    |
    | real browser session with your cookies
    v
Logged-in websites
```

Source files:
- `src/cdp.js` - CDP transport: WebSocket session, tab selection, snapshot, screenshot, navigate, click, type
- `src/launcher.js` - cross-platform Chrome detection and launch (Windows, macOS, Linux)
- `src/mcp-server.js` - stdio MCP server (v0.2+)
- `src/electronium.js` - HTTP server + CLI wrapper

## Prerequisites

- Node.js >= 20
- Google Chrome (or Chromium, or Microsoft Edge)

## Setup

```bash
git clone https://github.com/HunterSreeni/electron-mcp-browser.git
cd electron-mcp-browser
```

No dependencies to install - uses only Node built-ins and the global `fetch`/`WebSocket` APIs in Node 20+.

---

## MCP server (v0.2)

The MCP server lets any MCP-compatible AI client (Claude Desktop, Claude Code, Cursor, Windsurf) drive your browser directly as tools.

### Step 1 - Wire it into your AI client

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json` on Mac, `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "electronium": {
      "command": "node",
      "args": ["/absolute/path/to/electron-mcp-browser/src/mcp-server.js"]
    }
  }
}
```

**Claude Code** (`.claude/settings.json` in your project, or `~/.claude/settings.json` globally):

```json
{
  "mcpServers": {
    "electronium": {
      "command": "node",
      "args": ["/absolute/path/to/electron-mcp-browser/src/mcp-server.js"]
    }
  }
}
```

**Cursor / Windsurf** (`.cursor/mcp.json` or `.windsurf/mcp.json`):

```json
{
  "mcpServers": {
    "electronium": {
      "command": "node",
      "args": ["/absolute/path/to/electron-mcp-browser/src/mcp-server.js"]
    }
  }
}
```

### Step 2 - Use it

Once wired in, the AI has access to these tools:

| Tool | Type | Description |
|---|---|---|
| `electronium_launch` | action | Launch Chrome with CDP enabled |
| `electronium_status` | observe | Active tab URL, title, text preview |
| `electronium_tabs` | observe | List all open tabs |
| `electronium_page_snapshot` | observe | Full page text (up to 8000 chars) |
| `electronium_screenshot` | observe | Screenshot (rendered inline in Claude Desktop) |
| `electronium_navigate` | queued action | Request navigation - requires approval |
| `electronium_click_text` | queued action | Request click by visible text - requires approval |
| `electronium_type` | queued action | Request text input - requires approval |
| `electronium_list_pending` | queue | Show pending actions awaiting approval |
| `electronium_approve` | queue | Execute an approved action |
| `electronium_deny` | queue | Discard a queued action |

**Observe tools** run immediately. **Action tools** queue the action and return a pending ID - the AI will ask you to confirm before calling `electronium_approve`.

### Environment variables for MCP server

| Variable | Default | Description |
|---|---|---|
| `ELECTRONIUM_CDP_PORT` | `9222` | Chrome DevTools port |
| `ELECTRONIUM_CHROME_PATH` | auto-detect | Override Chrome executable path |
| `ELECTRONIUM_CHROME_DIR` | OS default | Override Chrome profile directory |

---

## CLI quick start

**Step 1 - launch Chrome (auto-detects your OS):**

```bash
node src/electronium.js launch
```

Or manually by platform:

```bash
# Windows
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\electronium-profile" --disable-blink-features=AutomationControlled

# macOS
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 --user-data-dir="~/Library/Application Support/electronium-profile" --disable-blink-features=AutomationControlled

# Linux
google-chrome --remote-debugging-port=9222 --user-data-dir="~/.config/electronium-profile" --disable-blink-features=AutomationControlled
```

Print the correct command for your machine:

```bash
node src/electronium.js launch-cmd
```

**Step 2 - verify connection:**

```bash
npm run status
```

**Step 3 - start the HTTP bridge (optional, for non-MCP integrations):**

```bash
npm start
```

## CLI commands

| Command | Description |
|---|---|
| `node src/electronium.js launch` | Auto-detect and launch Chrome with CDP |
| `node src/electronium.js launch-cmd` | Print the manual launch command for your OS |
| `node src/electronium.js serve` | Start HTTP bridge on port 17373 |
| `node src/electronium.js status` | Print current page URL, title, and text preview |
| `node src/electronium.js tabs` | List all open tabs |
| `node src/electronium.js screenshot [path]` | Capture screenshot |
| `node src/electronium.js navigate <url>` | Navigate active tab to URL |
| `node src/electronium.js click-text <text>` | Click first visible element matching text |
| `node src/electronium.js type <selector> <text>` | Type text into CSS selector |

## HTTP API

When running `npm start`, the bridge exposes a local-only API at `http://127.0.0.1:17373`.

| Endpoint | Description |
|---|---|
| `GET /health` | Liveness check |
| `GET /tabs` | List open tabs |
| `GET /page` | Active page snapshot |
| `GET /screenshot` | Screenshot as base64 JSON |
| `GET /screenshot?out=page.png` | Screenshot saved to file |

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `ELECTRONIUM_HOST` | `127.0.0.1` | HTTP bridge bind address |
| `ELECTRONIUM_PORT` | `17373` | HTTP bridge port |
| `ELECTRONIUM_CDP_PORT` | `9222` | Chrome DevTools port |
| `ELECTRONIUM_TOKEN` | none | Auth token for HTTP bridge (recommended) |
| `ELECTRONIUM_SCREENSHOT_DIR` | `os.tmpdir()` | Safe directory for screenshot saves |
| `ELECTRONIUM_CHROME_PATH` | auto-detect | Override Chrome executable path |
| `ELECTRONIUM_CHROME_DIR` | OS default | Override Chrome profile directory |

## Security model

- Bridge and CDP port bind to `127.0.0.1` only - never exposed to LAN
- Observe tools (read) require no approval; action tools (write) are queued until human approves
- No cookie or credential export
- Blocked URL schemes: `javascript:`, `file:`, `data:`, `chrome:`, `devtools:`, `blob:`
- Page content treated as untrusted data - AI cannot be instructed by page text

See [MCP_SECURITY_DESIGN.md](./MCP_SECURITY_DESIGN.md) for the full security design.

## Roadmap

- v0.1 - CDP bridge, HTTP API, CLI, chat-approved actions
- v0.2 (current) - MCP stdio server, cross-platform launcher, approval queue, 11 MCP tools
- v0.3 - in-browser approval overlay (visible notification when AI requests an action)
- v0.4 - URL allowlist/denylist, domain policy
- v0.5 - npm package (`electronium-mcp` on npm)
- later - optional Electron desktop wrapper

## License

MIT
