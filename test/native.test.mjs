import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {JevBrowser} from '../dist/index.js';
import {fixtureBrowser,httpServer} from './helpers.mjs';
let browser,server,root;
before(async()=>{
 browser=await fixtureBrowser();root=await mkdtemp(join(tmpdir(),'jev-native-'));
 server=await httpServer((req,res)=>{
  if(req.url==='/download'){res.setHeader('Content-Type','application/octet-stream');res.setHeader('Content-Disposition','attachment; filename="sample.txt"');res.end('downloaded');return;}
  res.setHeader('Content-Type','text/html');res.end('<h1>'+req.url+'</h1><a href="/two">Next</a><label>Email<input></label><button onclick="document.body.dataset.saved=1">Save</button>');
 });
});
after(async()=>{await server?.close();await browser?.close();await rm(root,{recursive:true,force:true});});
async function fixture(t,html,options={}){
 const context=await browser.newContext({acceptDownloads:true});const page=await context.newPage();
 const core=new JevBrowser({page,fileRoots:[root],outputDir:root,...options});
 t.after(async()=>{await core.close();await context.close();});
 if(html!==undefined)await page.setContent(html);return {core,page,context};
}
test('snapshot references drive native actions without a Jev key',async t=>{
 const {core,page}=await fixture(t,'<label>Email<input></label><button onclick="this.dataset.hit=1">Save</button>');
 const s=await core.snapshot();const field=s.elements.find(e=>e.name==='Email');
 await core.native({command:'type',target:field.id,text:'local@example.invalid'});
 assert.equal(await page.locator('input').inputValue(),'local@example.invalid');
 await core.native({command:'click',target:'button'});assert.equal(await page.locator('button').getAttribute('data-hit'),'1');
});
test('old snapshot refs cannot accidentally resolve to a new node',async t=>{
 const {core}=await fixture(t,'<button>Old</button>');const a=await core.snapshot();await core.page.setContent('<button>New</button>');await core.snapshot();
 await assert.rejects(core.native({command:'click',target:a.elements[0].id}),{code:'STALE_TARGET'});
});
test('history navigation and reload use the same Page',async t=>{
 const {core}=await fixture(t);await core.goto(server.url+'/one');await core.native({command:'navigate',url:server.url+'/two'});
 await core.native({command:'navigate_back'});assert.ok(core.page.url().endsWith('/one'));
 await core.native({command:'navigate_forward'});assert.ok(core.page.url().endsWith('/two'));await core.native({command:'reload'});
});
test('tabs are listed selected and closed while borrowed context survives',async t=>{
 const {core,page,context}=await fixture(t,'<p>First</p>');await core.native({command:'tabs',action:'new',url:server.url+'/new'});
 const list=await core.native({command:'tabs',action:'list'});assert.equal(list.tabs.length,2);assert.notEqual(core.page,page);
 await core.native({command:'tabs',action:'select',index:0});assert.equal(core.page,page);
 await core.native({command:'tabs',action:'close',index:1});assert.equal(context.pages().length,1);
 await core.close();assert.equal(page.isClosed(),false);
});
test('native form filling select check and assertions preserve values',async t=>{
 const {core,page}=await fixture(t,'<label>Name<input id=name></label><select id=plan><option value=a>A</option><option value=b>B</option></select><input id=agree type=checkbox>');
 await core.native({command:'fill_form',fields:[{target:'#name',type:'textbox',value:'Teacher'},{target:'#plan',type:'combobox',value:'b'},{target:'#agree',type:'checkbox',value:true}]});
 await core.native({command:'assert',target:'#name',property:'value',expected:'Teacher'});assert.equal(await page.locator('#plan').inputValue(),'b');assert.equal(await page.locator('#agree').isChecked(),true);
 await assert.rejects(core.native({command:'assert',target:'#name',property:'value',expected:'Wrong'}),{code:'ASSERTION_FAILED'});
});
test('pending native dialogs can be answered after a click',async t=>{
 const {core,page}=await fixture(t,'<button onclick="document.body.dataset.answer=prompt(\'Name?\')">Prompt</button>');
 const result=await core.native({command:'click',target:'button'});assert.equal(result.status,'dialog');assert.equal(result.dialog.type,'prompt');
 await core.native({command:'handle_dialog',accept:true,promptText:'Accepted'});assert.equal(await page.locator('body').getAttribute('data-answer'),'Accepted');
});
test('uploads are bounded to configured roots',async t=>{
 const {core,page}=await fixture(t,'<input type=file>');const path=join(root,'upload.txt');await writeFile(path,'upload content');
 await core.native({command:'file_upload',target:'input',paths:[path]});assert.equal(await page.locator('input').evaluate(e=>e.files[0].name),'upload.txt');
 const outside=await mkdtemp(join(tmpdir(),'jev-outside-'));t.after(()=>rm(outside,{recursive:true,force:true}));
 const unshared=join(outside,'unshared.txt');await writeFile(unshared,'not granted');
 await assert.rejects(core.native({command:'file_upload',target:'input',paths:[unshared]}),{code:'FILE_ACCESS_DENIED'});
 assert.equal(await page.locator('input').evaluate(e=>e.files[0].name),'upload.txt');
});
test('output paths cannot escape the artifact directory',async t=>{
 const {core}=await fixture(t,'<p>Screenshot</p>');await assert.rejects(core.native({command:'take_screenshot',filename:'../escape.png'}),{code:'FILE_ACCESS_DENIED'});
 const r=await core.native({command:'take_screenshot',filename:'screen.png'});assert.equal((await readFile(r.path)).subarray(1,4).toString(),'PNG');
});
test('downloads use explicitly selected artifact paths',async t=>{
 const {core,page}=await fixture(t);await core.goto(server.url);await page.evaluate(()=>{const a=document.createElement('a');a.href='/download';a.textContent='Download';document.body.append(a);});
 // A click completing is not the download event. Register before the action.
 const downloaded=page.waitForEvent('download');
 await core.native({command:'click',target:'text=Download'});await downloaded;
 const list=await core.native({command:'downloads',action:'list'});assert.equal(list.downloads.length,1);
 const saved=await core.native({command:'downloads',action:'save',index:0,filename:'received.txt'});assert.equal(await readFile(saved.path,'utf8'),'downloaded');
});
test('console and network metadata are collected without a model call',async t=>{
 const {core,page}=await fixture(t);await core.goto(server.url+'/logs');await page.evaluate(()=>console.warn('synthetic warning'));
 const logs=await core.native({command:'console_messages'});assert.ok(logs.messages.some(m=>m.text==='synthetic warning'));
 const network=await core.native({command:'network_requests'});assert.ok(network.requests.some(r=>r.url.endsWith('/logs')));
});
test('page evaluation is opt-in and is never a hidden fallback',async t=>{
 const {core}=await fixture(t,'<h1>Title</h1>');await assert.rejects(core.native({command:'evaluate',function:'() => document.title'}),{code:'CAPABILITY_DISABLED'});
 const enabled=new JevBrowser({page:core.page,allowEvaluate:true});t.after(()=>enabled.close());
 assert.equal((await enabled.native({command:'evaluate',function:'() => document.querySelector("h1").textContent'})).value,'Title');
});
test('native local and session storage operations stay in the selected page',async t=>{
 const {core}=await fixture(t);await core.goto(server.url);
 await core.native({command:'storage',area:'local',action:'set',name:'lesson',value:'gamba'});
 assert.equal((await core.native({command:'storage',area:'local',action:'get',name:'lesson'})).value,'gamba');
 await core.native({command:'storage',area:'local',action:'delete',name:'lesson'});assert.equal((await core.native({command:'storage',area:'local',action:'get',name:'lesson'})).value,null);
});
test('trace recording and deterministic routing use Playwright primitives',async t=>{
 const {core,page}=await fixture(t);await core.native({command:'trace',action:'start'});
 await core.native({command:'route',action:'fulfill',pattern:'**/mock',body:'<h1>Mocked</h1>',contentType:'text/html'});
 await core.goto(server.url+'/mock');assert.equal(await page.locator('h1').textContent(),'Mocked');
 const trace=await core.native({command:'trace',action:'stop',filename:'native-trace.zip'});assert.ok((await readFile(trace.path)).length>0);
});
test('native operation authorization cannot be bypassed through raw selectors',async t=>{
 const {core,page}=await fixture(t,'<button onclick="this.dataset.hit=1">Denied</button>',{allowCommand:()=>false});
 await assert.rejects(core.native({command:'click',target:'button'}),{code:'ACTION_DENIED'});assert.equal(await page.locator('button').getAttribute('data-hit'),null);
});
