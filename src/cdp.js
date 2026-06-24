const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 9222;

const BLOCKED_SCHEMES = ['javascript:', 'file:', 'data:', 'chrome:', 'devtools:', 'blob:'];

export async function jsonGet(urlPath, { host = DEFAULT_HOST, port = DEFAULT_PORT } = {}) {
    const url = `http://${host}:${port}${urlPath}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
    return response.json();
}

export async function listTabs(options = {}) {
    return jsonGet('/json', options);
}

export async function getActiveTab(options = {}) {
    const tabs = await listTabs(options);
    const pages = tabs.filter((tab) => tab.type === 'page' && tab.webSocketDebuggerUrl);
    if (pages.length === 0) throw new Error('No debuggable Chrome page found. Is Chrome running with --remote-debugging-port=9222?');
    return pages.find((tab) => tab.url?.startsWith('https://') || tab.url?.startsWith('http://'))
        || pages.find((tab) => tab.url && !tab.url.startsWith('chrome://'))
        || pages[0];
}

export class CdpSession {
    constructor(webSocketUrl) {
        this.webSocketUrl = webSocketUrl;
        this.nextId = 1;
        this.pending = new Map();
        this.eventHandlers = new Map();
        this.socket = null;
    }

    async connect() {
        this.socket = new WebSocket(this.webSocketUrl);
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timed out connecting to Chrome DevTools WebSocket')), 10000);
            this.socket.addEventListener('open', () => {
                clearTimeout(timeout);
                resolve();
            }, { once: true });
            this.socket.addEventListener('error', (event) => {
                clearTimeout(timeout);
                reject(new Error(`Chrome DevTools WebSocket error: ${event.message || 'unknown error'}`));
            }, { once: true });
        });

        this.socket.addEventListener('message', (event) => {
            let message;
            try { message = JSON.parse(event.data); } catch { return; }

            if (message.id !== undefined) {
                const pending = this.pending.get(message.id);
                if (!pending) return;
                this.pending.delete(message.id);
                if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
                else pending.resolve(message.result);
            } else if (message.method) {
                const handlers = this.eventHandlers.get(message.method);
                if (handlers) [...handlers].forEach((fn) => fn(message.params));
            }
        });
    }

    send(method, params = {}) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return Promise.reject(new Error('CDP socket is not connected'));
        }
        const id = this.nextId++;
        this.socket.send(JSON.stringify({ id, method, params }));
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            setTimeout(() => {
                if (this.pending.has(id)) {
                    this.pending.delete(id);
                    reject(new Error(`CDP command timed out: ${method}`));
                }
            }, 15000);
        });
    }

    on(method, callback) {
        if (!this.eventHandlers.has(method)) this.eventHandlers.set(method, []);
        this.eventHandlers.get(method).push(callback);
    }

    once(method, callback) {
        const wrapper = (params) => {
            this.off(method, wrapper);
            callback(params);
        };
        if (!this.eventHandlers.has(method)) this.eventHandlers.set(method, []);
        this.eventHandlers.get(method).push(wrapper);
    }

    off(method, callback) {
        const handlers = this.eventHandlers.get(method);
        if (!handlers) return;
        const idx = handlers.indexOf(callback);
        if (idx !== -1) handlers.splice(idx, 1);
    }

    close() {
        for (const { reject } of this.pending.values()) {
            reject(new Error('CDP session closed'));
        }
        this.pending.clear();
        if (this.socket) this.socket.close();
    }
}

export async function withActivePage(callback, options = {}) {
    const tab = await getActiveTab(options);
    const session = new CdpSession(tab.webSocketDebuggerUrl);
    await session.connect();
    try {
        await session.send('Runtime.enable');
        await session.send('Page.enable');
        return await callback(session, tab);
    } finally {
        session.close();
    }
}

export async function getPageSnapshot(options = {}) {
    return withActivePage(async (session, tab) => {
        const title = await session.send('Runtime.evaluate', {
            expression: 'document.title',
            returnByValue: true,
        });
        const bodyText = await session.send('Runtime.evaluate', {
            expression: 'document.body ? document.body.innerText.slice(0, 8000) : ""',
            returnByValue: true,
        });
        return {
            id: tab.id,
            url: tab.url,
            title: title.result?.value || tab.title || '',
            text: bodyText.result?.value || '',
        };
    }, options);
}

export async function captureScreenshot(options = {}) {
    return withActivePage(async (session, tab) => {
        const result = await session.send('Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: false,
        });
        return {
            id: tab.id,
            url: tab.url,
            data: result.data,
        };
    }, options);
}

export async function navigateTo(url, options = {}) {
    if (BLOCKED_SCHEMES.some((s) => url.toLowerCase().startsWith(s))) {
        throw new Error(`Blocked URL scheme: ${url}`);
    }
    return withActivePage(async (session) => {
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Page load timed out after 30s')), 30000);
            session.once('Page.loadEventFired', () => { clearTimeout(timer); resolve(); });
            session.send('Page.navigate', { url }).catch((err) => { clearTimeout(timer); reject(err); });
        });
        return { ok: true, action: 'navigate', url };
    }, options);
}

async function fireClick(session, x, y) {
    for (const [type, button, clickCount] of [
        ['mouseMoved', 'none', 0],
        ['mousePressed', 'left', 1],
        ['mouseReleased', 'left', 1],
    ]) {
        await session.send('Input.dispatchMouseEvent', { type, x, y, button, clickCount });
    }
}

export async function clickText(text, options = {}) {
    return withActivePage(async (session) => {
        const expression = `(() => {
            const wanted = ${JSON.stringify(text)}.trim().toLowerCase();
            const candidates = [...document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"], textarea, input, [contenteditable="true"]')];
            const visible = (el) => {
                const style = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
            };
            const label = (el) => (el.innerText || el.value || el.getAttribute('aria-label') || el.title || '').trim().toLowerCase();
            const visibles = candidates.filter((node) => visible(node));
            // Prefer exact match first, fall back to substring - avoids "Login" hitting "Login with Microsoft"
            const el = visibles.find((n) => label(n) === wanted) || visibles.find((n) => label(n).includes(wanted));
            if (!el) return { ok: false, error: 'No visible clickable element matched text', text: ${JSON.stringify(text)} };
            el.scrollIntoView({ block: 'center', inline: 'center' });
            const rect = el.getBoundingClientRect();
            return { ok: true, matchedText: label(el), tag: el.tagName, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
        })()`;
        const found = await session.send('Runtime.evaluate', { expression, returnByValue: true });
        const info = found.result?.value;
        if (!info?.ok) return info || { ok: false, error: 'No result returned' };
        await fireClick(session, info.x, info.y);
        return { ok: true, action: 'clickText', matchedText: info.matchedText, tag: info.tag, x: info.x, y: info.y };
    }, options);
}

export async function clickSelector(selector, options = {}) {
    return withActivePage(async (session) => {
        const expression = `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return { ok: false, error: 'Selector not found', selector: ${JSON.stringify(selector)} };
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            if (style.visibility === 'hidden' || style.display === 'none' || rect.width === 0 || rect.height === 0) {
                return { ok: false, error: 'Element found but not visible', selector: ${JSON.stringify(selector)} };
            }
            el.scrollIntoView({ block: 'center', inline: 'center' });
            const r2 = el.getBoundingClientRect();
            const label = (el.innerText || el.value || el.getAttribute('aria-label') || el.title || '').trim().slice(0, 80);
            return { ok: true, label, tag: el.tagName, x: Math.round(r2.left + r2.width / 2), y: Math.round(r2.top + r2.height / 2) };
        })()`;
        const found = await session.send('Runtime.evaluate', { expression, returnByValue: true });
        const info = found.result?.value;
        if (!info?.ok) return info || { ok: false, error: 'No result returned' };
        await fireClick(session, info.x, info.y);
        return { ok: true, action: 'clickSelector', selector, label: info.label, tag: info.tag, x: info.x, y: info.y };
    }, options);
}

export async function evaluate(expression, options = {}) {
    return withActivePage(async (session) => {
        const result = await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) {
            return { ok: false, error: result.exceptionDetails.text || 'JS exception', details: result.exceptionDetails };
        }
        return { ok: true, value: result.result?.value };
    }, options);
}

export async function maximizeWindow(options = {}) {
    const { host = DEFAULT_HOST, port = DEFAULT_PORT } = options;

    // Primary: CDP Browser.setWindowBounds - works on Windows, Linux, and macOS
    try {
        const version = await jsonGet('/json/version', { host, port });
        const browserWsUrl = version.webSocketDebuggerUrl;
        if (!browserWsUrl) throw new Error('No browser WebSocket URL in /json/version');
        const tab = await getActiveTab({ host, port });
        const session = new CdpSession(browserWsUrl);
        await session.connect();
        try {
            const { windowId } = await session.send('Browser.getWindowForTarget', { targetId: tab.id });
            await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } });
            return;
        } finally {
            session.close();
        }
    } catch { /* fall through to OS-level fallback */ }

    // macOS fallback: --start-maximized is ignored on macOS; use osascript instead.
    // Gets screen dimensions from Finder then sets the Chrome window bounds to fill the display.
    if (process.platform === 'darwin') {
        try {
            const { execSync } = await import('node:child_process');
            const raw = execSync(
                `osascript -e 'tell application "Finder" to get bounds of window of desktop'`,
                { stdio: ['ignore', 'pipe', 'ignore'] }
            ).toString().trim();
            const [x, y, w, h] = raw.split(',').map((s) => Number(s.trim()));
            const setCmd = (app) =>
                `osascript -e 'tell application "${app}" to set bounds of front window to {${x}, ${y}, ${w}, ${h}}'`;
            for (const app of ['Google Chrome', 'Chromium', 'Microsoft Edge']) {
                try { execSync(setCmd(app), { stdio: 'ignore' }); return; } catch { /* try next */ }
            }
        } catch { /* osascript unavailable */ }
        return;
    }

    // Linux fallback: wmctrl maximizes the active window on X11 desktops.
    // wmctrl is not installed by default - silent fail if missing.
    if (process.platform === 'linux') {
        try {
            const { execSync } = await import('node:child_process');
            execSync('wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz', { stdio: 'ignore' });
        } catch { /* wmctrl not installed */ }
    }
}

export async function typeText(selector, text, options = {}) {
    const { slowType = false, ...cdpOptions } = options;
    return withActivePage(async (session) => {
        // Focus element and clear it using the native value setter to bypass React/Vue property interception
        const expression = `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return { ok: false, error: 'Selector not found', selector: ${JSON.stringify(selector)} };
            el.scrollIntoView({ block: 'center', inline: 'center' });
            el.focus();
            if ('value' in el) {
                const nativeSetter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value')?.set
                    || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
                if (nativeSetter) nativeSetter.call(el, '');
                else el.value = '';
                el.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
                el.textContent = '';
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }
            return { ok: true, tag: el.tagName, isContentEditable: el.isContentEditable };
        })()`;
        const focusResult = await session.send('Runtime.evaluate', { expression, returnByValue: true });
        const focusVal = focusResult.result?.value;
        if (!focusVal?.ok) return focusVal || { ok: false, error: 'No result returned' };

        if (slowType) {
            // Character-by-character keystroke simulation - fires keydown/char/keyup per character.
            // Required for ProseMirror-based editors (Medium, Notion, Google Docs) that build
            // internal document state from the full keystroke sequence, not just the input event.
            for (const char of text) {
                await session.send('Input.dispatchKeyEvent', { type: 'keyDown', text: char, key: char, unmodifiedText: char });
                await session.send('Input.dispatchKeyEvent', { type: 'char',    text: char, key: char, unmodifiedText: char });
                await session.send('Input.dispatchKeyEvent', { type: 'keyUp',   text: char, key: char, unmodifiedText: char });
            }
        } else {
            // Bulk insert - single Input.insertText fires one input event.
            // Works for React, Vue, Angular and plain DOM inputs.
            await session.send('Input.insertText', { text });
        }

        return { ok: true, action: 'typeText', selector, tag: focusVal.tag, length: text.length, slowType };
    }, cdpOptions);
}

export class NetworkMonitor {
    constructor({ maxEvents = 500, cdpOptions = {} } = {}) {
        this.maxEvents = maxEvents;
        this.cdpOptions = cdpOptions;
        this.session = null;
        this.events = [];       // indexed by insertion order
        this.byRequestId = new Map();  // requestId -> event (for response merging)
        this.running = false;
        this.tabUrl = null;
    }

    async start(options = {}) {
        if (this.running) this.stop();
        const opts = { ...this.cdpOptions, ...options };
        const tab = await getActiveTab(opts);
        this.session = new CdpSession(tab.webSocketDebuggerUrl);
        await this.session.connect();
        await this.session.send('Network.enable');

        this.session.on('Network.requestWillBeSent', (p) => {
            const ev = {
                requestId: p.requestId,
                url: p.request.url,
                method: p.request.method,
                resourceType: p.type || 'Other',
                initiator: p.initiator?.type || 'other',
                requestHeaders: p.request.headers,
                postData: p.request.postData || null,
                timestamp: p.timestamp,
                status: null,
                statusText: null,
                responseHeaders: null,
                mimeType: null,
            };
            this.byRequestId.set(p.requestId, ev);
            this.events.push(ev);
            if (this.events.length > this.maxEvents) {
                const removed = this.events.shift();
                this.byRequestId.delete(removed.requestId);
            }
        });

        this.session.on('Network.responseReceived', (p) => {
            const ev = this.byRequestId.get(p.requestId);
            if (!ev) return;
            ev.status = p.response.status;
            ev.statusText = p.response.statusText;
            ev.responseHeaders = p.response.headers;
            ev.mimeType = p.response.mimeType;
        });

        this.running = true;
        this.tabUrl = tab.url;
        return { ok: true, tabUrl: tab.url };
    }

    async getResponseBody(requestId) {
        if (!this.session) throw new Error('Network monitor is not running');
        try {
            const result = await this.session.send('Network.getResponseBody', { requestId });
            return { ok: true, body: result.body, base64Encoded: result.base64Encoded };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    getEvents({ resourceType, method, urlContains, limit = 100 } = {}) {
        let results = [...this.events];
        if (resourceType) results = results.filter((e) => e.resourceType.toLowerCase() === resourceType.toLowerCase());
        if (method) results = results.filter((e) => e.method.toLowerCase() === method.toLowerCase());
        if (urlContains) results = results.filter((e) => e.url.includes(urlContains));
        return results.slice(-limit);
    }

    clear() {
        this.events = [];
        this.byRequestId = new Map();
    }

    stop() {
        if (this.session) this.session.close();
        this.session = null;
        this.running = false;
        this.events = [];
        this.byRequestId = new Map();
    }
}
