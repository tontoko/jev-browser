import type { BrowserContext, ConsoleMessage, Dialog, Download, ElementHandle, FileChooser, Locator, Page, Request, Route } from 'playwright';
import { BrowserError } from './errors.js';
import { FileAccess } from './paths.js';
import { publicURL } from './observation.js';
import type { BrowserOptions, BrowserDialog } from './types.js';

type Target = Locator | ElementHandle<Element>;
export interface NativeHost {
  page(): Page;
  select(page: Page): Promise<void>;
  resolve(target: string, frame?: number): Promise<Target>;
  validateURL(url: string): Promise<string>;
}
type ActionOutcome = { status: 'executed' } | { status: 'dialog'; dialog: BrowserDialog };
/** Mechanical browser operations. The shared core supplies locking, authorization and reference identity. */
export class BrowserEvents {
  protected readonly files: FileAccess;
  protected readonly context: BrowserContext;
  protected readonly detach = new Map<Page, () => void>();
  protected readonly messages: { type: string; text: string; url: string }[] = [];
  protected readonly requests: { method: string; url: string; resourceType: string }[] = [];
  protected readonly downloads: Download[] = [];
  protected readonly routes = new Map<string, (route: Route) => Promise<void>>();
  protected dialog?: Dialog;
  private dialogId = 0;
  private dialogPage?: Page;
  protected chooser?: FileChooser;
  protected dialogNotice?: () => void;
  protected pendingAction?: Promise<void>;
  protected traceStarted = false;
  protected readonly onPage = (page: Page) => this.attach(page);

  constructor(protected readonly host: NativeHost, protected readonly options: BrowserOptions) {
    this.context = host.page().context();
    this.files = new FileAccess(options.fileRoots ?? [process.cwd()], options.outputDir ?? '.jev-browser/artifacts');
    for (const page of this.context.pages()) this.attach(page);
    this.context.on('page', this.onPage);
  }
  private attach(page: Page): void {
    if (this.detach.has(page)) return;
    const onConsole = (m: ConsoleMessage) => { this.messages.push({ type: m.type(), text: m.text(), url: publicURL(page.url()) }); if (this.messages.length > 500) this.messages.shift(); };
    const onError = (e: Error) => { this.messages.push({ type: 'error', text: e.message, url: publicURL(page.url()) }); if (this.messages.length > 500) this.messages.shift(); };
    const onRequest = (r: Request) => { this.requests.push({ method: r.method(), url: publicURL(r.url()), resourceType: r.resourceType() }); if (this.requests.length > 1000) this.requests.shift(); };
    const onDownload = (d: Download) => { this.downloads.push(d); if (this.downloads.length > 100) this.downloads.shift(); };
    const onDialog = (d: Dialog) => { this.dialog = d; this.dialogId++; this.dialogPage = page; this.dialogNotice?.(); };
    const onChooser = (c: FileChooser) => { this.chooser = c; };
    const onClose = () => { this.detach.get(page)?.(); this.detach.delete(page); };
    page.on('console', onConsole); page.on('pageerror', onError); page.on('request', onRequest); page.on('download', onDownload); page.on('dialog', onDialog); page.on('filechooser', onChooser); page.on('close', onClose);
    this.detach.set(page, () => { page.off('console', onConsole); page.off('pageerror', onError); page.off('request', onRequest); page.off('download', onDownload); page.off('dialog', onDialog); page.off('filechooser', onChooser); page.off('close', onClose); });
  }
  guard(command?: string): void {
    if ((this.dialog || this.pendingAction) && command !== 'handle_dialog') throw new BrowserError('DIALOG_PENDING', 'Answer the pending browser dialog with handle_dialog before another operation.');
  }
  isCurrentDialog(dialog: BrowserDialog): boolean {
    return !!this.dialog && dialog.id === this.dialogId && this.dialogPage === this.host.page();
  }
  private dialogResult(): ActionOutcome {
    const d = this.dialog!;
    return { status: 'dialog', dialog: { id: this.dialogId, type: d.type(), message: d.message(), defaultValue: d.defaultValue() } };
  }
  async action(fn: () => Promise<unknown>): Promise<ActionOutcome> {
    this.guard();
    const notice = new Promise<'dialog'>(resolve => { this.dialogNotice = () => resolve('dialog'); });
    const task = Promise.resolve().then(fn).then(() => undefined);
    // Register a rejection observer even when the dialog wins the race.
    void task.catch(() => undefined);
    try {
      const result = await Promise.race([task.then(() => 'finished' as const), notice]);
      if (result === 'dialog') { this.pendingAction = task; return this.dialogResult(); }
      return { status: 'executed' };
    } finally { this.dialogNotice = undefined; }
  }
  protected async handleDialog(accept: boolean, promptText?: string): Promise<ActionOutcome> {
    if (!this.dialog) throw new BrowserError('NO_DIALOG', 'There is no pending browser dialog.');
    const dialog = this.dialog; this.dialog = undefined;
    const notice = new Promise<'dialog'>(resolve => { this.dialogNotice = () => resolve('dialog'); });
    await (accept ? dialog.accept(promptText) : dialog.dismiss());
    const pending = this.pendingAction;
    try {
      const result = await Promise.race([(pending ?? Promise.resolve()).then(() => 'finished' as const), notice]);
      if (result === 'dialog') return this.dialogResult();
      this.pendingAction = undefined;
      return { status: 'executed' };
    } finally { this.dialogNotice = undefined; if (!this.dialog) this.pendingAction = undefined; }
  }
  protected async target(args: { target?: string; ref?: string; frame?: number }): Promise<Target> {
    const target = args.target ?? args.ref;
    if (!target) throw new BrowserError('INVALID_ARGUMENT', 'An element reference or selector is required.');
    return this.host.resolve(target, args.frame);
  }
  async dispose(): Promise<void> {
    this.context.off('page', this.onPage);
    if (this.dialog) { await this.dialog.dismiss().catch(() => undefined); this.dialog = undefined; }
    await this.pendingAction?.catch(() => undefined); this.pendingAction = undefined;
    for (const detach of this.detach.values()) detach(); this.detach.clear();
    for (const [pattern, handler] of this.routes) await this.context.unroute(pattern, handler).catch(() => undefined);
    this.routes.clear();
    if (this.traceStarted) await this.context.tracing.stop().catch(() => undefined);
    this.traceStarted = false;
  }
}
