# Competitive Landscape - Browser MCP Servers

Updated: 2026-06-16

---

## The field at a glance

The research found 60+ tools. They break into clear buckets:

| Bucket | Examples | Stars | Human session? | Approval model? |
|---|---|---|---|---|
| Headless / cloud | Playwright MCP, Browserbase, browser-use | 34K / 3.4K / 99K | No | No |
| Extension + human session | mcp-chrome, opendia, nanobrowser | 12K / 1.8K / 13K | Yes | No |
| Extension + human session + approval | (gap) | - | Yes | Yes - empty |
| Direct CDP (no extension) | Electronium, mcp-chrome-cdp | 0 / 0 | Yes (Electronium) | Yes (Electronium only) |

---

## Tier 1 - Major players

### browser-use / browser-use
- **Stars**: ~99,000
- **Approach**: Python SDK wrapping Playwright
- **Human session**: No - fresh headless browser
- **MCP**: Not native; other repos wrap it as MCP
- **Verdict**: Industry standard but fresh-browser only, bot-blocked on login-gated sites

### microsoft / playwright-mcp
- **Stars**: ~34,000
- **Approach**: Playwright spawns fresh headless browser
- **Human session**: No
- **Approval model**: None - fully autonomous
- **MCP tools**: navigate, screenshot, click, type via accessibility tree
- **Known issue**: Acknowledged bot-detection problem on Cloudflare/Medium/Google login pages
- **License**: Apache 2.0
- **Verdict**: Industry default MCP but blind to logged-in state

### nanobrowser / nanobrowser
- **Stars**: ~13,300
- **Approach**: Chrome extension with Planner + Navigator multi-agent system
- **Human session**: Yes - real Chrome with your cookies
- **Approval model**: None - fully autonomous agent
- **MCP**: Not MCP-exposed; standalone Chrome extension product
- **LLMs**: OpenAI, Anthropic, Gemini, Ollama, Groq, custom OpenAI-compatible
- **License**: Apache 2.0
- **Verdict**: Huge traction, real session, but zero approval model and not MCP

### mcp-chrome (Chrome extension)
- **Stars**: ~11,900
- **Approach**: Chrome extension + native messaging host
- **Human session**: Yes - directly accesses open tabs with login state
- **Approval model**: None
- **MCP tools**: 20+ including navigate, click, type, screenshot, DOM query
- **License**: MIT
- **Verdict**: Closest competitor to Electronium - real session, fast, active. Missing: approval model and audit trail

### browserbase / stagehand + mcp-server-browserbase
- **Stars**: Stagehand ~23,100 / MCP server ~3,400
- **Approach**: Cloud-hosted managed Chromium (Browserbase) + Stagehand SDK
- **Human session**: No - cloud session
- **Approval model**: None
- **Pricing**: Freemium, hosted at mcp.browserbase.com
- **License**: Apache 2.0
- **Verdict**: Production-grade but cloud-dependent, data leaves machine

---

## Tier 2 - Emerging / specialized

### stealth-browser-mcp
- **Stars**: ~691
- **Approach**: Python + nodriver + CDP, 97 tools
- **Human session**: No - fresh browser with stealth patches
- **Focus**: Anti-bot bypass (Cloudflare, Queue-It)
- **Verdict**: Solves a different problem (stealth), not human-session trust

### opendia
- **Stars**: ~1,832
- **Approach**: Chrome/Firefox extension
- **Human session**: Yes
- **Approval model**: None
- **Focus**: Anti-detection for social media automation
- **Verdict**: Real session but no permission model

### AIPexStudio / AIPex
- **Stars**: ~1,213
- **Approach**: Browser extension, privacy-first, locally hosted
- **Human session**: Yes
- **Approval model**: Partial
- **Verdict**: Privacy focus is a good signal but no structured approval flow

### AgentDeskAI / browser-tools-mcp
- **Stars**: ~7,200
- **Approach**: Chrome extension + local Node.js middleware
- **Human session**: Yes
- **Status**: ABANDONED - project is no longer actively maintained
- **Verdict**: Proved the real-session + local model demand, then died

---

## Tier 3 - Closest to Electronium's model

These are small/new but architecturally similar:

### koltyakov / browser-bridge
- **Stars**: ~12
- **Approach**: Chrome Web Store extension + local Node.js server
- **Human session**: Yes - real open Chrome tab with full cookies/login
- **Approval model**: Partial (reversible patches)
- **Supports**: Claude Code, Cursor, GitHub Copilot, Windsurf
- **License**: MIT
- **Verdict**: Closest product-shape sibling; no explicit approval/deny flow

### claw-relay
- **Stars**: 2
- **Approach**: Extension + permission trust layer
- **Human session**: Yes
- **Approval model**: Yes - scope-gated permissions + audit logging
- **Status**: Experimental
- **Verdict**: Closest ideologically (approval + audit) but zero adoption and early concept

### pagerunner
- **Stars**: 3
- **Approach**: Extension + daemon, learns over time
- **Human session**: Yes
- **Approval model**: Partial
- **Status**: Very new, minimal adoption

---

## The gap Electronium fills

The research found this combination is **unoccupied at any meaningful scale**:

```
Real logged-in Chrome session (no extension required)
  + per-action human approval before AI executes
  + full MCP server with no heavyweight dependencies
  + local/private (data stays on machine)
```

Specifically:
- **mcp-chrome** has real sessions but zero approval model
- **nanobrowser** has real sessions but fully autonomous
- **Playwright MCP** has approval nowhere and no real sessions
- **Browserbase** has cloud sessions and no approval
- **claw-relay** has the right idea (approval + audit) but 2 stars and experimental

Every major competitor lets the AI do what it wants once connected. Electronium is **ask-before-act**.

---

## Positioning matrix

```
                         Human session?
                    No              Yes
                 ┌──────────────┬─────────────────────┐
  Approval  No   │ Playwright   │ nanobrowser          │
  model?         │ Browserbase  │ mcp-chrome           │
                 │ browser-use  │ opendia              │
                 ├──────────────┼─────────────────────┤
            Yes  │      -       │ ELECTRONIUM          │
                 └──────────────┴─────────────────────┘
```

---

## MCP tool naming conventions in the space

| Style | Example |
|---|---|
| Flat verb-noun | `navigate`, `click`, `screenshot` |
| Prefixed | `browser_navigate`, `playwright_click` |

Electronium uses `electronium_*` prefix to avoid namespace collisions when multiple browser MCPs are loaded in the same AI client.

---

## Watch list

- `mcp-chrome` - most direct competitor, 12K stars, active daily commits
- `nanobrowser` - 13K stars, could pivot to MCP at any time
- `claw-relay` - approval model concept, watch if it gains traction
- `stealth-browser-mcp` - if Electronium adds stealth mode later, direct overlap
