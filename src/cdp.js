const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 9222;

export async function jsonGet(path, { host = DEFAULT_HOST, port = DEFAULT_PORT } = {}) {
    const url = `http://${host}:${port}${path}`;
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
            const message = JSON.parse(event.data);
            if (!message.id) return;
            const pending = this.pending.get(message.id);
            if (!pending) return;
            this.pending.delete(message.id);
            if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
            else pending.resolve(message.result);
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

    close() {
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
    return withActivePage(async (session) => {
        await session.send('Page.navigate', { url });
        return { ok: true, action: 'navigate', url };
    }, options);
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
            const el = candidates.find((node) => visible(node) && label(node).includes(wanted));
            if (!el) return { ok: false, error: 'No visible clickable element matched text', text: ${JSON.stringify(text)} };
            const rect = el.getBoundingClientRect();
            el.scrollIntoView({ block: 'center', inline: 'center' });
            el.click();
            return { ok: true, action: 'clickText', matchedText: label(el), tag: el.tagName, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
        })()`;
        const result = await session.send('Runtime.evaluate', { expression, returnByValue: true });
        return result.result?.value || { ok: false, error: 'No result returned' };
    }, options);
}

export async function typeText(selector, text, options = {}) {
    return withActivePage(async (session) => {
        const expression = `(() => {
            const selector = ${JSON.stringify(selector)};
            const text = ${JSON.stringify(text)};
            const el = document.querySelector(selector);
            if (!el) return { ok: false, error: 'Selector not found', selector };
            el.scrollIntoView({ block: 'center', inline: 'center' });
            el.focus();
            if ('value' in el) {
                el.value = text;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
                el.textContent = text;
                el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
            }
            return { ok: true, action: 'typeText', selector, tag: el.tagName, length: text.length };
        })()`;
        const result = await session.send('Runtime.evaluate', { expression, returnByValue: true });
        return result.result?.value || { ok: false, error: 'No result returned' };
    }, options);
}
