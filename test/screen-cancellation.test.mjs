import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {JevBrowser} from '../dist/index.js';
import {fixtureBrowser,httpServer} from './helpers.mjs';

let browser;
before(async()=>{browser=await fixtureBrowser();});
after(async()=>{await browser?.close();});
const timeoutMs=2500, promptMs=1200;

async function heldFont(t,viewport={width:420,height:320}) {
  let requested;
  const fontRequested=new Promise(resolve=>{requested=resolve;});
  const site=await httpServer((req,res)=>{
    if(req.url==='/held.woff2'){requested();return;}
    res.setHeader('content-type','text/html');
    res.end('<button style="position:absolute;left:20px;top:20px;width:160px;height:50px" onclick="this.textContent=\'Clicked\'">Ready</button>');
  });
  const context=await browser.newContext({viewport}),page=await context.newPage();
  const core=new JevBrowser({page});
  t.after(async()=>{await core.close();await context.close();await site.close();});
  await page.goto(site.url);
  return {core,page,async startFont(){
    await page.evaluate(url=>{
      const font=new FontFace('held',`url("${url}/held.woff2")`);
      document.fonts.add(font);document.body.style.fontFamily='held';
      void font.load().catch(()=>{});
    },site.url);
    await fontRequested;
    assert.equal(await page.evaluate(()=>document.fonts.status),'loading');
  }};
}

test('aborting a screen look interrupts an actual font-blocked screenshot',async t=>{
  const {core,startFont}=await heldFont(t);await startFont();
  const abort=new AbortController();
  const pending=core.screen({action:'look'},{signal:abort.signal,timeoutMs}).catch(error=>error);
  await delay(150);
  const started=performance.now();abort.abort();
  const error=await pending;
  assert.equal(error.code,'SCREEN_FAILED');
  assert.ok(performance.now()-started<promptMs,'capture must stop on cancellation instead of waiting for its timeout');
});

test('closing a borrowed screen session interrupts its font-blocked capture without closing the Page',async t=>{
  const {core,page,startFont}=await heldFont(t);await startFont();
  const pending=core.screen({action:'look'},{timeoutMs}).catch(error=>error);
  await delay(150);
  const started=performance.now();await core.close();
  assert.ok(performance.now()-started<promptMs,'close must cancel and drain the capture promptly');
  assert.equal((await pending).code,'SCREEN_FAILED');assert.equal(page.isClosed(),false);
});

test('cancellation also interrupts the viewport freshness capture before sending input',async t=>{
  const {core,page,startFont}=await heldFont(t,null);
  const observed=await core.screen({action:'look'});await startFont();
  const abort=new AbortController();
  const pending=core.screen({action:'click',x:70,y:45,observationId:observed.observationId},{signal:abort.signal,timeoutMs}).catch(error=>error);
  await delay(150);
  const started=performance.now();abort.abort();
  const error=await pending;
  assert.equal(error.code,'SCREEN_FAILED');
  assert.ok(performance.now()-started<promptMs,'the viewport freshness capture must honor cancellation');
  assert.equal(await page.locator('button').textContent(),'Ready');
});

for(const action of ['back','forward','reload']) {
  test(`aborting screen ${action} interrupts a held navigation response`,async t=>{
    let heldPath,requested;
    const navigationRequested=new Promise(resolve=>{requested=resolve;});
    const site=await httpServer((req,res)=>{
      if(req.url===heldPath){requested();return;}
      res.setHeader('content-type','text/html');res.setHeader('cache-control','no-store');
      res.end('<p>'+req.url+'</p>');
    });
    const context=await browser.newContext(),page=await context.newPage(),core=new JevBrowser({page});
    t.after(async()=>{await core.close();await context.close();await site.close();});
    await page.goto(site.url+'/first');
    if(action!=='reload')await page.goto(site.url+'/second');
    if(action==='forward')await page.goBack();
    const observed=await core.screen({action:'look'});
    heldPath=action==='forward'?'/second':'/first';
    const abort=new AbortController();
    const pending=core.screen({action,observationId:observed.observationId},{signal:abort.signal,timeoutMs}).catch(error=>error);
    await navigationRequested;
    const started=performance.now();abort.abort();
    const error=await pending;
    assert.equal(error.code,'SCREEN_INTERRUPTED');
    assert.ok(performance.now()-started<promptMs,'an in-flight navigation must honor cancellation');
  });
}
