#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { captureScreenshot, clickText, clickSelector, evaluate, getPageSnapshot, listTabs, navigateTo, typeText, NetworkMonitor } from './cdp.js';
import { launchChrome } from './launcher.js';

const CDP_PORT = Number(process.env.ELECTRONIUM_CDP_PORT || 9222);
const SERVER_NAME = 'electronium-browser';
const SERVER_VERSION = '0.2.0';

// In-memory approval queue - persists for the lifetime of the MCP server process
const pendingActions = new Map();
let actionCounter = 0;

// Singleton network monitor - one persistent CDP session per MCP server process
const networkMonitor = new NetworkMonitor({ maxEvents: 500 });

const MAX_PENDING_ACTIONS = 50;
const PENDING_TTL_MS = 10 * 60 * 1000;
const BLOCKED_SCHEMES = ['javascript:', 'file:', 'data:', 'chrome:', 'devtools:', 'blob:'];
const EVAL_BLOCKED_PATTERNS = ['document.cookie', 'localstorage', 'sessionstorage', '.password', 'indexeddb'];

function cleanExpiredActions() {
    const now = Date.now();
    for (const [id, action] of pendingActions) {
        if (action.expiresAt && now > action.expiresAt) pendingActions.delete(id);
    }
}

function queueAction(type, args, reason) {
    cleanExpiredActions();
    if (pendingActions.size >= MAX_PENDING_ACTIONS) {
        return { error: 'Action queue is full (50 pending). Approve or deny existing actions first.' };
    }
    const id = newActionId();
    pendingActions.set(id, { id, type, args, reason, queuedAt: new Date().toISOString(), expiresAt: Date.now() + PENDING_TTL_MS });
    return { id };
}

function newActionId() {
    return `act_${++actionCounter}_${Date.now()}`;
}

const TOOLS = [
    // --- Observe tools (no approval required) ---
    {
        name: 'electronium_status',
        description: 'Get the active tab URL, title, and a short text preview. No approval needed.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'electronium_tabs',
        description: 'List all open browser tabs with id, title, and URL. No approval needed.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'electronium_page_snapshot',
        description: 'Get the full visible text of the active page (up to 8000 chars). No approval needed.',
        inputSchema: {
            type: 'object',
            properties: {
                max_chars: { type: 'number', description: 'Max characters to return (default 8000)' },
            },
        },
    },
    {
        name: 'electronium_screenshot',
        description: 'Capture a screenshot of the active page. No approval needed.',
        inputSchema: { type: 'object', properties: {} },
    },
    // --- Action tools (queue for human approval) ---
    {
        name: 'electronium_navigate',
        description: 'Request to navigate to a URL. Queues the action - call electronium_approve to execute.',
        inputSchema: {
            type: 'object',
            required: ['url', 'reason'],
            properties: {
                url: { type: 'string', description: 'Destination URL (https:// only)' },
                reason: { type: 'string', description: 'Why this navigation is needed' },
            },
        },
    },
    {
        name: 'electronium_click_text',
        description: 'Request to click a visible element by its text. Queues the action - call electronium_approve to execute.',
        inputSchema: {
            type: 'object',
            required: ['text', 'reason'],
            properties: {
                text: { type: 'string', description: 'Visible label text of the element to click' },
                reason: { type: 'string', description: 'Why this click is needed' },
            },
        },
    },
    {
        name: 'electronium_click_selector',
        description: 'Request to click an element by CSS selector. More precise than electronium_click_text - use when text matching hits the wrong element. Queues for human approval.',
        inputSchema: {
            type: 'object',
            required: ['selector', 'reason'],
            properties: {
                selector: { type: 'string', description: 'CSS selector for the element to click (e.g. "button[type=submit]", "#login-btn", ".modal .confirm")' },
                reason: { type: 'string', description: 'Why this click is needed' },
            },
        },
    },
    {
        name: 'electronium_evaluate',
        description: 'Run JavaScript in the active page and return the result. Use for reading DOM state, checking values, or actions that have no dedicated tool. Queues for human approval.',
        inputSchema: {
            type: 'object',
            required: ['expression', 'reason'],
            properties: {
                expression: { type: 'string', description: 'JavaScript expression to evaluate in the page context' },
                reason: { type: 'string', description: 'Why this JS needs to run' },
            },
        },
    },
    {
        name: 'electronium_type',
        description: 'Request to type text into a CSS selector. Queues the action - call electronium_approve to execute.',
        inputSchema: {
            type: 'object',
            required: ['selector', 'text', 'reason'],
            properties: {
                selector: { type: 'string', description: 'CSS selector of the target input element' },
                text: { type: 'string', description: 'Text to type' },
                reason: { type: 'string', description: 'Why this input is needed' },
            },
        },
    },
    // --- Approval queue tools ---
    {
        name: 'electronium_list_pending',
        description: 'List all actions waiting for human approval.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'electronium_approve',
        description: 'Approve and execute a queued action.',
        inputSchema: {
            type: 'object',
            required: ['action_id'],
            properties: {
                action_id: { type: 'string', description: 'action_id returned by the request tool' },
            },
        },
    },
    {
        name: 'electronium_deny',
        description: 'Deny and discard a queued action.',
        inputSchema: {
            type: 'object',
            required: ['action_id'],
            properties: {
                action_id: { type: 'string', description: 'action_id returned by the request tool' },
            },
        },
    },
    // --- Network monitoring tools ---
    {
        name: 'electronium_network_start',
        description: 'Start capturing network requests on the active tab. Call once - monitor runs until you call electronium_network_clear or restart the MCP server.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'electronium_network_events',
        description: 'Get captured network requests. Filter by resourceType (XHR, Fetch, Document, Script, Stylesheet, Image, Font, Other), HTTP method, or URL substring.',
        inputSchema: {
            type: 'object',
            properties: {
                resourceType: { type: 'string', description: 'Filter by type: XHR, Fetch, Document, Script, Stylesheet, Image, Font, Media, WebSocket, Other' },
                method: { type: 'string', description: 'Filter by HTTP method: GET, POST, PUT, DELETE, etc.' },
                urlContains: { type: 'string', description: 'Filter to URLs containing this string' },
                limit: { type: 'number', description: 'Max events to return (default 100)' },
                minimal: { type: 'boolean', description: 'If true, return only url, method, status, resourceType per event (omits headers and postData)' },
            },
        },
    },
    {
        name: 'electronium_network_response_body',
        description: 'Request the response body for a captured network request. Requires human approval before executing as response bodies may contain sensitive data. Use the requestId from electronium_network_events.',
        inputSchema: {
            type: 'object',
            required: ['request_id', 'reason'],
            properties: {
                request_id: { type: 'string', description: 'requestId from electronium_network_events' },
                reason: { type: 'string', description: 'Why this response body is needed' },
            },
        },
    },
    {
        name: 'electronium_network_clear',
        description: 'Clear the captured network event buffer. Does not stop the monitor - use electronium_network_stop to stop monitoring.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'electronium_network_stop',
        description: 'Stop the network monitor and clear its event buffer. Closes the persistent CDP session used for monitoring.',
        inputSchema: { type: 'object', properties: {} },
    },
    // --- Launch tool ---
    {
        name: 'electronium_launch',
        description: 'Launch Chrome with remote debugging enabled. Call this first if Chrome is not running.',
        inputSchema: {
            type: 'object',
            properties: {
                port: { type: 'number', description: 'CDP port to use (default 9222)' },
            },
        },
    },
];

function textContent(text) {
    return { content: [{ type: 'text', text: String(text) }] };
}

function jsonContent(obj) {
    return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
}

function errorResult(message) {
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

async function callTool(name, args) {
    const opts = { port: CDP_PORT };

    if (name === 'electronium_status') {
        const page = await getPageSnapshot(opts);
        return jsonContent({ url: page.url, title: page.title, textPreview: page.text.slice(0, 500) });
    }

    if (name === 'electronium_tabs') {
        const tabs = await listTabs(opts);
        return jsonContent(tabs.map((t) => ({ id: t.id, type: t.type, title: t.title, url: t.url })));
    }

    if (name === 'electronium_page_snapshot') {
        const maxChars = Math.min(Number(args.max_chars || 8000), 8000);
        const page = await getPageSnapshot(opts);
        return textContent(page.text.slice(0, maxChars));
    }

    if (name === 'electronium_screenshot') {
        const shot = await captureScreenshot(opts);
        return {
            content: [
                { type: 'image', data: shot.data, mimeType: 'image/png' },
                { type: 'text', text: `Screenshot captured from: ${shot.url}` },
            ],
        };
    }

    if (name === 'electronium_navigate') {
        const { url, reason } = args;
        if (!url) return errorResult('url is required');
        if (!reason) return errorResult('reason is required');
        if (BLOCKED_SCHEMES.some((s) => url.toLowerCase().startsWith(s))) {
            return errorResult(`Blocked URL scheme: ${url}`);
        }
        const queued = queueAction('navigate', { url }, reason);
        if (queued.error) return errorResult(queued.error);
        return jsonContent({ ok: true, pending: true, action_id: queued.id, message: `Navigation to "${url}" is queued. Call electronium_approve("${queued.id}") to execute or electronium_deny("${queued.id}") to cancel.` });
    }

    if (name === 'electronium_click_text') {
        const { text, reason } = args;
        if (!text) return errorResult('text is required');
        if (!reason) return errorResult('reason is required');
        const queued = queueAction('click_text', { text }, reason);
        if (queued.error) return errorResult(queued.error);
        return jsonContent({ ok: true, pending: true, action_id: queued.id, message: `Click on "${text}" is queued. Call electronium_approve("${queued.id}") to execute or electronium_deny("${queued.id}") to cancel.` });
    }

    if (name === 'electronium_click_selector') {
        const { selector, reason } = args;
        if (!selector) return errorResult('selector is required');
        if (!reason) return errorResult('reason is required');
        const queued = queueAction('click_selector', { selector }, reason);
        if (queued.error) return errorResult(queued.error);
        return jsonContent({ ok: true, pending: true, action_id: queued.id, message: `Click on selector "${selector}" is queued. Call electronium_approve("${queued.id}") to execute or electronium_deny("${queued.id}") to cancel.` });
    }

    if (name === 'electronium_evaluate') {
        const { expression, reason } = args;
        if (!expression) return errorResult('expression is required');
        if (!reason) return errorResult('reason is required');
        const blocked = EVAL_BLOCKED_PATTERNS.find((p) => expression.toLowerCase().includes(p));
        if (blocked) return errorResult(`Expression blocked: contains "${blocked}". Use electronium_page_snapshot to read page content instead.`);
        const queued = queueAction('evaluate', { expression }, reason);
        if (queued.error) return errorResult(queued.error);
        return jsonContent({ ok: true, pending: true, action_id: queued.id, message: `JS evaluate queued. Call electronium_approve("${queued.id}") to execute or electronium_deny("${queued.id}") to cancel.` });
    }

    if (name === 'electronium_type') {
        const { selector, text, reason } = args;
        if (!selector) return errorResult('selector is required');
        if (text === undefined) return errorResult('text is required');
        if (!reason) return errorResult('reason is required');
        const queued = queueAction('type', { selector, text }, reason);
        if (queued.error) return errorResult(queued.error);
        return jsonContent({ ok: true, pending: true, action_id: queued.id, message: `Type into "${selector}" is queued. Call electronium_approve("${queued.id}") to execute or electronium_deny("${queued.id}") to cancel.` });
    }

    if (name === 'electronium_list_pending') {
        const list = [...pendingActions.values()];
        if (list.length === 0) return textContent('No pending actions.');
        return jsonContent(list);
    }

    if (name === 'electronium_approve') {
        const { action_id } = args;
        const action = pendingActions.get(action_id);
        if (!action) return errorResult(`No pending action with id "${action_id}". Call electronium_list_pending to see queued actions.`);
        pendingActions.delete(action_id);
        let result;
        if (action.type === 'navigate') result = await navigateTo(action.args.url, opts);
        else if (action.type === 'click_text') result = await clickText(action.args.text, opts);
        else if (action.type === 'click_selector') result = await clickSelector(action.args.selector, opts);
        else if (action.type === 'evaluate') result = await evaluate(action.args.expression, opts);
        else if (action.type === 'type') result = await typeText(action.args.selector, action.args.text, opts);
        else if (action.type === 'network_response_body') result = await networkMonitor.getResponseBody(action.args.request_id);
        else return errorResult(`Unknown action type: ${action.type}`);
        return jsonContent({ ok: true, executed: action, result });
    }

    if (name === 'electronium_deny') {
        const { action_id } = args;
        const action = pendingActions.get(action_id);
        if (!action) return errorResult(`No pending action with id "${action_id}".`);
        pendingActions.delete(action_id);
        return jsonContent({ ok: true, denied: true, action_id, discarded: action });
    }

    if (name === 'electronium_network_start') {
        const result = await networkMonitor.start({ port: CDP_PORT });
        return jsonContent({ ok: true, monitoring: true, tabUrl: result.tabUrl, message: 'Network monitor started. Call electronium_network_events to see captured requests.' });
    }

    if (name === 'electronium_network_events') {
        if (!networkMonitor.running) {
            return textContent('Network monitor is not running. Call electronium_network_start first.');
        }
        const events = networkMonitor.getEvents({
            resourceType: args.resourceType,
            method: args.method,
            urlContains: args.urlContains,
            limit: args.limit,
        });
        if (events.length === 0) return textContent('No network events captured yet (or none match the filter).');
        if (args.minimal) {
            return jsonContent(events.map((e) => ({ requestId: e.requestId, url: e.url, method: e.method, status: e.status, resourceType: e.resourceType, initiator: e.initiator })));
        }
        return jsonContent(events);
    }

    if (name === 'electronium_network_response_body') {
        if (!networkMonitor.running) return errorResult('Network monitor is not running. Call electronium_network_start first.');
        const { request_id, reason } = args;
        if (!request_id) return errorResult('request_id is required');
        if (!reason) return errorResult('reason is required');
        const queued = queueAction('network_response_body', { request_id }, reason);
        if (queued.error) return errorResult(queued.error);
        return jsonContent({ ok: true, pending: true, action_id: queued.id, message: `Response body fetch for request "${request_id}" is queued. Call electronium_approve("${queued.id}") to execute.` });
    }

    if (name === 'electronium_network_clear') {
        networkMonitor.clear();
        return textContent('Network event buffer cleared.');
    }

    if (name === 'electronium_network_stop') {
        if (!networkMonitor.running) return textContent('Network monitor is not running.');
        networkMonitor.stop();
        return textContent('Network monitor stopped and event buffer cleared.');
    }

    if (name === 'electronium_launch') {
        const port = Number(args.port || CDP_PORT);
        try {
            await fetch(`http://127.0.0.1:${port}/json/version`);
            return jsonContent({ ok: true, alreadyRunning: true, message: `Chrome is already running on CDP port ${port}.` });
        } catch { /* not running - proceed to launch */ }
        const launched = launchChrome({ port });
        for (let i = 0; i < 20; i++) {
            try {
                await fetch(`http://127.0.0.1:${port}/json/version`);
                return jsonContent({ ok: true, launched: true, pid: launched.pid, chromePath: launched.chromePath, dataDir: launched.dataDir, port });
            } catch { /* not ready yet */ }
            await new Promise((r) => setTimeout(r, 500));
        }
        return errorResult(`Chrome launched (pid ${launched.pid}) but did not expose CDP on port ${port} within 10s. Try running electronium_status after a moment.`);
    }

    return errorResult(`Unknown tool: ${name}`);
}

async function handleMessage(message) {
    // Notifications carry no id - send no response
    if (message.id === undefined) return null;

    const { id, method, params } = message;

    if (method === 'initialize') {
        return {
            jsonrpc: '2.0', id,
            result: {
                protocolVersion: '2024-11-05',
                capabilities: { tools: {} },
                serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
            },
        };
    }

    if (method === 'tools/list') {
        return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
    }

    if (method === 'tools/call') {
        const { name, arguments: toolArgs } = params;
        try {
            const result = await callTool(name, toolArgs || {});
            return { jsonrpc: '2.0', id, result };
        } catch (err) {
            return { jsonrpc: '2.0', id, result: errorResult(err.message) };
        }
    }

    if (method === 'ping') {
        return { jsonrpc: '2.0', id, result: {} };
    }

    if (method === 'resources/list') {
        return { jsonrpc: '2.0', id, result: { resources: [] } };
    }

    if (method === 'prompts/list') {
        return { jsonrpc: '2.0', id, result: { prompts: [] } };
    }

    return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
}

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message;
    try { message = JSON.parse(trimmed); } catch { return; }
    const response = await handleMessage(message);
    if (response) process.stdout.write(JSON.stringify(response) + '\n');
});

process.stderr.write(`Electronium MCP server v${SERVER_VERSION} ready (CDP port: ${CDP_PORT})\n`);
