# Electronium Browser MVP

A local-first AI browser bridge that uses a **real human Chrome profile** instead of Playwright-controlled login.

## Why this exists

Playwright-controlled Chrome got blocked by Medium/Cloudflare. Normal Chrome passed.

Electronium MVP solves that gap:

```text
Human logs in with normal Chrome
-> Chrome exposes a local DevTools port
-> Electronium reads URL/title/text/screenshot through CDP
-> AI can inspect the logged-in page without touching cookies directly
```

## Current MVP scope

This is not full Electron yet. It is the smallest useful proof:

- launches normal `google-chrome` with a persistent profile
- connects through Chrome DevTools Protocol
- lists tabs
- gets active page title, URL, and body text
- captures screenshot
- exposes a local HTTP API for AI tools
- supports chat-approved CLI actions: navigate, click visible text, type into selector

## Approval model

For now, approval happens **in chat**, not inside the browser.

Flow:

```text
JARVIS inspects page
-> JARVIS proposes exact action in Telegram
-> you approve in chat
-> JARVIS runs one Electronium command
-> JARVIS verifies result
```

Example:

```text
JARVIS: I propose clicking "Write" on Medium. Approve?
Hunter: yes
JARVIS runs: node src/electronium.js click-text "Write"
```

Later, v0.3 can add an in-browser approval overlay.

## Commands

Launch Chrome manually:

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir=/home/huntersreeni/.hermes/medium-human-chrome https://medium.com/me
```

Check connection:

```bash
npm run status
```

Action commands, only after chat approval:

```bash
node src/electronium.js navigate https://example.com
node src/electronium.js click-text "Write"
node src/electronium.js type "textarea" "Draft text"
```

Start local API:

```bash
npm start
```

API endpoints:

```text
GET http://127.0.0.1:17373/health
GET http://127.0.0.1:17373/tabs
GET http://127.0.0.1:17373/page
GET http://127.0.0.1:17373/screenshot
```

## Competition snapshot

Existing competitors/tools:

- `browser-use/browser-use` - huge open-source AI browser automation library.
- `browserbase/stagehand` - SDK for browser agents, commonly tied to hosted Browserbase.
- `microsoft/playwright-mcp` - MCP server around Playwright.
- `nanobrowser/nanobrowser` - Chrome extension for AI web automation.
- `AIPexStudio/AIPex` - privacy-first AI browser automation assistant.
- `browserable/browserable` - self-hostable browser automation library.

Electronium's differentiator:

> Use the user's real local browser session, keep the human in the login/trust loop, and expose a small permissioned bridge for AI assistants.

## Safety rule

MVP is observe-first. Clicking/typing/submitting are intentionally not implemented yet.
