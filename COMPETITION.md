# Electronium Browser - Competition Snapshot

Date: 2026-06-16

## What was checked

GitHub API searches for AI browser automation and known projects.

## Existing competitors/tools

| Tool | Signal | Positioning | Gap Electronium can target |
|---|---:|---|---|
| `browser-use/browser-use` | 99,053 GitHub stars | Make websites accessible for AI agents | Automation framework, not specifically human-profile trust bridge. |
| `browserbase/stagehand` | 23,123 stars | SDK for browser agents | Strong SDK, often Browserbase/cloud-oriented. |
| `microsoft/playwright-mcp` | 33,977 stars | Playwright MCP server | Playwright-based, same bot-detection issue we hit. |
| `nanobrowser/nanobrowser` | 13,301 stars | Chrome extension for AI-powered web automation | Browser extension competitor, closer to human browser, but different UX/product shape. |
| `AIPexStudio/AIPex` | 1,213 stars | Privacy-first AI browser automation assistant | Closest product-style competitor. Need deeper review later. |
| `browserable/browserable` | 1,193 stars | Self-hostable browser automation library for AI agents | Library/infrastructure, not necessarily local human session bridge. |
| `iFurySt/open-browser-use` | 149 stars | Platform-neutral Browser Use for real Chrome automation | Similar direction, smaller project. |

## Initial verdict

Competition exists, but the pain is still real:

- Playwright login is blocked by Cloudflare/Google/Medium.
- Normal Chrome login works.
- Existing AI browser tools focus on automation, agents, or hosted browser infra.
- Electronium's wedge can be: **local human browser session + safe AI observe/control bridge + permission prompts.**

## MVP differentiation

Electronium MVP should not claim to beat browser-use or Stagehand.

It should validate this narrow claim:

> If a human can log in with normal Chrome, an AI assistant can inspect that same session through a small local bridge without using Playwright-controlled login.

## Next competition research later

- Try Nanobrowser locally.
- Review AIPex architecture and license.
- Review Browserable capabilities.
- Check whether browser-use can attach to existing local Chrome profile without triggering bot detection.
- Check whether Stagehand local mode avoids Playwright-controlled detection.
