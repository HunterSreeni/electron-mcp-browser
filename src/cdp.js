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
    return pages.find((tab) => tab.url && !tab.url.startsWith('chrome://')) || pages[0];
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

export async function clickText(text, options = {}) {
    return withActivePage(async (session) => {
        // Find the element and get its center coordinates
        const expression = `(() => {
            const wanted = ${JSON.stringify(text)}.trim().toLowerCase();
            const candidates = [...document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"], textarea, input, [contenteditable="true"]')];
            const visible = (el) => {
                const style = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
            };
            const label = (el) => (el.innerText || el.value || el.getAttribute('aria-label') || el.title || '').trim().toLowerCase();
            const el = candidates.find((node) => visible(node) && label(node).includes(wanted));
            if (!el) return { ok: false, error: 'No visible clickable element matched text', text: ${JSON.stringify(text)} };
            const rect = el.getBoundingClientRect();
            el.scrollIntoView({ block: 'center', inline: 'center' });
            return { ok: true, matchedText: label(el), tag: el.tagName, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
        })()`;
        const found = await session.send('Runtime.evaluate', { expression, returnByValue: true });
        const info = found.result?.value;
        if (!info?.ok) return info || { ok: false, error: 'No result returned' };

        // Fire real pointer events via CDP instead of synthetic el.click()
        const { x, y } = info;
        for (const [type, button, clickCount] of [
            ['mouseMoved', 'none', 0],
            ['mousePressed', 'left', 1],
            ['mouseReleased', 'left', 1],
        ]) {
            await session.send('Input.dispatchMouseEvent', { type, x, y, button, clickCount });
        }
        return { ok: true, action: 'clickText', matchedText: info.matchedText, tag: info.tag, x, y };
    }, options);
}

export async function typeText(selector, text, options = {}) {
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
            return { ok: true, tag: el.tagName };
        })()`;
        const focusResult = await session.send('Runtime.evaluate', { expression, returnByValue: true });
        const focusVal = focusResult.result?.value;
        if (!focusVal?.ok) return focusVal || { ok: false, error: 'No result returned' };

        // Insert text via CDP which works across React, Vue, Angular, and plain DOM
        await session.send('Input.insertText', { text });
        return { ok: true, action: 'typeText', selector, tag: focusVal.tag, length: text.length };
    }, options);
}
