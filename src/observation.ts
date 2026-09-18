import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { ElementHandle, JSHandle, Page, Frame } from 'playwright';
import type { Snapshot, ElementInfo } from './types.js';
import { BrowserError } from './errors.js';
import type * as DOM from './dom.js';

let bundle: string | undefined;
const source = () => bundle ??= readFileSync(new URL('./dom.bundle.cjs', import.meta.url), 'utf8');
export function publicURL(value: string): string {
  try { const url = new URL(value); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.href; }
  catch { return '[unavailable URL]'; }
}
export interface ElementRef { frame: Frame; handle: ElementHandle<Element>; signature: string; info: ElementInfo }
export interface Captured {
  data: Snapshot;
  refs: Map<string, ElementRef>;
  rawURL: string;
  changeKeys: Record<number, string>;
  dispose(): Promise<void>;
}
export async function capture(page: Page, options: { scope?: string; recordsScope?: string; maxElements: number; maxTexts: number; selection?: {frame:Frame;roots:ElementHandle<Element>[]} }): Promise<Captured> {
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
      if(options.selection && options.selection.frame !== frame)continue;
      const {selection,...ordinaryOptions}=options;
      const frameOptions = { ...ordinaryOptions, maxElements: Math.max(0, options.maxElements - data.elements.length), maxTexts: Math.max(0, options.maxTexts - data.texts.length) };
      // Use Playwright's native CSS resolver, including open shadow roots.
      const roots = options.selection?.roots ?? (options.scope ? (await frame.locator(`css=${options.scope}`).elementHandles()) as ElementHandle<Element>[] : undefined);
      if (roots && !options.selection) owned.push(...roots);
      const recordRoots = options.recordsScope ? (await frame.locator(`css=${options.recordsScope}`).elementHandles()) as ElementHandle<Element>[] : undefined;
      if (recordRoots) owned.push(...recordRoots);
      const observe = new Function('args', `${source()}; return JevDOM.observe(${JSON.stringify(frameOptions)}, args.roots, args.recordRoots);`) as (args: { roots?: Element[]; recordRoots?: Element[] }) => ReturnType<typeof DOM.observe>;
      const result = await frame.evaluateHandle(observe, { roots, recordRoots });
      owned.push(result);
      const observed = await result.evaluate(r => ({ elements: r.elements, texts: r.texts, records: r.records, busy: r.busy, changeKey: r.changeKey, truncatedElements: r.truncatedElements, truncatedTexts: r.truncatedTexts }));
      changeKeys[frameIndex] = observed.changeKey;
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
        refs.set(id, { frame, handle: element as ElementHandle<Element>, signature: description.signature, info });
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

/** Wait locally for an owned exact option, then capture that actual node and its control. */
export async function captureComboboxChoice(page: Page, ref: ElementRef, value: string,
  limits: {maxElements:number;maxTexts:number}, operation: {signal:AbortSignal;timeoutMs:number}): Promise<Captured> {
  const ready = new Function('args', `${source()}; return !args.element.isConnected || JevDOM.matchingComboboxOptions(args.element,args.value).length > 0;`) as (args:{element:Element;value:string})=>boolean;
  try {
    const wait=await ref.frame.waitForFunction(ready,{element:ref.handle,value},{timeout:operation.timeoutMs,signal:operation.signal,polling:50});
    await wait.dispose();
  } catch {
    operation.signal.throwIfAborted();
    throw new BrowserError('NO_MATCH','No enabled exact option appeared in the bound control\'s declared popup.');
  }
  if(!await ref.handle.evaluate(el=>el.isConnected))throw new BrowserError('STALE_TARGET','The combobox was replaced while its options loaded.');
  const matching=new Function('element',`${source()}; return JevDOM.matchingComboboxOptions(element,${JSON.stringify(value)});`) as (element:Element)=>Element[];
  const result=await ref.handle.evaluateHandle(matching);
  const properties=await result.getProperties();
  const handles=[...properties.values()];
  try {
    const options=handles.map(handle=>handle.asElement()).filter((handle):handle is ElementHandle<Element>=>!!handle);
    if(options.length>1)throw new BrowserError('AMBIGUOUS_SELECTION','Multiple enabled options with the same label belong to this combobox.');
    if(!options.length)throw new BrowserError('NO_MATCH','The matching option disappeared before observation.');
    return await capture(page,{...limits,selection:{frame:ref.frame,roots:[ref.handle,options[0]!]}});
  } finally {await Promise.allSettled([result,...handles].map(handle=>handle.dispose()));}
}
