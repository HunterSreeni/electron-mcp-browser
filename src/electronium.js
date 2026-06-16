#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { captureScreenshot, clickText, getPageSnapshot, listTabs, navigateTo, typeText } from './cdp.js';

const HOST = process.env.ELECTRONIUM_HOST || '127.0.0.1';
const PORT = Number(process.env.ELECTRONIUM_PORT || 17373);
const CDP_PORT = Number(process.env.ELECTRONIUM_CDP_PORT || 9222);

function sendJson(res, status, payload) {
    const body = JSON.stringify(payload, null, 2);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'access-control-allow-origin': 'http://127.0.0.1',
    });
    res.end(body);
}

async function handle(req, res) {
    try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        if (url.pathname === '/health') {
            sendJson(res, 200, { ok: true, name: 'electronium-browser', mode: 'observe-first', cdpPort: CDP_PORT });
            return;
        }
        if (url.pathname === '/tabs') {
            const tabs = await listTabs({ port: CDP_PORT });
            sendJson(res, 200, tabs.map((tab) => ({ id: tab.id, type: tab.type, title: tab.title, url: tab.url })));
            return;
        }
        if (url.pathname === '/page') {
            const page = await getPageSnapshot({ port: CDP_PORT });
            sendJson(res, 200, page);
            return;
        }
        if (url.pathname === '/screenshot') {
            const shot = await captureScreenshot({ port: CDP_PORT });
            const out = url.searchParams.get('out');
            if (out) {
                const outPath = path.resolve(out);
                await fs.mkdir(path.dirname(outPath), { recursive: true });
                await fs.writeFile(outPath, Buffer.from(shot.data, 'base64'));
                sendJson(res, 200, { ok: true, url: shot.url, path: outPath });
            } else {
                sendJson(res, 200, shot);
            }
            return;
        }
        sendJson(res, 404, { ok: false, error: 'Not found', endpoints: ['/health', '/tabs', '/page', '/screenshot?out=/tmp/page.png'] });
    } catch (error) {
        sendJson(res, 500, { ok: false, error: error.message });
    }
}

async function main() {
    const command = process.argv[2] || 'help';
    if (command === 'serve') {
        const server = http.createServer((req, res) => void handle(req, res));
        server.listen(PORT, HOST, () => {
            console.log(`Electronium bridge listening at http://${HOST}:${PORT}`);
            console.log(`Expecting Chrome DevTools at http://127.0.0.1:${CDP_PORT}`);
        });
        return true;
    }
    if (command === 'status') {
        const page = await getPageSnapshot({ port: CDP_PORT });
        console.log(JSON.stringify({ url: page.url, title: page.title, textPreview: page.text.slice(0, 500) }, null, 2));
        return;
    }
    if (command === 'tabs') {
        const tabs = await listTabs({ port: CDP_PORT });
        console.log(JSON.stringify(tabs.map((tab) => ({ id: tab.id, type: tab.type, title: tab.title, url: tab.url })), null, 2));
        return;
    }
    if (command === 'screenshot') {
        const out = process.argv[3] || '/tmp/electronium-screenshot.png';
        const shot = await captureScreenshot({ port: CDP_PORT });
        await fs.writeFile(out, Buffer.from(shot.data, 'base64'));
        console.log(JSON.stringify({ ok: true, url: shot.url, path: out }, null, 2));
        return;
    }
    if (command === 'navigate') {
        const url = process.argv[3];
        if (!url) throw new Error('Usage: node src/electronium.js navigate <url>');
        console.log(JSON.stringify(await navigateTo(url, { port: CDP_PORT }), null, 2));
        return;
    }
    if (command === 'click-text') {
        const text = process.argv.slice(3).join(' ');
        if (!text) throw new Error('Usage: node src/electronium.js click-text <visible text>');
        console.log(JSON.stringify(await clickText(text, { port: CDP_PORT }), null, 2));
        return;
    }
    if (command === 'type') {
        const selector = process.argv[3];
        const text = process.argv.slice(4).join(' ');
        if (!selector || !text) throw new Error('Usage: node src/electronium.js type <css-selector> <text>');
        console.log(JSON.stringify(await typeText(selector, text, { port: CDP_PORT }), null, 2));
        return;
    }
    console.log(`Electronium Browser MVP

Usage:
  node src/electronium.js serve
  node src/electronium.js status
  node src/electronium.js tabs
  node src/electronium.js screenshot /tmp/page.png
  node src/electronium.js navigate https://example.com
  node src/electronium.js click-text "Write"
  node src/electronium.js type "textarea" "Draft text"

Before using, launch normal Chrome:
  google-chrome --remote-debugging-port=9222 --user-data-dir=/home/huntersreeni/.hermes/medium-human-chrome https://medium.com/me
`);
}

main().then((keepAlive) => {
    if (!keepAlive) process.exit(0);
}).catch((error) => {
    console.error(error.message);
    process.exit(1);
});
