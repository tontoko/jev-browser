import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { ElementHandle, JSHandle, Page } from 'playwright';
import type { Snapshot, ElementInfo } from './types.js';
import { BrowserError } from './errors.js';
import type * as DOM from './dom.js';

let bundle: string | undefined;
const source = () => bundle ??= readFileSync(new URL('./dom.bundle.cjs', import.meta.url), 'utf8');
export function publicURL(value: string): string {
  try { const url = new URL(value); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.href; }
  catch { return '[unavailable URL]'; }
}
export interface ElementRef { handle: ElementHandle<Element>; signature: string; info: ElementInfo }
export interface Captured {
  data: Snapshot;
  refs: Map<string, ElementRef>;
  rawURL: string;
  changeKeys: Record<number, string>;
  dispose(): Promise<void>;
}
export async function capture(page: Page, options: { scope?: string; recordsScope?: string; maxElements: number; maxTexts: number }): Promise<Captured> {
  const refs = new Map<string, ElementRef>();
  const changeKeys: Record<number,string> = {};
  const owned: JSHandle[] = [];
  const dispose = async () => { await Promise.allSettled(owned.splice(0).map(handle => handle.dispose())); refs.clear(); };
  const rawURL = page.url();
  const data: Snapshot = {
    id: randomUUID(), url: publicURL(rawURL), title: await page.title(), elements: [], texts: [], records: [],
    truncated: false, truncatedElements: false, truncatedTexts: false,
    scroll: await page.evaluate(() => ({ y: window.scrollY, maxY: Math.max(0, document.documentElement.scrollHeight - window.innerHeight), height: window.innerHeight })),
  };
  try {
    for (const [frameIndex, frame] of page.frames().entries()) {
      const frameOptions = { ...options, maxElements: Math.max(0, options.maxElements - data.elements.length), maxTexts: Math.max(0, options.maxTexts - data.texts.length) };
      // Use Playwright's native CSS resolver, including open shadow roots.
      const roots = options.scope ? (await frame.locator(`css=${options.scope}`).elementHandles()) as ElementHandle<Element>[] : undefined;
      if (roots) owned.push(...roots);
      const recordRoots = options.recordsScope ? (await frame.locator(`css=${options.recordsScope}`).elementHandles()) as ElementHandle<Element>[] : undefined;
      if (recordRoots) owned.push(...recordRoots);
      const observe = new Function('args', `${source()}; return JevDOM.observe(${JSON.stringify(frameOptions)}, args.roots, args.recordRoots);`) as (args: { roots?: Element[]; recordRoots?: Element[] }) => ReturnType<typeof DOM.observe>;
      const result = await frame.evaluateHandle(observe, { roots, recordRoots });
      owned.push(result);
      const observed = await result.evaluate(r => ({ elements: r.elements, texts: r.texts, records: r.records, busy: r.busy, truncatedElements: r.truncatedElements, truncatedTexts: r.truncatedTexts }));
      changeKeys[frameIndex] = String(await frame.evaluate(progressChanged, undefined));
      data.busy ||= observed.busy;
      const nodes = await result.getProperty('nodes'); owned.push(nodes);
      const properties = await nodes.getProperties();
      for (const [index, handle] of properties) {
        owned.push(handle);
        const description = observed.elements[Number(index)];
        const element = handle.asElement();
        if (!element || !description) continue;
        const id = `r${data.id.replaceAll('-', '').slice(0, 12)}_e${frameIndex}_${index}`;
        const info = { ...description.info, ...(description.info.formId ? { formId: `${frameIndex}:${description.info.formId}` } : {}), id, frame: frameIndex };
        data.elements.push(info);
        refs.set(id, { handle: element as ElementHandle<Element>, signature: description.signature, info });
      }
      data.texts.push(...observed.texts.map((text, i) => ({ ...text, id: `t${frameIndex}_${i}`, frame: frameIndex })));
      data.records!.push(...observed.records.map(r => ({ id: `record${frameIndex}_${r.index}`, frame: frameIndex, context: r.context, readOnly: r.readOnly, textIds: r.texts.map(i => `t${frameIndex}_${i}`), ...(r.parent !== undefined ? { parentId: `record${frameIndex}_${r.parent}` } : {}) })));
      data.truncatedElements ||= observed.truncatedElements;
      data.truncatedTexts ||= observed.truncatedTexts;
    }
    data.truncated = data.truncatedElements || data.truncatedTexts;
    if (page.url() !== rawURL) throw new BrowserError('STALE_SNAPSHOT', 'Page navigated while it was being observed. Observe again.');
    return { data, refs, rawURL, changeKeys, dispose };
  } catch (error) { await dispose(); throw error; }
}
/** Fixed read-only browser predicate used for local progress waits, never model-authored. */
export function progressChanged(previous?: string): string | boolean {
  const roots: (Document | ShadowRoot)[] = [document], parts: unknown[] = [location.href];
  let scanned = 0;
  for (const root of roots) for (const el of root.querySelectorAll('*')) {
    if (++scanned > 6000) break;
    if (el.shadowRoot) roots.push(el.shadowRoot);
    if (!el.getClientRects().length) continue;
    if (el.matches('input,textarea,select,button,a,[role="button"],[role="combobox"],[role="option"],[role="checkbox"],[role="switch"],[contenteditable="true"]'))
      parts.push([el.tagName,el.getAttribute('name'),el.getAttribute('aria-label'),el.matches(':disabled'),el.getAttribute('aria-checked'),el instanceof HTMLSelectElement ? Array.from(el.options,o=>[o.value,o.label,o.disabled]) : (el as HTMLElement).innerText]);
    else if (el.matches('h1,h2,h3,[role="status"],[role="alert"],[aria-busy],article,tbody tr,[role="row"]'))
      parts.push([el.tagName,el.getAttribute('role'),el.getAttribute('aria-busy'),(el as HTMLElement).innerText?.slice(0,1000)]);
  }
  const key=JSON.stringify(parts);return previous===undefined?key:key!==previous;
}
export async function verifyTarget(ref: ElementRef): Promise<void> {
  let current: ReturnType<typeof DOM.describe>;
  try {
    const describe = new Function('element', `${source()}; return JevDOM.describe(element);`) as (element: Element) => ReturnType<typeof DOM.describe>;
    current = await ref.handle.evaluate(describe);
  } catch {
    throw new BrowserError('STALE_TARGET', 'The observed element is no longer available. Observe again.');
  }
  if (!current.connected || !current.visible || current.signature !== ref.signature)
    throw new BrowserError('STALE_TARGET', 'The observed target or its row identity changed. Observe again.');
}
