// Runs ./workers with the @cloudflare/playwright fake (test/fixtures/fake-cloudflare-playwright.mjs).
import { register } from 'node:module';
register('./cloudflare-playwright-hook.mjs', import.meta.url);
const { launchBrowserRun, attachBrowserRunPage } = await import('../../dist/workers.js');
const { calls } = await import('@cloudflare/playwright');
const decide = async request => ({ answers: Object.fromEntries(Object.entries(request.questions).map(([name, q]) => [name, { choice: Object.entries(q.criteria).find(([, c]) => c?.kind === 'click' && c.target?.name === 'Go')?.[0] ?? '__none__', confidence: 0.95 }])), model: 'test', elapsedMs: 0 });
const out = {};
const { browser, sessionId } = await launchBrowserRun({ binding: 'BROWSER' }, { keepAlive: 60000, recording: true, contextOptions: { viewport: { width: 1440, height: 900 } }, engine: { decide } });
out.sessionId = sessionId;
out.launch = calls[0];
await browser.page.setContent('<p>start</p><button onclick="document.body.dataset.hit=1">Go</button>');
out.snapshot = (await browser.snapshot()).elements.map(e => e.name);
out.act = (await browser.act('Press Go')).status;
out.hit = await browser.page.locator('body').getAttribute('data-hit');
out.viewport = browser.page.viewportSize();
const context = browser.page.context();
await browser.close();
out.closed = !context.browser()?.isConnected();
// attachBrowserRunPage: the caller keeps its browser open.
const { chromium } = await import('playwright-core');
const own = await chromium.launch({ headless: true });
const page = await own.newPage();
await page.setContent('<button>Keep</button>');
const attached = attachBrowserRunPage(page, { engine: { decide } });
out.attached = (await attached.snapshot()).elements.map(e => e.name);
await attached.close();
out.ownOpen = own.isConnected() && !page.isClosed();
await own.close();
process.stdout.write(JSON.stringify(out));
