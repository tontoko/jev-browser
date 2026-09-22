import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { ElementHandle, Locator, Route } from 'playwright';
import { expect } from 'playwright/test';
import { BrowserError } from './errors.js';
import { publicURL } from './observation.js';
import { BrowserEvents } from './browser-events.js';
import type { ParsedNativeCommand } from './native-schemas.js';
import type { OperationContext } from './types.js';
export class NativeBrowser extends BrowserEvents {
  async executeResolved(c: ParsedNativeCommand, target: Locator | ElementHandle<Element>, op: OperationContext): Promise<Record<string, unknown>> {
    const time = { timeout: op.timeoutMs, signal: op.signal }; op.signal.throwIfAborted();
    return this.action(async () => {
      switch (c.command) {
        case 'click': await target.click({ ...time, button: c.button, clickCount: c.doubleClick ? 2 : 1, modifiers: c.modifiers }); break;
        case 'hover': await target.hover(time); break;
        case 'type': if (c.slowly) { await target.fill('',time); await target.type(c.text,{...time,delay:30}); } else await target.fill(c.text,time); if(c.submit)await target.press('Enter',time); break;
        case 'press_key': await target.press(c.key,time); break;
        case 'check': await target.setChecked(c.checked,time); break;
        case 'select_option': await target.selectOption(c.indices ? c.indices.map(index=>({index})) : c.by==='label' ? c.values!.map(label=>({label})) : c.values!,time); break;
        default: throw new BrowserError('INVALID_ARGUMENT','This command is not an element primitive.');
      }
    });
  }
  async execute(c: ParsedNativeCommand, op: OperationContext): Promise<Record<string, unknown>> {
    const page = this.host.page(), time = { timeout: op.timeoutMs, signal: op.signal };
    op.signal.throwIfAborted();
    switch (c.command) {
      case 'navigate': { const url = await this.host.validateURL(c.url); await page.goto(url, { ...time, waitUntil: 'domcontentloaded' }); return { url: publicURL(page.url()) }; }
      case 'navigate_back': await page.goBack({ ...time, waitUntil: 'domcontentloaded' }); return { url: publicURL(page.url()) };
      case 'navigate_forward': await page.goForward({ ...time, waitUntil: 'domcontentloaded' }); return { url: publicURL(page.url()) };
      case 'reload': await page.reload({ ...time, waitUntil: 'domcontentloaded' }); return { url: publicURL(page.url()) };
      case 'click': case 'hover': case 'type': case 'check': case 'select_option':
        return this.executeResolved(c,await this.target(c),op);
      case 'press_key': return c.target || c.ref ? this.executeResolved(c,await this.target(c),op) : this.action(()=>page.keyboard.press(c.key));
      case 'fill_form': {
        // Resolve all targets first. A missing/expired reference must not partially fill the form.
        const fields = await Promise.all(c.fields.map(async field => {
          const target = await this.target(field);
          if ('count' in target && await target.count() !== 1) throw new BrowserError('INVALID_ARGUMENT', 'Every form field must resolve to exactly one observed element before filling.');
          return { field, target };
        }));
        return this.action(async () => {
          for (const { field } of fields) {
            op.signal.throwIfAborted();
            // Each earlier field may invalidate a later captured reference.
            const target = await this.target(field);
            if (field.type === 'checkbox' || field.type === 'radio') { if (typeof field.value !== 'boolean') throw new BrowserError('INVALID_ARGUMENT', 'Checkbox/radio values must be boolean.'); await target.setChecked(field.value, time); }
            else if (field.type === 'combobox') { if (typeof field.value === 'boolean') throw new BrowserError('INVALID_ARGUMENT', 'Combobox values must be strings.'); await target.selectOption(field.value, time); }
            else { if (typeof field.value !== 'string') throw new BrowserError('INVALID_ARGUMENT', 'Text values must be strings.'); await target.fill(field.value, time); }
          }
        });
      }
      case 'drag': {
        const a = await this.host.resolve(c.startTarget ?? c.startRef!, c.frame), b = await this.host.resolve(c.endTarget ?? c.endRef!, c.frame);
        return this.action(async () => { await a.hover(time); await page.mouse.down(); try { await b.hover(time); } finally { await page.mouse.up(); } });
      }
      case 'wait_for': {
        if (c.time !== undefined) await delay(c.time * 1000, undefined, { signal: op.signal });
        if (c.text !== undefined) await page.getByText(c.text, { exact: false }).first().waitFor({ ...time, state: 'visible' });
        if (c.textGone !== undefined) await page.getByText(c.textGone, { exact: false }).first().waitFor({ ...time, state: 'hidden' });
        if (c.target !== undefined) await page.locator(c.target).waitFor({ ...time, state: c.state ?? 'visible' });
        return { status: 'complete', reason: 'verified' };
      }
      case 'tabs': {
        const pages = this.context.pages();
        if (c.action === 'new') { const url = c.url ? await this.host.validateURL(c.url) : undefined; const created = await this.context.newPage(); await this.host.select(created); if (url) await created.goto(url, { ...time, waitUntil: 'domcontentloaded' }); }
        if (c.action === 'select') { const selected = pages[c.index!]; if (!selected) throw new BrowserError('INVALID_ARGUMENT', 'Tab index is not present.'); await this.host.select(selected); }
        if (c.action === 'close') { const selected = c.index === undefined ? page : pages[c.index]; if (!selected) throw new BrowserError('INVALID_ARGUMENT', 'Tab index is not present.'); if (selected === page) { const replacement = pages.find(p => p !== selected) ?? await this.context.newPage(); await this.host.select(replacement); } await selected.close(); }
        return { tabs: await Promise.all(this.context.pages().map(async (p, index) => ({ index, selected: p === this.host.page(), url: publicURL(p.url()), title: await p.title() }))) };
      }
      case 'frames': return { frames: await Promise.all(page.frames().map(async (f, index) => ({ index, name: f.name(), url: publicURL(f.url()), title: await f.title() }))) };
      case 'handle_dialog': return this.handleDialog(c.accept, c.promptText);
      case 'file_upload': {
        const paths = await Promise.all(c.paths.map(p => this.files.input(p)));
        if (c.target || c.ref) await (await this.target(c)).setInputFiles(paths, time);
        else { const chooser=this.takeChooser(); await chooser.setFiles(paths, time); }
        return { status: 'executed', count: paths.length };
      }
      case 'downloads': {
        const downloads=this.downloads.filter(download=>download.page()===page);
        if (c.action === 'list') return { downloads: downloads.map((d, index) => ({ index, filename: d.suggestedFilename(), url: publicURL(d.url()) })) };
        const d = downloads[c.index!]; if (!d) throw new BrowserError('INVALID_ARGUMENT', 'Download index is not present.');
        if (c.action === 'cancel') { await d.cancel(); return { status: 'cancelled' }; }
        // Never trust a server-provided suggested filename as a path.
        const path = await this.files.outputPath(c.filename ?? `${randomUUID()}.download`); await d.saveAs(path); return { path };
      }
      case 'take_screenshot': {
        const target = c.target || c.ref ? await this.target(c) : page;
        const data = await target.screenshot({ ...time, type: c.type, ...(target === page ? { fullPage: c.fullPage } : {}) });
        const path = c.filename ? await this.files.write(data, c.filename, c.type) : undefined;
        return { mimeType: c.type === 'jpeg' ? 'image/jpeg' : 'image/png', data: data.toString('base64'), ...(path ? { path } : {}) };
      }
      case 'pdf': { const data = await page.pdf({ format: c.format, printBackground: c.printBackground }); return { path: await this.files.write(data, c.filename, 'pdf') }; }
      case 'resize': await page.setViewportSize({ width: c.width, height: c.height }); return { width: c.width, height: c.height };
      case 'console_messages': { const levels = c.level === 'error' ? ['error'] : c.level === 'warning' ? ['error', 'warning', 'warn'] : undefined; const messages = this.messages.filter(m => !levels || levels.includes(m.type)); if (c.clear) this.messages.length = 0; return { messages }; }
      case 'network_requests': { const requests = [...this.requests]; if (c.clear) this.requests.length = 0; return { requests }; }
      case 'evaluate': {
        if (!this.options.allowEvaluate) throw new BrowserError('CAPABILITY_DISABLED', 'Page evaluation requires allowEvaluate / --allow-evaluate.');
        if (c.target || c.ref) throw new BrowserError('INVALID_ARGUMENT', 'Evaluation accepts a page function. Use a selector inside that function, or the SDK Page for element callbacks.');
        // This expression is evaluated by Playwright in the page, never as Node code.
        const value = await page.evaluate(`(${c.function})(${JSON.stringify(c.arg ?? null)})`);
        return { value: value ?? null };
      }
      case 'init_script': {
        if (!this.options.allowEvaluate) throw new BrowserError('CAPABILITY_DISABLED', 'Init scripts require allowEvaluate / --allow-evaluate.');
        await this.context.addInitScript({ content: c.script }); return { status: 'installed' };
      }
      case 'storage': {
        const value = await page.evaluate(({ area, action, name, value }) => {
          const storage = area === 'local' ? localStorage : sessionStorage;
          if (action === 'get') return storage.getItem(name!);
          if (action === 'set') storage.setItem(name!, value!);
          if (action === 'delete') storage.removeItem(name!);
          if (action === 'clear') storage.clear();
          if (action === 'list') return Object.fromEntries(Array.from({ length: storage.length }, (_, i) => { const key = storage.key(i)!; return [key, storage.getItem(key)]; }));
          return null;
        }, c);
        return { value };
      }
      case 'cookies': {
        if (c.action === 'add') await this.context.addCookies(c.cookies!);
        if (c.action === 'clear') await this.context.clearCookies();
        return c.action === 'list' ? { cookies: await this.context.cookies(c.urls) } : { status: 'executed' };
      }
      case 'storage_state': return { path: await this.files.write(JSON.stringify(await this.context.storageState()), c.filename, 'json') };
      case 'trace': {
        if (c.action === 'start') { await this.context.tracing.start({ screenshots: true, snapshots: true, sources: false }); this.traceStarted = true; return { status: 'recording' }; }
        if (!this.traceStarted) throw new BrowserError('NO_TRACE', 'This session did not start a trace.');
        const path = await this.files.outputPath(c.filename ?? `${randomUUID()}.zip`); await this.context.tracing.stop({ path }); this.traceStarted = false; return { path };
      }
      case 'route': {
        const previous = this.routes.get(c.pattern); if (previous) { await this.context.unroute(c.pattern, previous); this.routes.delete(c.pattern); }
        if (c.action !== 'remove') { const handler = async (r: Route) => { if (c.action === 'abort') await r.abort(); else await r.fulfill({ status: c.status ?? 200, contentType: c.contentType, body: c.body ?? '' }); }; await this.context.route(c.pattern, handler); this.routes.set(c.pattern, handler); }
        return { status: c.action === 'remove' ? 'removed' : 'installed' };
      }
      case 'mouse': {
        if (c.action === 'move') await page.mouse.move(c.x!, c.y!);
        if (c.action === 'click') return this.action(() => page.mouse.click(c.x!, c.y!, { button: c.button }));
        if (c.action === 'down') await page.mouse.down({ button: c.button });
        if (c.action === 'up') await page.mouse.up({ button: c.button });
        if (c.action === 'wheel') await page.mouse.wheel(c.deltaX ?? 0, c.deltaY ?? 0);
        return { status: 'executed' };
      }
      case 'assert': {
        const t = c.target || c.ref ? await this.target(c) : undefined;
        const actual = async () => {
          op.signal.throwIfAborted();
          switch (c.property) {
            case 'url': return page.url(); case 'title': return page.title();
            case 'visible': return t!.isVisible(); case 'hidden': return !(await t!.isVisible());
            case 'enabled': return t!.isEnabled(); case 'checked': return t!.isChecked();
            case 'text': return t!.textContent(); case 'value': return t!.inputValue();
            case 'count': return 'count' in t! ? (t as Locator).count() : (await (t as ElementHandle<Element>).evaluate(e => e.isConnected)) ? 1 : 0;
          }
        };
        try { await expect.poll(actual, { timeout: Math.min(op.timeoutMs, 5000) }).toEqual(c.expected ?? true); }
        catch { op.signal.throwIfAborted(); throw new BrowserError('ASSERTION_FAILED', `Native ${c.property} assertion did not match the expected value.`); }
        return { status: 'complete', reason: 'verified' };
      }
    }
  }
}
