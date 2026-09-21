import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { ElementHandle, JSHandle, Page, Frame, Locator } from 'playwright';
import type { Snapshot, ElementInfo, SemanticEvidence, SemanticLocatorProperty } from './types.js';
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
  textRefs?: Map<string, { frame: Frame; handle: ElementHandle<Element> }>;
  rawURL: string;
  changeKeys: Record<number, string>;
  dispose(): Promise<void>;
}
export async function capture(page: Page, options: { semanticRefs?: boolean; scope?: string; recordsScope?: string; maxElements: number; maxTexts: number; selection?: {frame:Frame;roots:ElementHandle<Element>[]} }): Promise<Captured> {
  const refs = new Map<string, ElementRef>();
  const textRefs = new Map<string, { frame: Frame; handle: ElementHandle<Element> }>();
  const changeKeys: Record<number,string> = {};
  const owned: JSHandle[] = [];
  const dispose = async () => { await Promise.allSettled(owned.splice(0).map(handle => handle.dispose())); refs.clear(); textRefs.clear(); };
  const rawURL = page.url();
  const data: Snapshot = {
    id: randomUUID(), url: publicURL(rawURL), title: await page.title(), elements: [], texts: [], records: [],
    truncated: false, truncatedElements: false, truncatedTexts: false, recordInventoryComplete:true,
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
      const observed = await result.evaluate(r => ({ elements: r.elements, texts: r.texts, records: r.records, recordInventoryComplete:r.recordInventoryComplete, busy: r.busy, changeKey: r.changeKey, truncatedElements: r.truncatedElements, truncatedTexts: r.truncatedTexts }));
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
      if (options.semanticRefs) {
        const textNodes = await result.getProperty('textNodes'); owned.push(textNodes);
        const textProperties = await textNodes.getProperties();
        for (const [index, handle] of textProperties) {
          owned.push(handle);
          const element = handle.asElement();
          if (element && observed.texts[Number(index)]) textRefs.set(`t${frameIndex}_${index}`, {frame,handle:element as ElementHandle<Element>});
        }
      }
      data.texts.push(...observed.texts.map((text, i) => ({ ...text, id: `t${frameIndex}_${i}`, frame: frameIndex })));
      data.records!.push(...observed.records.map(r => ({ id: `record${frameIndex}_${r.index}`, frame: frameIndex, context: r.context, readOnly: r.readOnly, textIds: r.texts.map(i => `t${frameIndex}_${i}`), ...(r.parent !== undefined ? { parentId: `record${frameIndex}_${r.parent}` } : {}) })));
      data.recordInventoryComplete &&= observed.recordInventoryComplete;
      data.truncatedElements ||= observed.truncatedElements;
      data.truncatedTexts ||= observed.truncatedTexts;
    }
    data.truncated = data.truncatedElements || data.truncatedTexts;
    if (page.url() !== rawURL) throw new BrowserError('STALE_SNAPSHOT', 'Page navigated while it was being observed. Observe again.');
    return { data, refs, textRefs, rawURL, changeKeys, dispose };
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
      const find=new Function(`${source()}; return JevDOM.regionNodes();`) as ()=>Element[];
      const result=await frame.evaluateHandle(find);owned.push(result);
      const props=await result.getProperties();owned.push(...props.values());
      for(const handle of props.values()){
        const element=handle.asElement() as ElementHandle<Element>|null;if(!element)continue;
        if(data.length>=64)throw new BrowserError('OBSERVATION_LIMIT','More than 64 semantic regions are present. A caller scope is required.');
        const describe=new Function('element',`${source()}; return JevDOM.regionDescription(element);`) as (element:Element)=>ReturnType<typeof DOM.describe>;
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
  const check=new Function('element','option',`${source()}; const matches=JevDOM.matchingComboboxOptions(element,${JSON.stringify(option.info.name)}); return matches.length===1&&matches[0]===option;`) as (element:Element,option:Element)=>boolean;
  if(!await control.handle.evaluate(check,option.handle))throw new BrowserError('STALE_TARGET','The option no longer uniquely belongs to the observed combobox.');
}

/** Re-read the same observed source rather than a same-position replacement. */
export async function currentSemanticEvidence(page: Page, captured: Captured, evidence: SemanticEvidence, scope?:string): Promise<SemanticEvidence | undefined> {
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
    const read = new Function('element','attribute', `${source()}; return JevDOM.readSemanticText(element,attribute);`) as (element:Element,attribute?:string)=>ReturnType<typeof DOM.readSemanticText>;
    const value = await ref.handle.evaluate(read,evidence.attribute);
    return value ? {sourceId:evidence.sourceId,frame:evidence.frame,...value} : undefined;
  } catch { return; }
}

export interface LocatorEvidence { evidence: SemanticEvidence; frame: Frame; frameURL: string; rawURL: string }
export async function readLocatorEvidence(page:Page,locator:Locator,property:SemanticLocatorProperty,attribute:string|undefined,sourceId:string,
  options:{scope?:string;signal:AbortSignal;timeoutMs:number;current?:boolean}):Promise<LocatorEvidence> {
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
    if(options.scope)roots.push(...await frame.locator(`css=${options.scope}`).elementHandles() as ElementHandle<Element>[]);
    const read=new Function('element','args',`${source()}; return JevDOM.readLocatorValue(element,args);`) as (element:Element,args:{property:string;attribute?:string;roots?:Element[]})=>ReturnType<typeof DOM.readLocatorValue>;
    const value=await handle.evaluate(read,{property,attribute,...(options.scope?{roots}:{})});
    options.signal.throwIfAborted();
    if(value.error)throw new BrowserError(value.error,value.error==='INVALID_ARGUMENT'?'The Locator does not support the requested property.':'No visible semantic evidence is available within the caller scope.');
    const {error:_error,...evidence}=value;
    if(page.url()!==rawURL||frame.url()!==frameURL)throw new BrowserError('STALE_TARGET','The semantic Locator document changed during observation.');
    return {evidence:{sourceId,frame:page.frames().indexOf(frame),...evidence} as SemanticEvidence,frame,frameURL,rawURL};
  }finally{await Promise.allSettled([...(handle?[handle]:[]),...roots].map(node=>node.dispose()));}
}

export async function semanticWithinScope(ref:{frame:Frame;handle:ElementHandle<Element>},scope?:string):Promise<boolean> {
  if(!scope)return true;
  const roots=await ref.frame.locator(`css=${scope}`).elementHandles() as ElementHandle<Element>[];
  try{
    const check=new Function('element','roots',`${source()}; return element.isConnected && JevDOM.withinSemanticRoots(element,roots);`) as (element:Element,roots:Element[])=>boolean;
    return await ref.handle.evaluate(check,roots);
  }finally{await Promise.allSettled(roots.map(root=>root.dispose()));}
}
