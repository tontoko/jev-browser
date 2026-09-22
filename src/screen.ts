import { randomUUID } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { Page } from 'playwright';
import { z } from 'zod';
import { BrowserError } from './errors.js';
import { FileAccess } from './paths.js';
import type { OperationContext } from './types.js';

const capture = z.object({ frames: z.number().int().min(1).max(10), intervalMs: z.number().int().min(20).max(1000) }).strict().optional();
const observed = { observationId: z.string().min(1), capture };
const point = { x: z.number().finite(), y: z.number().finite() };
const navigationKeys = ['Enter','Tab','Escape','Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown','Space'] as const;
const editKeys = [
  ...navigationKeys, 'Shift+Tab',
  ...['Shift','Control','Meta','ControlOrMeta','Control+Shift','Meta+Shift','ControlOrMeta+Shift'].flatMap(modifier =>
    ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].map(key => modifier+'+'+key)),
  ...['Control','Meta','ControlOrMeta'].flatMap(modifier => ['a','A','z','Z','y','Y','Shift+z','Shift+Z'].map(key => modifier+'+'+key)),
];
const key = z.enum(editKeys);
/** Pixels and physical inputs only; no selectors, DOM descriptions, arbitrary URL or JavaScript. */
export const screenSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('look'), capture }).strict(),
  z.object({ action: z.literal('click'), ...observed, ...point }).strict(),
  z.object({ action: z.literal('move'), ...observed, ...point }).strict(),
  z.object({ action: z.literal('drag'), ...observed, ...point, toX: z.number().finite(), toY: z.number().finite() }).strict(),
  z.object({ action: z.literal('scroll'), ...observed, deltaX: z.number().finite(), deltaY: z.number().finite(), x: z.number().finite().optional(), y: z.number().finite().optional() }).strict(),
  z.object({ action: z.literal('type'), ...observed, text: z.string().max(20000) }).strict(),
  z.object({ action: z.literal('press'), ...observed, key }).strict(),
  z.object({ action: z.literal('back'), ...observed }).strict(),
  z.object({ action: z.literal('forward'), ...observed }).strict(),
  z.object({ action: z.literal('reload'), ...observed }).strict(),
  z.object({ action: z.literal('wait'), ...observed, milliseconds: z.number().int().min(0).max(10000) }).strict(),
]);
export type ScreenRequest = z.infer<typeof screenSchema>;
export interface ScreenFrame { data: string; mimeType: 'image/png'; capturedAt: string; elapsedMs: number; path?: string }
export interface ScreenResult {
  observationId: string;
  viewport: { width: number; height: number };
  frames: ScreenFrame[];
  action: { id: string; kind: ScreenRequest['action']; startedAt: string; durationMs: number; outcome: 'observed' | 'executed' | 'denied' | 'failed' | 'unknown' };
}
type ViewportGeometry = { width: number; height: number; scale: number; offsetX: number; offsetY: number; scrollX: number; scrollY: number };
type Observation = { id: string; page: Page; generation: number; viewport: ScreenResult['viewport']; configured: ReturnType<Page['viewportSize']>; geometry: ViewportGeometry };
type Tracking = { page: Page; generation: number; popup?: Page; fileChooser?: boolean; detach: () => void };
type EvidenceAction = Omit<ScreenResult['action'],'kind'> & { kind: string };
const actions = new Set(screenSchema.options.map(option => option.shape.action.value));
const dimensionsEqual = (a: ReturnType<Page['viewportSize']>, b: ReturnType<Page['viewportSize']>) =>
  a === null || b === null ? a === b : a.width === b.width && a.height === b.height;
const imageSize = (png: Buffer) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });
const sameGeometry = (a: ViewportGeometry, b: ViewportGeometry) =>
  (Object.keys(a) as (keyof ViewportGeometry)[]).every(key => a[key] === b[key]);
async function viewportGeometry(page: Page, op: OperationContext): Promise<ViewportGeometry> {
  // The first predicate evaluation returns only viewport numbers. A primitive handle avoids a
  // second unbounded page evaluation during jsonValue; the native wait honors cancellation.
  const value = await page.waitForFunction(() => {
    const viewport = window.visualViewport;
    return JSON.stringify({ width: viewport?.width ?? innerWidth, height: viewport?.height ?? innerHeight,
      scale: viewport?.scale ?? 1, offsetX: viewport?.offsetLeft ?? 0, offsetY: viewport?.offsetTop ?? 0,
      scrollX: window.scrollX, scrollY: window.scrollY });
  }, undefined, { timeout: op.timeoutMs, signal: op.signal });
  try {
    const geometry = JSON.parse(await value.jsonValue()) as ViewportGeometry;
    if (!geometry || !(['width','height','scale','offsetX','offsetY','scrollX','scrollY'] as const).every(key => Number.isFinite(geometry[key])) ||
      geometry.width <= 0 || geometry.height <= 0 || geometry.scale <= 0)
      throw new BrowserError('SCREEN_VIEWPORT_UNSUPPORTED', 'The browser viewport geometry could not be established.');
    return geometry;
  } finally { await value.dispose(); }
}

/** Owned by one JevBrowser and called under its existing operation/Page lease. */
export class ScreenController {
  private observation?: Observation;
  private tracking?: Tracking;
  private readonly files?: FileAccess;
  private journal?: Promise<string>;
  constructor(private readonly page: () => Page, outputDir?: string) {
    if (outputDir) this.files = new FileAccess([], outputDir);
  }
  private track(page: Page): Tracking {
    if (this.tracking?.page === page) return this.tracking;
    this.tracking?.detach();
    const tracking: Tracking = { page, generation: 0, detach: () => { page.off('framenavigated', onNavigation); page.off('popup', onPopup); page.off('filechooser', onFileChooser); } };
    const onNavigation = () => { tracking.generation++; };
    const onPopup = (popup: Page) => { tracking.popup = popup; };
    const onFileChooser = () => { tracking.fileChooser = true; };
    page.on('framenavigated', onNavigation); page.on('popup', onPopup); page.on('filechooser', onFileChooser);
    return this.tracking = tracking;
  }
  private async record(action: EvidenceAction, input: object, frames: ScreenFrame[], observationId?: string): Promise<void> {
    if (!this.files) return;
    this.journal ??= this.files.write('', 'screen-'+randomUUID()+'.jsonl', 'jsonl');
    await appendFile(await this.journal, JSON.stringify({
      action, input, ...(observationId ? { observationId } : {}),
      frames: frames.map(({ data, ...frame }) => frame),
    })+'\n', { encoding: 'utf8', mode: 0o600 });
  }
  async deny(command: string): Promise<void> {
    const startedAt = new Date().toISOString();
    this.observation = undefined;
    await this.record({ id: randomUUID(), kind: 'denied-command', startedAt, durationMs: 0, outcome: 'denied' }, { command }, []);
  }
  async execute(raw: ScreenRequest, operation: () => OperationContext, authorize?: (request: ScreenRequest, operation: OperationContext) => Promise<boolean>, perform: (action: () => Promise<void>) => Promise<void> = action => action()): Promise<ScreenResult> {
    const started = performance.now(), startedAt = new Date().toISOString();
    const kind = raw && typeof raw === 'object' && 'action' in raw && actions.has(raw.action) ? raw.action : 'unsupported';
    const action: EvidenceAction = { id: randomUUID(), kind, startedAt, durationMs: 0, outcome: 'failed' };
    const previous = this.observation; this.observation = undefined;
    const frames: ScreenFrame[] = [];
    let request: ScreenRequest | undefined, input: Record<string,unknown> = {}, effectStarted = false, authorized = false;
    try {
      const parsed = screenSchema.safeParse(raw);
      if (!parsed.success) throw new BrowserError('INVALID_ARGUMENT', 'Invalid screen request. Only viewport pixels and supported physical inputs are available.');
      request = parsed.data;
      if (request.action === 'scroll' && (request.x === undefined) !== (request.y === undefined))
        throw new BrowserError('INVALID_ARGUMENT', 'A scroll position requires both x and y.');
      input = Object.fromEntries(Object.entries(request).filter(([name]) => !['text','capture','observationId','action'].includes(name)));
      if (request.action === 'type') input.textLength = request.text.length;
      if (authorize && await authorize(request, operation()) !== true)
        throw new BrowserError('ACTION_DENIED', 'The caller policy denied this screen operation.');
      authorized = true;
      operation().signal.throwIfAborted();
      const page = this.page(), tracking = this.track(page);
      const checkPopup = () => {
        if (tracking.popup && !tracking.popup.isClosed()) throw new BrowserError('SCREEN_POPUP_UNSUPPORTED','A new browser tab opened. This viewport session cannot inspect or switch that tab; this is a tool capability limit, not a product failure.');
        if (tracking.fileChooser) throw new BrowserError('SCREEN_FILE_CHOOSER_UNSUPPORTED','A native file chooser opened. This viewport tool cannot inspect or operate it; this is a tool capability limit, not a product failure.');
      };
      checkPopup();
      if (request.action !== 'look') {
        if (!previous || previous.id !== request.observationId || previous.page !== page ||
          previous.generation !== tracking.generation || !dimensionsEqual(previous.configured, page.viewportSize()))
          throw new BrowserError('STALE_SCREEN', 'The screen observation is no longer current. Look again before any input.');
        if (!page.viewportSize()) {
          const op=operation();
          const current = imageSize(await page.screenshot({ type:'png', scale:'css', animations:'allow', caret:'initial', timeout:op.timeoutMs, signal:op.signal }));
          if (!dimensionsEqual(current, previous.viewport) || previous.generation !== tracking.generation)
            throw new BrowserError('STALE_SCREEN', 'The screen viewport changed. Look again before any input.');
        }
        if (!sameGeometry(previous.geometry, await viewportGeometry(page, operation())) || previous.generation !== tracking.generation)
          throw new BrowserError('STALE_SCREEN', 'The visible viewport changed. Look again before any input.');
        const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < previous.viewport.width && y < previous.viewport.height;
        if ('x' in request && request.x !== undefined && request.y !== undefined && !inside(request.x,request.y) ||
          request.action === 'drag' && !inside(request.toX,request.toY))
          throw new BrowserError('SCREEN_COORDINATES', 'Input coordinates must be inside the observed CSS-pixel viewport.');
        if (['click','move','drag','scroll'].includes(request.action) && (previous.geometry.offsetX !== 0 || previous.geometry.offsetY !== 0 ||
          previous.geometry.scale !== 1 && page.context().browser()?.browserType().name() !== 'chromium'))
          throw new BrowserError('SCREEN_VIEWPORT_UNSUPPORTED', 'Pointer input for this viewport transform is not supported. This is a tool capability limit; no input was sent.');
      }
      const point = (x: number, y: number) => ({ x: x / previous!.geometry.scale, y: y / previous!.geometry.scale });
      operation().signal.throwIfAborted();
      effectStarted = !['look','wait'].includes(request.action);
      await perform(async () => { const op=operation(); switch (request!.action) {
        case 'look': break;
        case 'click': { const p=point(request.x,request.y); await page.mouse.click(p.x,p.y); break; }
        case 'move': { const p=point(request.x,request.y); await page.mouse.move(p.x,p.y); break; }
        case 'drag':
          { const from=point(request.x,request.y), to=point(request.toX,request.toY);
          await page.mouse.move(from.x,from.y);
          await page.mouse.down();
          try { operation().signal.throwIfAborted(); await page.mouse.move(to.x,to.y,{steps:5}); }
          finally { await page.mouse.up(); }
          break; }
        case 'scroll':
          if (request.x !== undefined && request.y !== undefined) { const p=point(request.x,request.y); await page.mouse.move(p.x,p.y); }
          await page.mouse.wheel(request.deltaX,request.deltaY); break;
        case 'type':
          for (const character of request.text) { operation().signal.throwIfAborted(); await page.keyboard.type(character); }
          break;
        case 'press': await page.keyboard.press(request.key); break;
        case 'back': await page.goBack({ waitUntil:'commit',timeout:op.timeoutMs,signal:op.signal }); break;
        case 'forward': await page.goForward({ waitUntil:'commit',timeout:op.timeoutMs,signal:op.signal }); break;
        case 'reload': await page.reload({ waitUntil:'commit',timeout:op.timeoutMs,signal:op.signal }); break;
        case 'wait': await delay(request.milliseconds,undefined,{signal:operation().signal}); break;
      } });
      checkPopup();
      const count = request.capture?.frames ?? 1, interval = request.capture?.intervalMs ?? 20;
      let viewport: ScreenResult['viewport'] | undefined;
      let geometry: ViewportGeometry | undefined;
      const generation = tracking.generation;
      for (let i=0;i<count;i++) {
        if (i) await delay(interval,undefined,{signal:operation().signal});
        const op=operation();op.signal.throwIfAborted();checkPopup();
        const png=await page.screenshot({type:'png',scale:'css',animations:'allow',caret:'initial',timeout:op.timeoutMs,signal:op.signal});
        const capturedAt=new Date().toISOString(), elapsedMs=performance.now()-started;
        // Frames intentionally span animation and scrolling. Bind freshness to the last frame,
        // before optional file writes, without requiring constant scroll across the sequence.
        if (i === count-1) geometry=await viewportGeometry(page,operation());
        checkPopup();
        const size=imageSize(png);
        if (this.page() !== page || generation !== tracking.generation || viewport && !dimensionsEqual(viewport,size))
          throw new BrowserError('STALE_SCREEN','The Page or viewport changed during capture. Look again before any input.');
        viewport=size;
        frames.push({data:png.toString('base64'),mimeType:'image/png',capturedAt,elapsedMs,
          ...(this.files ? {path:await this.files.write(png,'screen-'+action.id+'-'+i+'.png','png')} : {})});
      }
      if (this.page() !== page || generation !== tracking.generation)
        throw new BrowserError('STALE_SCREEN','The Page changed during capture. Look again before any input.');
      operation().signal.throwIfAborted();
      const observationId=randomUUID();
      this.observation={id:observationId,page,generation,viewport:viewport!,configured:page.viewportSize(),geometry:geometry!};
      action.outcome=effectStarted?'executed':'observed';action.durationMs=performance.now()-started;
      await this.record(action,input,frames,observationId);
      return {observationId,viewport:viewport!,frames,action:action as ScreenResult['action']};
    } catch (error) {
      action.outcome=effectStarted?'unknown':error instanceof BrowserError && ['INVALID_ARGUMENT','ACTION_DENIED','STALE_SCREEN','SCREEN_COORDINATES'].includes(error.code)?'denied':'failed';
      action.durationMs=performance.now()-started;
      try { await this.record(action,input,frames); } catch { /* Preserve the primary failure; no action is replayed to repair recording. */ }
      if (error instanceof BrowserError) throw error;
      if (!authorized) throw new BrowserError('SCREEN_FAILED','Screen authorization did not complete. No input was retried.');
      throw new BrowserError(effectStarted?'SCREEN_INTERRUPTED':'SCREEN_FAILED',effectStarted
        ?'The screen operation did not finish; input may have reached the page. Look before deciding what to do next. No input was retried.'
        :'The screen could not be captured. No input was retried.');
    }
  }
  close(): void { this.tracking?.detach();this.tracking=undefined;this.observation=undefined; }
}
