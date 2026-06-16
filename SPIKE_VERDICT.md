# Spike Verdict - Electronium MVP

Date: 2026-06-16

## Question

Can we avoid Playwright-controlled login by using normal Chrome with a human profile and a local CDP bridge for AI inspection?

## What was built

Path:

`/home/huntersreeni/Documents/Sreeniverse/electronium-browser`

MVP features:

- Node.js CLI and local HTTP API.
- Connects to normal Chrome through Chrome DevTools Protocol.
- Reads active tab URL, title, and body text.
- Captures screenshot.
- Serves local endpoints:
  - `/health`
  - `/tabs`
  - `/page`
  - `/screenshot`

## Commands verified

```bash
npm run check
npm run status
npm run screenshot -- /tmp/electronium-medium.png
npm start
curl http://127.0.0.1:17373/health
curl http://127.0.0.1:17373/page
```

## Evidence

Syntax check passed.

Local API health returned:

```json
{
  "ok": true,
  "name": "electronium-browser",
  "mode": "observe-first",
  "cdpPort": 9222
}
```

Page endpoint successfully read Medium page text from Chrome:

```text
Welcome back.
Sign in with Google
Sign in with Facebook
Sign in with Apple
Sign in with X
Sign in with email
```

Screenshot saved:

`/tmp/electronium-medium.png`

## Verdict: VALIDATED

### What worked

- Normal Chrome can be launched with a DevTools port from the agent side using `DISPLAY=:0`.
- Electronium can attach to Chrome and inspect the current Medium tab.
- Local HTTP API works and can expose page state to AI tools.
- Screenshot capture works.
- After the human manually logged in through the remote-debug Chrome window, Electronium successfully read the logged-in Medium profile page.

### Evidence after human login

`/page` returned:

```text
URL: https://medium.com/@sreenivasan96
TITLE: Sreenivasan Sivakumar – Medium
TEXT PREVIEW: Sidebar menu, Write, Notifications, Home, Library, Profile, Stories, Stats...
```

Screenshot saved:

`/tmp/electronium-medium-logged-in.png`

### What remains

- Persistent auth between different Chrome launch modes needs more testing.
- Click/type/submit should require human approval and are not implemented yet.
- A proper Electron shell or tray app can wrap the current CDP bridge later.

### Recommendation

Proceed to v0.2: add a permissioned action queue for click/type/navigation, still human-approved by default. Keep the product wedge: real local Chrome session, AI observe/control bridge, user in the trust loop.
