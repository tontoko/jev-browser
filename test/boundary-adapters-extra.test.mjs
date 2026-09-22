import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {Client,InMemoryTransport} from '@modelcontextprotocol/client';
import {JevBrowser} from '../dist/index.js';
import {createMcpServer} from '../dist/mcp.js';
import {executeCommand,parseCommand} from '../dist/commands.js';
import {capture,verifyCapturedTarget} from '../dist/observation.js';
import {waitForRelevantChange} from '../dist/completion.js';
import {fixtureBrowser,engine,httpServer} from './helpers.mjs';
let browser;before(async()=>{browser=await fixtureBrowser();});after(async()=>{await browser?.close();});
for(const entry of ['dispatcher','mcp'])test(`adapter boundary: ${entry} never executes a scoped action moved during authorization`,async t=>{
 const context=await browser.newContext(),page=await context.newPage();await page.setContent('<main id="allowed"><form><button type="button" onclick="window.saves=(window.saves||0)+1">Save</button></form></main><aside id="outside"></aside>');
 const core=new JevBrowser({page,engine:engine(()=>c=>c?.kind==='click'&&c.target?.name==='Save'),allowCommand:async()=>{await page.evaluate(()=>document.querySelector('#outside').append(document.querySelector('form')));return true;}});
 t.after(async()=>{await core.close();await context.close();});
 if(entry==='dispatcher')await assert.rejects(executeCommand(core,parseCommand({command:'act',instruction:'Click Save.',scope:'#allowed'})),{code:'STALE_TARGET'});
 else{
   const server=createMcpServer(core),client=new Client({name:'boundary-proof',version:'1'}),[ct,st]=InMemoryTransport.createLinkedPair();t.after(async()=>{await client.close();await server.close();});await server.connect(st);await client.connect(ct);
   const response=await client.callTool({name:'browser_act',arguments:{instruction:'Click Save.',scope:'#allowed'}});assert.equal(response.isError,true);assert.equal(JSON.parse(response.content.find(c=>c.type==='text').text).error.code,'STALE_TARGET');
 }
 assert.equal(await page.evaluate(()=>window.saves||0),0);
});
for(const kind of ['detached','navigated','unrelated-added'])test(`frame lifetime: ${kind} is not confused with unobserved frame completion`,async t=>{
 const context=await browser.newContext(),page=await context.newPage();t.after(()=>context.close());await page.setContent('<main><button>Save</button></main><iframe srcdoc="<p>Frame text</p>"></iframe>');await page.frameLocator('iframe').locator('p').waitFor();
 const frame=kind==='unrelated-added'?page.mainFrame():page.frames()[1];const root=await frame.locator(kind==='unrelated-added'?'main':'body').elementHandle();const observed=await capture(page,{maxElements:20,maxTexts:20,selection:{frame,roots:[root]}});await root.dispose();t.after(()=>observed.dispose());
 if(kind==='detached')await page.locator('iframe').evaluate(el=>el.remove());
 if(kind==='navigated')await frame.goto('about:blank#new-document');
 if(kind==='unrelated-added')await page.evaluate(()=>{const iframe=document.createElement('iframe');iframe.srcdoc='<p>Other frame</p>';document.body.append(iframe);});
 assert.equal(await waitForRelevantChange(page,observed,180,new AbortController().signal),kind!=='unrelated-added');
});
test('Page downloads: an unselected core cannot see or save a foreign download',async t=>{
 const app=await httpServer((req,res)=>{if(req.url==='/file'){res.setHeader('Content-Disposition','attachment; filename="synthetic.txt"');res.setHeader('Content-Type','text/plain');res.end('synthetic');return;}res.setHeader('Content-Type','text/html');res.end('<a href="/file">Download</a>');});
 const context=await browser.newContext(),a=await context.newPage(),b=await context.newPage();await a.goto(app.url);await b.setContent('<p>Other</p>');const ca=new JevBrowser({page:a}),cb=new JevBrowser({page:b});t.after(async()=>{await ca.close();await cb.close();await context.close();await app.close();});
 const pending=a.waitForEvent('download');await ca.native({command:'click',target:'a'});await pending;
 assert.equal((await ca.native({command:'downloads',action:'list'})).downloads.length,1);assert.equal((await cb.native({command:'downloads',action:'list'})).downloads.length,0);
 await assert.rejects(cb.native({command:'downloads',action:'save',index:0,filename:'should-not-exist.txt'}),{code:'INVALID_ARGUMENT'});
});
test('native batch: a previous input cannot move a later captured ref outside its scope',async t=>{
 const context=await browser.newContext(),page=await context.newPage();t.after(()=>context.close());await page.setContent('<main id="allowed"><label>First<input id="first"></label><label id="later">Second<input id="second"></label></main><aside id="outside"></aside>');await page.locator('#first').evaluate(el=>el.oninput=()=>document.querySelector('#outside').append(document.querySelector('#later')));
 const core=new JevBrowser({page});t.after(()=>core.close());const snap=await core.snapshot({scope:'#allowed'});
 await assert.rejects(core.native({command:'fill_form',fields:[{ref:snap.elements.find(e=>e.name==='First').id,type:'textbox',value:'A'},{ref:snap.elements.find(e=>e.name==='Second').id,type:'textbox',value:'B'}]}),{code:'STALE_TARGET'});
 assert.equal(await page.locator('#first').inputValue(),'A');assert.equal(await page.locator('#second').inputValue(),'');
});
