import { withActivePage } from '../src/cdp.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const result = await withActivePage(async (session) => {
    await session.send('Runtime.evaluate', { expression: 'window.scrollTo(0, 0)' });
    await sleep(800);
    for (let i = 0; i < 8; i++) {
        await session.send('Runtime.evaluate', { expression: 'window.scrollBy(0, Math.floor(window.innerHeight * 0.85))' });
        await sleep(700);
    }
    await session.send('Runtime.evaluate', { expression: 'window.scrollTo(0, 0)' });
    await sleep(500);

    const extracted = await session.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `JSON.stringify((() => {
            const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
            const url = location.href;
            const title = document.title;
            const text = document.body ? document.body.innerText : '';
            const links = [...document.querySelectorAll('a[href]')].map((a) => ({
                text: clean(a.innerText || a.getAttribute('aria-label') || ''),
                href: new URL(a.getAttribute('href'), location.href).href,
            })).filter((x) => x.text || x.href).slice(0, 250);
            const mediumPostLinks = links.filter((x) => x.href.includes('medium.com/@sreenivasan96/') || x.href.includes('medium.com/p/'));
            const headings = [...document.querySelectorAll('h1,h2,h3')].map((h) => clean(h.innerText)).filter(Boolean);
            return { url, title, text: text.slice(0, 30000), links, mediumPostLinks, headings };
        })())`
    });
    return JSON.parse(extracted.result.value);
});

console.log(JSON.stringify(result, null, 2));
process.exit(0);
