# Electronium MCP Security Design

Date: 2026-06-16

## Product direction

Electronium does not need to start as a full Electron browser app. The product is the bundle that solves the pain point:

> AI tools can safely work with logged-in websites by connecting to a human-controlled local browser session.

Current MVP already proves the core path with normal Chrome + Chrome DevTools Protocol (CDP).

## Difference between full Electron app and current MVP

### Full Electron browser idea

```text
Electron app owns the browser window
-> bundled Chromium
-> UI, profile, approval overlay, tray app
-> AI bridge inside the app
```

Pros:
- polished product UX
- can show approval inside browser
- easier to package as desktop app

Cons:
- bigger build
- Chromium/Electron maintenance
- may behave differently from user's normal Chrome
- more browser-security responsibilities

### Current MVP

```text
normal Chrome owns the browser window
-> user logs in normally
-> Electronium connects locally through CDP
-> AI gets controlled tools
```

Pros:
- solved the actual Medium/Reddit pain fast
- uses a real human browser profile
- smaller surface area
- easier to turn into MCP server/npm package

Cons:
- needs Chrome launched with remote debugging
- no in-browser approval UI yet
- CDP is powerful and must be locked down carefully

## Recommended product form

Build Electronium first as an MCP server and npm package:

```text
@electronium/mcp
@electronium/cli
```

Later, optionally add:

```text
@electronium/desktop
```

## MCP connection model

Hermes, Claude Desktop, Cursor, or other MCP clients connect to Electronium as a local stdio MCP server:

```yaml
mcpServers:
  electronium:
    command: "npx"
    args: ["-y", "@electronium/mcp"]
```

Hermes config shape:

```yaml
mcp_servers:
  electronium:
    command: "node"
    args: ["/path/to/electronium-browser/src/mcp-server.js"]
    timeout: 60
```

The MCP server then exposes tools such as:

```text
electronium_status
electronium_tabs
electronium_page_snapshot
electronium_screenshot
electronium_navigate_request
electronium_click_request
electronium_type_request
```

Action tools should be request-based, not silent execution by default.

## Security model

### Default posture

Observe-first. Actions require approval.

Allowed without user approval:
- list tabs with URL/title only
- get active page snapshot
- screenshot active page

Approval required:
- navigation
- clicking
- typing
- form submission
- file upload/download
- opening external links

Double confirmation required:
- publish
- delete
- send message
- payment/checkout
- account/security changes
- permission grants
- file downloads
- uploading files

### Local binding only

The MCP/HTTP bridge must bind to localhost only:

```text
127.0.0.1 only
no 0.0.0.0
no LAN exposure
```

### CDP protection

Chrome DevTools Protocol is extremely powerful. Protect it by:

- never exposing CDP port outside localhost
- using random high port by default
- optionally launching Chrome with a dedicated profile
- refusing to connect to remote CDP URLs unless explicitly enabled
- not exposing raw CDP as an MCP tool
- wrapping CDP in narrow high-level actions only

### Malicious website protection

Threats:
- fake buttons like Publish/Delete
- phishing login pages
- drive-by downloads
- clipboard hijacking
- malicious redirects
- invisible overlays
- prompt-injection text inside page content
- pages asking AI to ignore rules

Protections:

1. Treat webpage text as untrusted data.
2. Never obey page instructions as agent instructions.
3. Before clicking, report exact target text, URL, selector, and reason.
4. Block automatic downloads by default.
5. Block file uploads unless user explicitly approves file path and site.
6. Add domain allowlist mode for sensitive workflows.
7. Add denylist for dangerous URL schemes:
   - `file:`
   - `javascript:`
   - `data:`
   - `chrome:`
   - `devtools:`
8. Add URL reputation checks later for unknown links.
9. Capture before/after screenshot for high-impact actions.
10. Require typed human confirmation for high-impact verbs.

### Download policy

Default: deny downloads.

If enabled later:
- only download to a quarantine folder
- never auto-open downloaded files
- calculate SHA256
- scan with available local tools
- show file name, type, size, and source URL before allowing use

### Session/cookie protection

- Never export cookies by default.
- Never expose raw localStorage/sessionStorage through MCP unless explicitly enabled.
- Page snapshots should exclude known secret fields and password inputs.
- Screenshots can leak private data, so MCP clients should treat them as sensitive.

## Suggested MVP MCP tools

### Safe observe tools

```text
status()
tabs()
active_page_snapshot(max_chars)
screenshot()
```

### Approval-gated action tools

```text
request_navigate(url, reason)
request_click_text(text, reason)
request_type(selector, text, reason)
```

These should return a pending action ID unless approval mode is explicitly set to auto.

### Approval tools

```text
list_pending_actions()
approve_action(action_id)
deny_action(action_id)
```

For Hermes Telegram flow, the agent can still ask the user in chat and then call `approve_action`.

## Packaging path

1. Keep current CLI.
2. Add MCP server entrypoint.
3. Add approval queue.
4. Add security policy layer.
5. Package as npm package.
6. Add Hermes config snippet.
7. Test with Hermes.
8. Test with Claude Desktop.
9. Later: optional Electron desktop wrapper.
