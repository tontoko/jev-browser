import { readFileSync } from 'node:fs';
import { domSource } from './dom-source.js';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { ElementHandle, JSHandle, Page, Frame, Locator } from 'playwright-core';
import type { Snapshot, ElementInfo, SemanticEvidence, SemanticLocatorProperty } from './types.js';
import { BrowserError, browserError, type BrowserErrorCode } from './errors.js';
import type * as DOM from './dom.js';

let bundle: string | undefined;
/**
 * A page function built from source text, with the arguments of the Function constructor (params..., body) but without compiling it here:
 * Playwright sends `String(fn)` to the page, so only the page evaluates the text. Cloudflare Workers forbid `new Function`.
 */
function pageFunction(...parts: string[]): (...args: any[]) => any {
  const body = parts.pop() ?? '', text = `function (${parts.join(', ')}) {\n${body}\n}`;
  const fn = () => { throw new Error('A page function only runs in the page.'); };
  Object.defineProperty(fn, 'toString', { value: () => text });
  return fn;
}
const source = () => bundle ??= domSource ?? readFileSync(new URL('./dom.bundle.cjs', import.meta.url), 'utf8');
export function publicURL(value: string): string {
  try { const url = new URL(value); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.href; }
  catch { return '[unavailable URL]'; }
}
export interface ElementRef { frame: Frame; handle: ElementHandle<Element>; signature: string; info: ElementInfo }
/** One observed frame: its document URL at capture time and, for a scoped capture, the roots that bounded it (owned by the capture). */
export interface CapturedFrame { frame: Frame; rawURL: string; roots?: ElementHandle<Element>[] }
export interface Captured {
  /** The Page this observation belongs to. */
  page: Page;
  /** Frames that were actually observed, by frame index. */
  frames: Map<number, CapturedFrame>;
  /** For an owned popup choice: the run observation and control it was opened from, which must still hold as well. */
  anchor?: { capture: Captured; ref: { frame: Frame; handle: ElementHandle<Element> } };
  /** A fresh capture of the same Page, frames and roots with the same options; the caller disposes it. */
  reread(): Promise<Captured>;
  data: Snapshot;
  refs: Map<string, ElementRef>;
  textRefs?: Map<string, { frame: Frame; handle: ElementHandle<Element>; kind: DOM.SemanticTextKind }>;
  rawURL: string;
  changeKeys: Record<number, string>;
  dispose(): Promise<void>;
}
/** A resolved caller ref used as an observation root. The handle is owned by the caller and stays valid for the operation. */
export interface ScopeRoot { frame: Frame; handle: ElementHandle<Element> }
/** A CSS selector evaluated in every frame, or one current element in its own frame. */
export type Scope = string | ScopeRoot;
/** Fresh handles for the scope roots in one frame; the caller disposes them. */
export async function scopeHandles(frame: Frame, scope: Scope): Promise<ElementHandle<Element>[]> {
  if (typeof scope === 'string') return await frame.locator(`css=${scope}`).elementHandles() as ElementHandle<Element>[];
  if (scope.frame !== frame) return [];
  return [await scope.handle.evaluateHandle(element => element) as ElementHandle<Element>];
}
interface CaptureOptions { signal?: AbortSignal; deadline?: number; semanticRefs?: boolean; scope?: Scope; requireScope?: boolean; recordsScope?: string; exclude?: string[]; maxElements: number; maxTexts: number; selection?: {frame:Frame;roots:ElementHandle<Element>[]} }
// Playwright reports these when a frame is removed, or its document replaced, during an evaluation.
const detachedFrame = /Frame (?:was|has been) detached/;
const replacedDocument = (error: unknown) => error instanceof BrowserError ? error.code === 'STALE_SNAPSHOT' : error instanceof Error && /Execution context was destroyed/.test(error.message);
/** Observation is read-only, so a capture interrupted by navigation is retaken a bounded number of times. */
export async function capture(page: Page, options: CaptureOptions): Promise<Captured> {
  for (let attempt = 1; ; attempt++) {
    try { return await captureOnce(page, options); }
    catch (error) {
      // Selected roots belong to the replaced document, so only a whole-page capture can be retaken.
      if (options.selection || !replacedDocument(error)) throw error;
      // Retries spend the caller's operation budget; they never extend it.
      options.signal?.throwIfAborted();
      const wait = Math.min(2_000, Math.floor((options.deadline ?? Infinity) - performance.now()));
      if (attempt >= 3 || wait <= 0) throw new BrowserError('STALE_SNAPSHOT', 'Page kept navigating while it was being observed. Observe again.', { retryable: true });
      await page.waitForLoadState('domcontentloaded', { timeout: wait, ...(options.signal ? { signal: options.signal } : {}) }).catch(() => undefined);
      options.signal?.throwIfAborted();
    }
  }
}
async function captureOnce(page: Page, options: CaptureOptions): Promise<Captured> {
  const refs = new Map<string, ElementRef>();
  const textRefs = new Map<string, { frame: Frame; handle: ElementHandle<Element>; kind: DOM.SemanticTextKind }>();
  const changeKeys: Record<number,string> = {};
  const frames = new Map<number, CapturedFrame>();
  const owned: JSHandle[] = [];
  const dispose = async () => { await Promise.allSettled(owned.splice(0).map(handle => handle.dispose())); refs.clear(); textRefs.clear(); frames.clear(); };
  const rawURL = page.url();
  const data: Snapshot = {
    id: randomUUID(), url: publicURL(rawURL), title: await page.title(), elements: [], texts: [], records: [],
    truncated: false, truncatedElements: false, truncatedTexts: false, recordInventoryComplete:true,
    scroll: await page.evaluate(() => ({ y: window.scrollY, maxY: Math.max(0, document.documentElement.scrollHeight - window.innerHeight), height: window.innerHeight })),
  };
  let scopeFound = false;
  // Selection roots belong to the caller and may be released before this capture is; keep our own handles to the same elements.
  let selection = options.selection;
  try {
    if (selection) {
      const roots: ElementHandle<Element>[] = [];
      for (const root of selection.roots) { const own = await root.evaluateHandle(element => element) as ElementHandle<Element>; owned.push(own); roots.push(own); }
      selection = { frame: selection.frame, roots };
    }
    // Read a frame completely before recording it, so a frame removed mid-read leaves no partial evidence.
    const observeFrame = async (frameIndex: number, frame: Frame) => {
      const hrefCount = data.texts.filter(text => text.attribute === 'href').length;
      const frameOptions = { maxElements: Math.max(0, options.maxElements - data.elements.length), maxTexts: Math.max(0, options.maxTexts - (data.texts.length - hrefCount)), maxHrefs: Math.max(0, options.maxTexts - hrefCount) };
      // Use Playwright's native CSS resolver, including open shadow roots.
      const roots = selection?.roots ?? (options.scope ? await scopeHandles(frame, options.scope) : undefined);
      if (roots && !selection) owned.push(...roots);
      const frameURL = frame.url();
      const recordRoots = options.recordsScope ? (await frame.locator(`css=${options.recordsScope}`).elementHandles()) as ElementHandle<Element>[] : undefined;
      if (recordRoots) owned.push(...recordRoots);
      const excluded = options.exclude?.length ? (await Promise.all(options.exclude.map(selector => frame.locator(`css=${selector}`).elementHandles()))).flat() as ElementHandle<Element>[] : undefined;
      if (excluded) owned.push(...excluded);
      const observe = pageFunction('args', `${source()}; return JevDOM.observe(${JSON.stringify(frameOptions)}, args.roots, args.recordRoots, args.excluded);`) as (args: { roots?: Element[]; recordRoots?: Element[]; excluded?: Element[] }) => ReturnType<typeof DOM.observe>;
      const result = await frame.evaluateHandle(observe, { roots, recordRoots, excluded });
      owned.push(result);
      const observed = await result.evaluate(r => ({ elements: r.elements, texts: r.texts, textKinds:r.textKinds, records: r.records, recordInventoryComplete:r.recordInventoryComplete, busy: r.busy, changeKey: r.changeKey, truncatedElements: r.truncatedElements, truncatedTexts: r.truncatedTexts }));
      const nodes = await result.getProperty('nodes'); owned.push(nodes);
      const properties = await nodes.getProperties();
      const textNodes = options.semanticRefs ? await result.getProperty('textNodes') : undefined;
      if (textNodes) owned.push(textNodes);
      const textProperties = textNodes ? await textNodes.getProperties() : new Map<string, JSHandle>();
      scopeFound ||= !!roots?.length;
      changeKeys[frameIndex] = observed.changeKey;
      // A frame where the scope matched nothing yet is watched whole, so the scope appearing there still counts as progress.
      frames.set(frameIndex, { frame, rawURL: frameURL, ...(roots?.length ? { roots } : {}) });
      data.busy ||= observed.busy;
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
      for (const [index, handle] of textProperties) {
        owned.push(handle);
        const element = handle.asElement();
        if (element && observed.texts[Number(index)]) textRefs.set(`t${frameIndex}_${index}`, {frame,handle:element as ElementHandle<Element>,kind:observed.textKinds[Number(index)]!});
      }
      data.texts.push(...observed.texts.map((text, i) => ({ ...text, id: `t${frameIndex}_${i}`, frame: frameIndex })));
      data.records!.push(...observed.records.map(r => ({ id: `record${frameIndex}_${r.index}`, frame: frameIndex, context: r.context, readOnly: r.readOnly, textIds: r.texts.map(i => `t${frameIndex}_${i}`), ...(r.parent !== undefined ? { parentId: `record${frameIndex}_${r.parent}` } : {}) })));
      data.recordInventoryComplete &&= observed.recordInventoryComplete;
      data.truncatedElements ||= observed.truncatedElements;
      data.truncatedTexts ||= observed.truncatedTexts;
    };
    for (const [frameIndex, frame] of page.frames().entries()) {
      // Page evaluation has no Playwright timeout; stop between frames once the operation ended.
      options.signal?.throwIfAborted();
      if(selection && selection.frame !== frame)continue;
      await observeFrame(frameIndex, frame).catch((error: unknown) => {
        // A child frame removed during capture is no longer part of the page; observe the rest.
        if (!selection && frame !== page.mainFrame() && (frame.isDetached() || error instanceof Error && detachedFrame.test(error.message))) return;
        throw error;
      });
    }
    data.truncated = data.truncatedElements || data.truncatedTexts;
    options.signal?.throwIfAborted();
    if (page.url() !== rawURL) throw new BrowserError('STALE_SNAPSHOT', 'Page navigated while it was being observed. Observe again.', { retryable: true });
    if (options.requireScope && options.scope && !scopeFound) throw new BrowserError('SCOPE_NOT_FOUND', 'The observation scope matched no element. Check the selector, or wait for that region to appear.');
    const retained = selection;
    return { page, frames, data, refs, textRefs, rawURL, changeKeys, dispose,
      reread: () => capture(page, { ...options, ...(retained ? { selection: retained } : {}), requireScope: false }) };
  } catch (error) { await dispose(); throw error; }
}
/** An explicit caller scope that matches nothing in any frame is an error, never an empty observation. */
export async function assertScope(page: Page, scope: Scope | undefined): Promise<void> {
  // A ref scope was verified as current when it was resolved.
  if (!scope || typeof scope !== 'string') return;
  for (const frame of page.frames()) if (await frame.locator(`css=${scope}`).count()) return;
  throw new BrowserError('SCOPE_NOT_FOUND', 'The observation scope matched no element. Check the selector, or wait for that region to appear.');
}
/** Invalid scope syntax fails as INVALID_SELECTOR up front. Other failures (such as a navigation) are left to the observation that follows. */
export async function validateScopeSyntax(page: Page, scope: string | undefined): Promise<void> {
  if (!scope) return;
  try { await page.mainFrame().locator(`css=${scope}`).count(); }
  catch (error) { const mapped = browserError(error); if (mapped.code === 'INVALID_SELECTOR') throw mapped; }
}
/** Execute the shipped shared observation predicate, never caller/model-generated code. */
export async function waitForFrameProgress(frame: Frame, baseline: string, timeoutMs: number, signal: AbortSignal, roots?: ElementHandle<Element>[]): Promise<void> {
  const changed = pageFunction('args', `${source()}; return JevDOM.progressChanged(args.previous, args.roots);`) as (args: { previous: string; roots?: Element[] }) => boolean;
  const handle = await frame.waitForFunction(changed,{ previous: baseline, roots },{polling:Math.min(100,Math.max(1,Math.floor(timeoutMs/4))),timeout:timeoutMs,signal});
  await handle.dispose();
}

export async function verifyTarget(ref: ElementRef, signal?: AbortSignal): Promise<void> {
  let current: ReturnType<typeof DOM.describe>;
  try {
    const describe = pageFunction('element', `${source()}; return JevDOM.describe(element);`) as (element: Element) => ReturnType<typeof DOM.describe>;
    current = await ref.handle.evaluate(describe);
  } catch (error) {
    signal?.throwIfAborted();
    throw new BrowserError('STALE_TARGET', 'The observed element is no longer available. Observe again.', { cause: error });
  }
  if (!current.connected || !current.visible || current.signature !== ref.signature)
    throw new BrowserError('STALE_TARGET', 'The observed target or its row identity changed. Observe again.');
}

/** A captured target still belongs to the observation that authorized it: same Page and document, same frame document, and inside the captured scope roots. */
export async function withinCapturedScope(page: Page, captured: Captured, ref: { frame: Frame; handle: ElementHandle<Element> }): Promise<boolean> {
  if (page !== captured.page || page.isClosed() || page.url() !== captured.rawURL || ref.frame.isDetached() || !page.frames().includes(ref.frame)) return false;
  if (captured.anchor && !await withinCapturedScope(page, captured.anchor.capture, captured.anchor.ref)) return false;
  const boundary = [...captured.frames.values()].find(entry => entry.frame === ref.frame);
  if (!boundary || ref.frame.url() !== boundary.rawURL) return false;
  if (!boundary.roots) return true;
  const inside = pageFunction('element', 'roots', `${source()}; return element.isConnected && roots.every(root => root.isConnected) && JevDOM.withinSemanticRoots(element, roots);`) as (element: Element, roots: Element[]) => boolean;
  return ref.handle.evaluate(inside, boundary.roots).catch(() => false);
}
/** Re-check observed-target authority after an await: Page, document, frame, scope and element identity. */
export async function verifyCapturedTarget(page: Page, captured: Captured, ref: ElementRef, signal?: AbortSignal): Promise<void> {
  if (!await withinCapturedScope(page, captured, ref)) {
    signal?.throwIfAborted();
    throw new BrowserError('STALE_TARGET', 'The observed target left its page, document or observation scope. Observe again.');
  }
  await verifyTarget(ref, signal);
}
/** The facts a readback judgment used: the result record with its sources, and page-level headings/status/alerts. */
function readbackFacts(snapshot: Snapshot, recordId: string) {
  const strip = ({ id: _id, ...text }: Snapshot['texts'][number]) => text;
  const record = snapshot.records?.find(entry => entry.id === recordId);
  const ids = new Set(record?.textIds);
  return {
    record: record ? { frame: record.frame, context: record.context, readOnly: record.readOnly, sources: snapshot.texts.filter(text => ids.has(text.id)).map(strip) } : undefined,
    page: snapshot.texts.filter(text => ['heading', 'status', 'alert'].includes(text.role)).map(strip),
  };
}
/** Re-read the Page before a readback judgment is adopted: the same result record and page status must still be shown. */
export async function readbackIsCurrent(page: Page, captured: Captured, recordId: string): Promise<boolean> {
  const before = readbackFacts(captured.data, recordId);
  if (!before.record || page !== captured.page || page.isClosed() || page.url() !== captured.rawURL) return false;
  let fresh: Captured | undefined;
  try {
    fresh = await captured.reread();
    if (fresh.data.truncatedTexts || page.url() !== captured.rawURL) return false;
    const current = fresh.data;
    if (!isDeepStrictEqual(before.page, readbackFacts(current, '').page)) return false;
    return (current.records ?? []).some(record => isDeepStrictEqual(before.record, readbackFacts(current, record.id).record));
  } catch { return false; }
  finally { await fresh?.dispose(); }
}

/** Wait locally for an owned exact option, then capture that actual node and its control. */
export async function captureComboboxChoice(page: Page, ref: ElementRef, value: string,
  limits: {maxElements:number;maxTexts:number}, operation: {signal:AbortSignal;timeoutMs:number}, anchor?: Captured): Promise<Captured> {
  const ready = pageFunction('args', `${source()}; return !args.element.isConnected || JevDOM.matchingComboboxOptions(args.element,args.value).length > 0;`) as (args:{element:Element;value:string})=>boolean;
  const args={element:ref.handle,value};let appeared=false;
  try {
    const wait=await ref.frame.waitForFunction(ready,args,{timeout:operation.timeoutMs,signal:operation.signal,polling:Math.min(50,Math.max(1,Math.floor(operation.timeoutMs/4)))});
    await wait.dispose();appeared=true;
  } catch {
    operation.signal.throwIfAborted();
  }
  // Judge the deadline on the page as it is when the budget expires, not on how many polls fit into it:
  // a slow runner must not report NO_MATCH for options that were already shown.
  if(!appeared)appeared=await ref.frame.evaluate(ready,args).catch(()=>false);
  if(!appeared)throw new BrowserError('NO_MATCH','No enabled exact option appeared in the bound control\'s declared popup.');
  if(!await ref.handle.evaluate(el=>el.isConnected))throw new BrowserError('STALE_TARGET','The combobox was replaced while its options loaded.');
  const matching=pageFunction('element',`${source()}; return JevDOM.matchingComboboxOptions(element,${JSON.stringify(value)});`) as (element:Element)=>Element[];
  const result=await ref.handle.evaluateHandle(matching);
  const properties=await result.getProperties();
  const handles=[...properties.values()];
  try {
    const options=handles.map(handle=>handle.asElement()).filter((handle):handle is ElementHandle<Element>=>!!handle);
    if(options.length>1)throw new BrowserError('AMBIGUOUS_SELECTION','Multiple enabled options with the same label belong to this combobox.');
    if(!options.length)throw new BrowserError('NO_MATCH','The matching option disappeared before observation.');
    const choice=await capture(page,{...limits,selection:{frame:ref.frame,roots:[ref.handle,options[0]!]}});
    // Approving the option also requires the control to remain where the run observed it.
    if(anchor)choice.anchor={capture:anchor,ref:{frame:ref.frame,handle:ref.handle}};
    return choice;
  } finally {await Promise.allSettled([result,...handles].map(handle=>handle.dispose()));}
}

export interface RegionIndex {
  data:{id:string;role:string;name:string;context:string;frame:number}[];
  refs:Map<string,ElementRef>;
  dispose():Promise<void>;
}
export async function captureRegions(page:Page):Promise<RegionIndex>{
  const owned:JSHandle[]=[],refs=new Map<string,ElementRef>(),data:RegionIndex['data']=[];
  const dispose=async()=>{await Promise.allSettled(owned.splice(0).map(handle=>handle.dispose()));refs.clear();};
  try{
    for(const [frameIndex,frame]of page.frames().entries()){
      const find=pageFunction(`${source()}; return JevDOM.regionNodes();`) as ()=>Element[];
      const result=await frame.evaluateHandle(find);owned.push(result);
      const props=await result.getProperties();owned.push(...props.values());
      for(const handle of props.values()){
        const element=handle.asElement() as ElementHandle<Element>|null;if(!element)continue;
        if(data.length>=64)throw new BrowserError('OBSERVATION_LIMIT','More than 64 semantic regions are present. A caller scope is required.');
        const describe=pageFunction('element',`${source()}; return JevDOM.regionDescription(element);`) as (element:Element)=>ReturnType<typeof DOM.describe>;
        const described=await element.evaluate(describe),id=`region_${frameIndex}_${data.length}`;
        const info={...described.info,id,frame:frameIndex};refs.set(id,{frame,handle:element,info,signature:described.signature});
        data.push({id,role:info.role,name:info.name,context:info.context,frame:frameIndex});
      }
    }
    return {data,refs,dispose};
  }catch(error){await dispose();throw error;}
}
export async function verifyOwnedOption(control:ElementRef,option:ElementRef):Promise<void>{
  await verifyTarget(control);
  if(control.frame!==option.frame)throw new BrowserError('STALE_TARGET','Option and its owner belong to different frames.');
  const check=pageFunction('element','option',`${source()}; const matches=JevDOM.matchingComboboxOptions(element,${JSON.stringify(option.info.name)}); return matches.length===1&&matches[0]===option;`) as (element:Element,option:Element)=>boolean;
  if(!await control.handle.evaluate(check,option.handle))throw new BrowserError('STALE_TARGET','The option no longer uniquely belongs to the observed combobox.');
}

/** Re-read the same observed source rather than a same-position replacement. */
export async function currentSemanticEvidence(page: Page, captured: Captured, evidence: SemanticEvidence, scope?:Scope): Promise<SemanticEvidence | undefined> {
  if (page.url() !== captured.rawURL) return;
  const element = captured.refs.get(evidence.sourceId);
  const text = captured.textRefs?.get(evidence.sourceId);
  const ref = element ?? text;
  if (!ref || page.frames()[evidence.frame] !== ref.frame) return;
  try {
    if(!await semanticWithinScope(ref,scope))return;
    if (element) {
      await verifyTarget(element);
      return {...evidence};
    }
    if(!text)return;
    const read = pageFunction('element','kind', `${source()}; return JevDOM.readSemanticText(element,kind);`) as (element:Element,kind:DOM.SemanticTextKind)=>ReturnType<typeof DOM.readSemanticText>;
    const value = await ref.handle.evaluate(read,text.kind);
    return value ? {sourceId:evidence.sourceId,frame:evidence.frame,...value} : undefined;
  } catch { return; }
}

export interface LocatorEvidence { evidence: SemanticEvidence; frame: Frame; frameURL: string; rawURL: string }
export async function readLocatorEvidence(page:Page,locator:Locator,property:SemanticLocatorProperty,attribute:string|undefined,sourceId:string,
  options:{scope?:Scope;signal:AbortSignal;timeoutMs:number;current?:boolean}):Promise<LocatorEvidence> {
  options.signal.throwIfAborted();
  if(!locator || typeof locator.page!=='function' || typeof locator.elementHandle!=='function' || locator.page()!==page)
    throw new BrowserError('INVALID_ARGUMENT','The semantic Locator must belong to this Page.');
  if(!['text','value','checked','attribute'].includes(property)||property==='attribute'&&(!attribute||!attribute.trim()))
    throw new BrowserError('INVALID_ARGUMENT','Choose text, value, checked, or an explicitly named attribute.');
  const rawURL=page.url();
  if(!options.current && await locator.count()===0)await locator.waitFor({state:'attached',timeout:options.timeoutMs,signal:options.signal});
  const count=await locator.count();
  if(count!==1)throw new BrowserError(count?'SEMANTIC_AMBIGUOUS':'SEMANTIC_NO_MATCH','A semantic Locator must resolve to exactly one observed element.');
  const handle=await locator.elementHandle({timeout:options.timeoutMs});
  const roots:ElementHandle<Element>[]=[];
  try{
    if(!handle)throw new BrowserError('SEMANTIC_NO_MATCH','The semantic Locator target is absent.');
    const frame=await handle.ownerFrame();
    if(!frame||page.url()!==rawURL)throw new BrowserError('STALE_TARGET','The semantic Locator page changed during observation.');
    const frameURL=frame.url();
    if(options.scope)roots.push(...await scopeHandles(frame,options.scope));
    const read=pageFunction('element','args',`${source()}; return JevDOM.readLocatorValue(element,args);`) as (element:Element,args:{property:string;attribute?:string;roots?:Element[]})=>ReturnType<typeof DOM.readLocatorValue>;
    const value=await handle.evaluate(read,{property,attribute,...(options.scope?{roots}:{})});
    options.signal.throwIfAborted();
    if(value.error)throw new BrowserError(value.error as BrowserErrorCode,value.error==='INVALID_ARGUMENT'?'The Locator does not support the requested property.':'No visible semantic evidence is available within the caller scope.');
    const {error:_error,...evidence}=value;
    if(page.url()!==rawURL||frame.url()!==frameURL)throw new BrowserError('STALE_TARGET','The semantic Locator document changed during observation.');
    return {evidence:{sourceId,frame:page.frames().indexOf(frame),...evidence} as SemanticEvidence,frame,frameURL,rawURL};
  }finally{await Promise.allSettled([...(handle?[handle]:[]),...roots].map(node=>node.dispose()));}
}

export async function semanticWithinScope(ref:{frame:Frame;handle:ElementHandle<Element>},scope?:Scope):Promise<boolean> {
  if(!scope)return true;
  const roots=await scopeHandles(ref.frame,scope);
  try{
    const check=pageFunction('element','roots',`${source()}; return element.isConnected && JevDOM.withinSemanticRoots(element,roots);`) as (element:Element,roots:Element[])=>boolean;
    return await ref.handle.evaluate(check,roots);
  }finally{await Promise.allSettled(roots.map(root=>root.dispose()));}
}
