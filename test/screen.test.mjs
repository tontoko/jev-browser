import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {JevBrowser} from '../dist/index.js';
import {parseCommand,executeCommand} from '../dist/commands.js';
import {fixtureBrowser,httpServer} from './helpers.mjs';
let browser,server,root;
before(async()=>{
 browser=await fixtureBrowser();root=await mkdtemp(join(tmpdir(),'jev-screen-'));
 server=await httpServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<p>Visible page</p><input aria-label="HIDDEN_ARIA_SECRET"><script>document.title="HIDDEN_TITLE_SECRET"</script>');});
});
after(async()=>{await server?.close();await browser?.close();await rm(root,{recursive:true,force:true});});
async function fixture(t,options={}){
 const context=await browser.newContext({viewport:{width:420,height:320},deviceScaleFactor:2});
 const page=await context.newPage();
 await page.setContent('<style>input{position:absolute;left:20px;top:20px;width:180px;height:32px}button{position:absolute;left:20px;top:80px;width:150px;height:40px}h1{position:absolute;top:140px}</style><title>HIDDEN_TITLE_SECRET</title><input aria-label="HIDDEN_ARIA_SECRET"><button onclick="document.querySelector(\'h1\').textContent=document.querySelector(\'input\').value">Save</button><h1>Pending</h1><i hidden>HIDDEN_DOM_SECRET</i>');
 const core=new JevBrowser({page,...options});
 t.after(async()=>{await core.close();await context.close();});
 return {core,page,context};
}
test('screen uses visible pixels and focused coordinate input without model or DOM metadata',async t=>{
 const {core,page}=await fixture(t,{engine:{decide(){throw new Error('Screen must not call a model');}}});
 assert.equal(typeof core.screen,'function','screen API must exist');
 let r=await core.screen({action:'look'});
 assert.deepEqual(r.viewport,{width:420,height:320});
 const png=Buffer.from(r.frames[0].data,'base64');assert.equal(png.readUInt32BE(16),420);assert.equal(png.readUInt32BE(20),320);
 assert.equal(JSON.stringify(r).includes('HIDDEN_'),false);
 r=await core.screen({action:'click',x:60,y:40,observationId:r.observationId});
 r=await core.screen({action:'type',text:'Visible result',observationId:r.observationId});
 r=await core.screen({action:'click',x:70,y:100,observationId:r.observationId});
 assert.equal(await page.locator('h1').textContent(),'Visible result');
 assert.equal(r.action.outcome,'executed');assert.equal(r.frames.length,1);
 assert.ok(r.action.durationMs>=0);assert.ok(Date.parse(r.frames[0].capturedAt)>=Date.parse(r.action.startedAt));
 assert.equal(JSON.stringify(r).includes('HIDDEN_'),false);
 await core.close();assert.equal(page.isClosed(),false);
});
test('old screenshots, navigation and resized viewports cannot authorize a later input',async t=>{
 const {core,page}=await fixture(t);assert.equal(typeof core.screen,'function');
 const first=await core.screen({action:'look'});await core.screen({action:'look'});
 await assert.rejects(core.screen({action:'click',x:70,y:100,observationId:first.observationId}),{code:'STALE_SCREEN'});
 const beforeNav=await core.screen({action:'look'});await page.goto(server.url);
 await assert.rejects(core.screen({action:'type',text:'wrong',observationId:beforeNav.observationId}),{code:'STALE_SCREEN'});
 const beforeResize=await core.screen({action:'look'});await page.setViewportSize({width:400,height:300});
 await assert.rejects(core.screen({action:'click',x:1,y:1,observationId:beforeResize.observationId}),{code:'STALE_SCREEN'});
 assert.equal(await page.locator('input').inputValue(),'');
});
test('screen checks the existing command policy and rechecks freshness after authorization',async t=>{
 let core,page,release;
 const f=await fixture(t,{allowCommand:async command=>{if(command.command==='screen'&&command.request.action==='click'){await new Promise(r=>release=r);}return true;}});core=f.core;page=f.page;
 assert.equal(typeof core.screen,'function');const seen=await core.screen({action:'look'});
 const pending=core.screen({action:'click',x:70,y:100,observationId:seen.observationId});
 while(!release)await new Promise(r=>setTimeout(r,1));
 await page.goto(server.url);release();
 await assert.rejects(pending,{code:'STALE_SCREEN'});
 const denied=await fixture(t,{allowCommand:command=>command.command!=='screen'});
 await assert.rejects(denied.core.screen({action:'look'}),{code:'ACTION_DENIED'});
});
test('screen mode rejects ordinary dispatcher commands and does not change normal mode',async t=>{
 const {core}=await fixture(t,{screenOnly:true});
 assert.equal(core.screenOnly,true);
 for(const request of [{command:'snapshot'},{command:'goto',url:server.url},{command:'network_requests'},{command:'evaluate',function:'()=>document.title'},{command:'take_screenshot',fullPage:true}]){
  await assert.rejects(executeCommand(core,parseCommand(request)),{code:'SCREEN_ONLY'});
 }
 assert.throws(()=>{core.screenOnly=false;},TypeError);
 const normal=await fixture(t);assert.equal(normal.core.screenOnly,false);
 assert.ok((await executeCommand(normal.core,parseCommand({command:'snapshot'}))).elements.length>0);
});
test('invalid screen commands cannot inject selectors or privileged keyboard chords',async t=>{
 const {core,page}=await fixture(t);assert.equal(typeof core.screen,'function');
 for(const request of [
  {action:'look',scope:'body'},{action:'look',fullPage:true},{action:'look',capture:{frames:11,intervalMs:20}},
  {action:'press',key:'F12'},{action:'press',key:'Control+l'},{action:'press',key:'Meta+v'},
  {action:'press',key:'Control+Shift+I'},{action:'press',key:'Control+u'},{action:'press',key:'Control+c'},
  {action:'type',text:'wrong',target:'input'},
 ]){
  const seen=await core.screen({action:'look'});
  await assert.rejects(core.screen({...request,...(request.action==='look'?{}:{observationId:seen.observationId})}),{code:'INVALID_ARGUMENT'});
 }
 const seen=await core.screen({action:'look'});
 await assert.rejects(core.screen({action:'click',x:421,y:20,observationId:seen.observationId}),{code:'SCREEN_COORDINATES'});
 assert.equal(await page.locator('input').inputValue(),'');
});
test('screen emits timestamped transient frames and writes evidence without duplicating typed text',async t=>{
 const outputDir=await mkdtemp(join(root,'evidence-'));const {core,page}=await fixture(t,{outputDir});assert.equal(typeof core.screen,'function');
 let r=await core.screen({action:'look'});r=await core.screen({action:'click',x:50,y:35,observationId:r.observationId});
 r=await core.screen({action:'type',text:'PRIVATE_TYPED_VALUE',observationId:r.observationId});
 await page.evaluate(()=>{document.body.style.background='white';setTimeout(()=>document.body.style.background='black',75);});
 r=await core.screen({action:'look',capture:{frames:4,intervalMs:40}});
 assert.equal(r.frames.length,4);assert.ok(r.frames[3].elapsedMs>=100);assert.ok(new Set(r.frames.map(f=>f.data)).size>1);
 for(const f of r.frames){assert.equal((await readFile(f.path)).subarray(1,4).toString(),'PNG');}
 await assert.rejects(core.screen({action:'press',key:'F12',observationId:r.observationId}),{code:'INVALID_ARGUMENT'});
 const logs=(await readdir(outputDir)).filter(n=>n.endsWith('.jsonl'));assert.equal(logs.length,1);
 const text=await readFile(join(outputDir,logs[0]),'utf8');assert.equal(text.includes('PRIVATE_TYPED_VALUE'),false);assert.equal(text.includes('HIDDEN_'),false);
 const rows=text.trim().split('\n').map(JSON.parse);assert.ok(rows.some(row=>row.action.kind==='type'&&row.input.textLength===19));
 assert.ok(rows.some(row=>row.action.outcome==='denied'));
});

