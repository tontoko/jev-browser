import type { BrowserContext, ConsoleMessage, Dialog, Download, ElementHandle, FileChooser, Locator, Page, Request, Route } from 'playwright';
import { BrowserError } from './errors.js';
import { FileAccess } from './paths.js';
import { publicURL } from './observation.js';
import type { BrowserOptions, BrowserDialog } from './types.js';
type Target = Locator | ElementHandle<Element>;
export interface NativeHost {page():Page;select(page:Page):Promise<void>;resolve(target:string,frame?:number):Promise<Target>;validateURL(url:string):Promise<string>}
type ActionOutcome={status:'executed'}|{status:'dialog';dialog:BrowserDialog};
// One recipient for effectful events on each Page; independent Pages are not serialized.
const eventOwners=new WeakMap<Page,BrowserEvents>();
const observers=new WeakMap<Page,Set<BrowserEvents>>();
export class BrowserEvents {
  protected readonly files:FileAccess;
  protected readonly context:BrowserContext;
  protected readonly detach=new Map<Page,()=>void>();
  protected readonly messages:{type:string;text:string;url:string}[]=[];
  protected readonly requests:{method:string;url:string;resourceType:string}[]=[];
  protected readonly downloads:Download[]=[];
  protected readonly routes=new Map<string,(route:Route)=>Promise<void>>();
  protected dialog?:Dialog;
  private dialogId=0;
  private dialogPage?:Page;
  protected chooser?:FileChooser;
  protected dialogNotice?:()=>void;
  protected pendingAction?:Promise<void>;
  protected traceStarted=false;
  constructor(protected readonly host:NativeHost,protected readonly options:BrowserOptions){
    this.context=host.page().context();
    this.files=new FileAccess(options.fileRoots??[process.cwd()],options.outputDir??'.jev-browser/artifacts');
    this.attach(host.page());
  }
  private attach(page:Page):void {
    if(this.detach.has(page))return;
    const peers=observers.get(page)??new Set<BrowserEvents>();peers.add(this);observers.set(page,peers);
    if(!eventOwners.has(page))eventOwners.set(page,this);
    const own=()=>eventOwners.get(page)===this;
    const onConsole=(m:ConsoleMessage)=>{this.messages.push({type:m.type(),text:m.text(),url:publicURL(page.url())});if(this.messages.length>500)this.messages.shift();};
    const onError=(e:Error)=>{this.messages.push({type:'error',text:e.message,url:publicURL(page.url())});if(this.messages.length>500)this.messages.shift();};
    const onRequest=(r:Request)=>{this.requests.push({method:r.method(),url:publicURL(r.url()),resourceType:r.resourceType()});if(this.requests.length>1000)this.requests.shift();};
    const onDownload=(d:Download)=>{if(!own())return;this.downloads.push(d);if(this.downloads.length>100)this.downloads.shift();};
    const onDialog=(d:Dialog)=>{if(!own())return;this.dialog=d;this.dialogId++;this.dialogPage=page;this.dialogNotice?.();};
    const onChooser=(c:FileChooser)=>{if(own())this.chooser=c;};
    const onClose=()=>{this.detach.get(page)?.();this.detach.delete(page);if(this.dialogPage===page){this.dialog=undefined;this.dialogPage=undefined;}if(this.chooser?.page()===page)this.chooser=undefined;};
    page.on('console',onConsole);page.on('pageerror',onError);page.on('request',onRequest);page.on('download',onDownload);page.on('dialog',onDialog);page.on('filechooser',onChooser);page.on('close',onClose);
    this.detach.set(page,()=>{
      page.off('console',onConsole);page.off('pageerror',onError);page.off('request',onRequest);page.off('download',onDownload);page.off('dialog',onDialog);page.off('filechooser',onChooser);page.off('close',onClose);
      peers.delete(this);
      if(eventOwners.get(page)===this){const next=peers.values().next().value;if(next)eventOwners.set(page,next);else eventOwners.delete(page);}
      if(!peers.size)observers.delete(page);
    });
  }
  /** Explicit tab adoption changes event scope; old file choosers are not transferred. */
  selectPage(page:Page):void {
    if(this.detach.has(page)&&this.detach.size===1)return;
    const owner=eventOwners.get(page);
    if(owner&&owner!==this&&(owner.dialog||owner.pendingAction))throw new BrowserError('BUSY','Another core owns a pending action on this Page.');
    for(const detach of this.detach.values())detach();this.detach.clear();this.chooser=undefined;
    this.attach(page);
  }
  guard(command?:string):void {
    const owner=eventOwners.get(this.host.page());
    if((owner?.dialog||owner?.pendingAction)&&command!=='handle_dialog')throw new BrowserError('DIALOG_PENDING','Answer the owning Page/core dialog before another operation on that Page.');
  }
  isCurrentDialog(dialog:BrowserDialog):boolean {
    return eventOwners.get(this.host.page())===this&&!!this.dialog&&dialog.id===this.dialogId&&this.dialogPage===this.host.page();
  }
  private dialogResult():ActionOutcome {
    const d=this.dialog!;return {status:'dialog',dialog:{id:this.dialogId,type:d.type(),message:d.message(),defaultValue:d.defaultValue()}};
  }
  async action(fn:()=>Promise<unknown>):Promise<ActionOutcome> {
    this.guard();
    const page=this.host.page(),previous=eventOwners.get(page);
    if(previous&&previous!==this)previous.chooser=undefined;
    eventOwners.set(page,this);
    const notice=new Promise<'dialog'>(resolve=>{this.dialogNotice=()=>resolve('dialog');});
    const task=Promise.resolve().then(fn).then(()=>undefined);void task.catch(()=>undefined);
    try{const result=await Promise.race([task.then(()=>'finished' as const),notice]);if(result==='dialog'){this.pendingAction=task;return this.dialogResult();}return {status:'executed'};}
    finally{this.dialogNotice=undefined;}
  }
  protected async handleDialog(accept:boolean,promptText?:string):Promise<ActionOutcome> {
    if(!this.dialog||this.dialogPage!==this.host.page()||eventOwners.get(this.host.page())!==this)throw new BrowserError('NO_DIALOG','This core does not own a pending dialog on its selected Page.');
    const dialog=this.dialog;this.dialog=undefined;
    const notice=new Promise<'dialog'>(resolve=>{this.dialogNotice=()=>resolve('dialog');});
    await(accept?dialog.accept(promptText):dialog.dismiss());
    const pending=this.pendingAction;
    try{const result=await Promise.race([(pending??Promise.resolve()).then(()=>'finished' as const),notice]);if(result==='dialog')return this.dialogResult();this.pendingAction=undefined;return {status:'executed'};}
    finally{this.dialogNotice=undefined;if(!this.dialog)this.pendingAction=undefined;}
  }
  protected takeChooser():FileChooser {
    if(!this.chooser||this.chooser.page()!==this.host.page()||eventOwners.get(this.host.page())!==this)throw new BrowserError('NO_FILE_CHOOSER','This core has no file chooser on its selected Page.');
    const chooser=this.chooser;this.chooser=undefined;return chooser;
  }
  protected async target(args:{target?:string;ref?:string;frame?:number}):Promise<Target>{
    const target=args.target??args.ref;if(!target)throw new BrowserError('INVALID_ARGUMENT','An element reference or selector is required.');return this.host.resolve(target,args.frame);
  }
  async dispose():Promise<void>{
    if(this.dialog&&this.dialogPage&&eventOwners.get(this.dialogPage)===this)await this.dialog.dismiss().catch(()=>undefined);
    this.dialog=undefined;this.chooser=undefined;await this.pendingAction?.catch(()=>undefined);this.pendingAction=undefined;
    for(const detach of this.detach.values())detach();this.detach.clear();
    for(const[pattern,handler]of this.routes)await this.context.unroute(pattern,handler).catch(()=>undefined);this.routes.clear();
    if(this.traceStarted)await this.context.tracing.stop().catch(()=>undefined);this.traceStarted=false;
  }
}
