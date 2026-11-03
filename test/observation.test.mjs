import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {Client,InMemoryTransport} from '@modelcontextprotocol/client';
import {JevBrowser} from '../dist/index.js';
import {createMcpServer} from '../dist/mcp.js';
import {capture} from '../dist/observation.js';
import {verifyReadback,waitForRelevantChange} from '../dist/completion.js';
import {flattenInputs} from '../dist/bindings.js';
import {fixtureBrowser,engine,httpServer} from './helpers.mjs';

let browser;
before(async()=>{browser=await fixtureBrowser();});
after(async()=>{await browser?.close();});
const forbidden={decide(){throw new Error('This observation must not reach a decision request.');}};
const bound=(target,key)=>{const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;};
const long='Terms '+'x'.repeat(994);

// Schedule a real browser change between two reads of one capture; the browser outcome is not simulated.
function between(page,change,times=1){
  const main=page.mainFrame();let remaining=times;
  const bound=(target,key)=>{const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;};
  const frame=new Proxy(main,{get(target,key){
    if(key!=='evaluateHandle')return bound(target,key);
    return async(...args)=>{const handle=await target.evaluateHandle(...args);if(remaining>0){remaining--;await change();}return handle;};
  }});
  return new Proxy(page,{get(target,key){return key==='frames'?()=>target.frames().map(candidate=>candidate===main?frame:candidate):bound(target,key);}});
}
async function interrupted(t,change,{times=1,decider=forbidden}={}){
  const server=await httpServer((req,res)=>{res.setHeader('Content-Type','text/html');
    res.end(req.url==='/next'?'<h1>Next page</h1><button>Continue</button>':'<h1>First page</h1><button>Start</button><iframe srcdoc="<p>Framed text</p>"></iframe>');});
  const page=await browser.newPage();await page.goto(server.url);
  const core=new JevBrowser({page:between(page,()=>change(page,server.url),times),engine:decider});
  t.after(async()=>{await core.close();await page.close();await server.close();});
  return {core,page};
}
async function content(t,html,decider=forbidden){
  const page=await browser.newPage();await page.setContent(html);
  const core=new JevBrowser({page,engine:decider});t.after(async()=>{await core.close();await page.close();});
  return {core,page};
}

test('a snapshot interrupted by a real navigation is retaken on the new document',async t=>{
  const {core}=await interrupted(t,(page,url)=>page.goto(url+'/next'));
  const snapshot=await core.snapshot();
  assert.equal(new URL(snapshot.url).pathname,'/next');assert.deepEqual(snapshot.elements.map(element=>element.name),['Continue']);
});
test('observe during a navigation grounds its plan on the settled document',async t=>{
  const decider=engine(()=>candidate=>candidate?.kind==='click'),{core}=await interrupted(t,(page,url)=>page.goto(url+'/next'),{decider});
  const plan=await core.observe('Click the button');
  assert.equal(plan.action.target.name,'Continue');assert.equal(decider.requests.length,1);
});
test('a URL change during capture is retaken instead of failing with STALE_SNAPSHOT',async t=>{
  const {core}=await interrupted(t,page=>page.evaluate(()=>history.pushState({},'','/moved')));
  const snapshot=await core.snapshot();
  assert.equal(new URL(snapshot.url).pathname,'/moved');assert.ok(snapshot.texts.some(source=>source.text==='First page'));
});
test('a capture that finds the document without a root element waits for the page to load and captures again',async t=>{
  const page=await browser.newPage();await page.setContent('<h1>First page</h1><button>Start</button>');t.after(()=>page.close());
  // document.open() leaves the document with no root element until the replacement is written, as a navigation in flight does.
  let replaced=false;
  const racing=new Proxy(page,{get(target,key){
    if(key!=='evaluate')return bound(target,key);
    return async(...args)=>{
      if(!replaced){replaced=true;await target.evaluate(()=>{document.open();setTimeout(()=>{document.write('<h1>Next page</h1><button>Continue</button>');document.close();},200);});}
      return target.evaluate(...args);
    };
  }});
  const observed=await capture(racing,{maxElements:120,maxTexts:160});t.after(()=>observed.dispose());
  assert.ok(observed.data.texts.some(source=>source.text==='Next page'));
  assert.deepEqual(observed.data.elements.map(element=>element.name),['Continue']);
});
test('a page that keeps navigating fails with STALE_SNAPSHOT after bounded retries',async t=>{
  let changes=0;
  const {core}=await interrupted(t,page=>page.evaluate(n=>history.pushState({},'','/moved-'+n),++changes),{times:Infinity});
  await assert.rejects(core.snapshot(),{code:'STALE_SNAPSHOT'});
  assert.equal(changes,3);
});
async function hanging(t){
  const server=await httpServer((req,res)=>{res.setHeader('Content-Type','text/html');
    if(req.url==='/hang'){res.write('<h1>Partial page</h1>'+' '.repeat(4096));return;}
    res.end('<h1>First page</h1><button>Start</button>');});
  const page=await browser.newPage();await page.goto(server.url);
  // The replacement document commits but never finishes loading, so a retry can only wait.
  const core=new JevBrowser({page:between(page,async()=>{await page.evaluate(()=>{location.href='/hang';});await page.waitForURL('**/hang',{waitUntil:'commit'});}),engine:forbidden});
  t.after(async()=>{await core.close();await page.close();await server.close();});
  return core;
}
test('a capture retry waiting on a loading document stops at the operation deadline',async t=>{
  const core=await hanging(t),started=performance.now();
  await assert.rejects(core.snapshot({timeoutMs:500}),error=>error.code==='TIMEOUT'||error.code==='STALE_SNAPSHOT');
  assert.ok(performance.now()-started<1_500,`snapshot took ${Math.round(performance.now()-started)}ms`);
});
test('a capture retry waiting on a loading document stops when the caller cancels',async t=>{
  const core=await hanging(t),controller=new AbortController(),started=performance.now();
  setTimeout(()=>controller.abort(new Error('caller cancelled')),300);
  await assert.rejects(core.snapshot({signal:controller.signal}),/caller cancelled/);
  assert.ok(performance.now()-started<1_500,`snapshot took ${Math.round(performance.now()-started)}ms`);
});
test('a child frame removed during capture is skipped instead of failing the capture',async t=>{
  const {core,page}=await interrupted(t,page=>page.evaluate(()=>document.querySelector('iframe').remove()));assert.equal(page.frames().length,2);
  const snapshot=await core.snapshot();
  assert.ok(snapshot.texts.some(source=>source.text==='First page'));
  assert.equal(snapshot.texts.some(source=>source.text==='Framed text'||source.frame!==0),false);
});

test('text longer than 700 characters is shortened with an explicit flag instead of dropped',async t=>{
  const pair='y'.repeat(699)+'\u{1F600}'+'z'.repeat(20);
  const {core}=await content(t,`<p>${long}</p><p>${pair}</p><p>Short</p>`);
  const snapshot=await core.snapshot();
  assert.deepEqual(snapshot.texts.map(({text,truncated})=>[text,truncated]),[[long.slice(0,700),true],['y'.repeat(699),true],['Short',undefined]]);
  assert.equal(snapshot.truncatedTexts,false);assert.equal(snapshot.truncated,false);
});
test('extraction sends shortened text as context but never offers it as a copied value',async t=>{
  const decider=engine(()=>candidate=>typeof candidate?.text==='string'&&candidate.text.startsWith('Terms'));
  const {core}=await content(t,`<p>${long}</p><p>Order 42</p>`,decider);
  await assert.rejects(core.extract('Read the terms',z.object({terms:z.string()})),{code:'EXTRACTION_MISSING'});
  const [request]=decider.requests;
  assert.deepEqual(request.state.sources.filter(source=>source.truncated).map(source=>source.text),[long.slice(0,700)]);
  assert.deepEqual(Object.values(request.questions.f0.criteria).filter(candidate=>typeof candidate==='object').map(candidate=>candidate.text),['Order 42']);
});
test('semantic comparison never binds shortened text as the actual value',async t=>{
  const decider=engine((question,request)=>{const sources=new Map((request.state.page?.sources??[]).map(source=>[source.id,source]));return candidate=>sources.get(candidate?.sourceId)?.text?.startsWith('Terms');});
  const {core}=await content(t,`<p>${long}</p><p>Order 42</p>`,decider);
  await assert.rejects(core.compareSemantic({actual:{description:'The terms paragraph'},expected:long.slice(0,700)}),{code:'SEMANTIC_NO_MATCH'});
  assert.equal(decider.requests[0].state.page.sources.some(source=>source.text.startsWith('Terms')),false);
});
test('run readback never verifies an input against shortened text',async()=>{
  const value='x'.repeat(700),inputs=flattenInputs({note:value}).map(input=>({...input,applied:true}));
  const snapshot={id:'s',url:'https://example.invalid/',title:'Notes',elements:[],scroll:{y:0,maxY:0,height:720},truncated:false,truncatedTexts:false,truncatedElements:false,
    texts:[{id:'note',frame:0,text:value,context:'Note',role:'definition',truncated:true}],records:[{id:'record',frame:0,textIds:['note'],context:'Note',readOnly:true}]};
  let calls=0;
  assert.equal(await verifyReadback(new Map(),snapshot,'Save the note',inputs,async()=>{calls++;return {answers:{completion:{choice:'complete',confidence:1},read_0:{choice:'note',confidence:1}}};}),undefined);
  assert.equal(calls,0);
});
test('progress waits observe the same shortened long text as observation',async t=>{
  const page=await browser.newPage();await page.setContent(`<p id="long">Pending ${'x'.repeat(800)}</p>`);
  const observed=await capture(page,{maxElements:120,maxTexts:160});t.after(async()=>{await observed.dispose();await page.close();});
  assert.equal(observed.data.texts[0]?.truncated,true);
  await page.locator('#long').evaluate(node=>{node.textContent=node.textContent.replace('Pending','Saved');});
  assert.equal(await waitForRelevantChange(page,observed,250,new AbortController().signal),true);
});

test('an explicit scope that matches nothing fails with SCOPE_NOT_FOUND before any decision',async t=>{
  const {core,page}=await content(t,'<main><p id="total">Total 42</p><button>Save</button></main>');
  const scope='#missing',ref=(await core.snapshot()).elements[0].id;
  for(const [name,operation] of [
    ['compare ref',()=>core.compareSemantic({actual:{ref},expected:'Save'},{scope})],
    ['assert locator',()=>core.assertSemantic({actual:{locator:page.locator('#total')},expected:'Total 42'},{scope})],
    ['compare description',()=>core.compareSemantic({actual:{description:'Total'},expected:'Total 42'},{scope})],
    ['snapshot',()=>core.snapshot({scope})],
    ['observe',()=>core.observe('Click Save',{scope})],
    ['act',()=>core.act('Click Save',{scope})],
    ['extract',()=>core.extract('Read the total',z.object({total:z.string()}),{scope})],
    ['locate',()=>core.locateSemantic('The save button',{scope})],
  ])await assert.rejects(operation(),{code:'SCOPE_NOT_FOUND'},name);
});
test('a scope that matches only inside a child frame is observed there',async t=>{
  const {core}=await content(t,'<h1>Outside</h1><iframe srcdoc="<section id=inner><p>Inside</p></section>"></iframe>');
  const snapshot=await core.snapshot({scope:'#inner'});
  assert.deepEqual(snapshot.texts.map(source=>[source.text,source.frame]),[['Inside',1]]);
});
test('run keeps its stop semantics when its scope matches nothing',async t=>{
  const {core}=await content(t,'<button>Save</button>',engine(()=>'__none__'));
  const result=await core.run('Click Save',{scope:'#missing',settleTimeoutMs:50});
  assert.equal(result.status,'stopped');
});
test('MCP reports SCOPE_NOT_FOUND for a scope that matches nothing',async t=>{
  const page=await browser.newPage();await page.setContent('<p>Visible</p>');
  const core=new JevBrowser({page,engine:forbidden}),server=createMcpServer(core),client=new Client({name:'observation-tests',version:'1'});
  const [ct,st]=InMemoryTransport.createLinkedPair();
  t.after(async()=>{await client.close();await server.close();await core.close();await page.close();});
  await server.connect(st);await client.connect(ct);
  const result=await client.callTool({name:'browser_snapshot',arguments:{scope:'#missing'}});
  assert.equal(result.isError,true);
  assert.equal(JSON.parse(result.content.find(item=>item.type==='text').text).error.code,'SCOPE_NOT_FOUND');
});
