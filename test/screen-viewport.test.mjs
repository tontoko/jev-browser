import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {JevBrowser} from '../dist/index.js';
import {fixtureBrowser} from './helpers.mjs';

let browser;
before(async()=>{browser=await fixtureBrowser();});
after(async()=>{await browser?.close();});
const mobileUnsupported=process.env.JEV_BROWSER && process.env.JEV_BROWSER!=='chromium';
async function fixture(t,{mobile=true,meta=false,content}={}) {
  const context=await browser.newContext({viewport:{width:390,height:400},deviceScaleFactor:3,...(mobile?{isMobile:true,hasTouch:true}:{})});
  const page=await context.newPage(),core=new JevBrowser({page});
  t.after(async()=>{await core.close();await context.close();});
  await page.setContent((meta?'<meta name="viewport" content="width=device-width,initial-scale=1">':'')+
    '<style>body{margin:0}button,section{position:absolute;left:200px;top:200px;width:100px;height:100px;background:red;border:0}</style>'+
    (content??'<button onclick="this.textContent=\'Clicked\'">Target</button>'));
  return {core,page};
}

for(const [label,mobile,meta,pixel] of [['desktop',false,false,250],['mobile meta viewport',true,true,250],['mobile without meta viewport',true,false,100]]) {
  test(`screen clicks the image coordinates for ${label}`,{skip:mobile&&mobileUnsupported},async t=>{
    const {core,page}=await fixture(t,{mobile,meta});
    const observed=await core.screen({action:'look'});
    assert.deepEqual(observed.viewport,{width:390,height:400});
    await core.screen({action:'click',x:pixel,y:pixel,observationId:observed.observationId});
    assert.equal(await page.locator('button').textContent(),'Clicked');
  });
}

test('scaled screen move and drag use the same image-to-input coordinates',{skip:mobileUnsupported},async t=>{
  const {core,page}=await fixture(t,{content:'<button onpointerenter="this.textContent=\'Hovered\'" onpointerdown="window.dragging=true">Target</button><script>document.onpointerup=e=>{if(window.dragging&&Math.abs(e.clientX-400)<3)document.querySelector(\'button\').textContent=\'Dragged\'}</script>'});
  let observed=await core.screen({action:'look'});
  observed=await core.screen({action:'move',x:100,y:100,observationId:observed.observationId});
  assert.equal(await page.locator('button').textContent(),'Hovered');
  await core.screen({action:'drag',x:100,y:100,toX:159.2,toY:100,observationId:observed.observationId});
  assert.equal(await page.locator('button').textContent(),'Dragged');
});

test('scaled positioned scrolling reaches the panel visible at that image position',{skip:mobileUnsupported},async t=>{
  const {core,page}=await fixture(t,{content:'<section style="overflow:auto"><div style="height:2000px">Scrollable panel</div></section>'});
  const observed=await core.screen({action:'look'});
  await core.screen({action:'scroll',x:100,y:100,deltaX:0,deltaY:120,observationId:observed.observationId});
  await page.waitForFunction(()=>document.querySelector('section').scrollTop>0,undefined,{timeout:500});
  assert.equal(await page.evaluate(()=>scrollY),0);
});

test('a changed viewport scale rejects the old image before any click',{skip:mobileUnsupported},async t=>{
  const {core,page}=await fixture(t,{meta:true});
  const observed=await core.screen({action:'look'});
  await page.evaluate(()=>document.querySelector('meta').content='width=device-width,initial-scale=2');
  await page.waitForFunction(()=>visualViewport.scale===2);
  await assert.rejects(core.screen({action:'click',x:250,y:250,observationId:observed.observationId}),{code:'STALE_SCREEN'});
  assert.equal(await page.locator('button').textContent(),'Target');
});

test('screen frame sequences can observe changing scroll position',{skip:mobileUnsupported},async t=>{
  const {core,page}=await fixture(t,{meta:true,content:'<div style="height:3000px;background:linear-gradient(white,black)">Long journey</div>'});
  await page.evaluate(()=>{let count=0;function move(){scrollBy(0,20);if(++count<20)requestAnimationFrame(move);}requestAnimationFrame(move);});
  const observed=await core.screen({action:'look',capture:{frames:4,intervalMs:20}});
  assert.equal(observed.frames.length,4);
  assert.ok(new Set(observed.frames.map(frame=>frame.data)).size>1);
});

test('cancellation interrupts viewport reading while page JavaScript is paused',{skip:mobileUnsupported},async t=>{
  const {core,page}=await fixture(t,{meta:true});
  const observed=await core.screen({action:'look'});
  const session=await page.context().newCDPSession(page);
  await session.send('Debugger.enable');
  const paused=new Promise(resolve=>session.once('Debugger.paused',resolve));
  await session.send('Debugger.pause');
  const trigger=page.evaluate(()=>true);
  await paused;
  try {
    const abort=new AbortController();
    const pending=core.screen({action:'click',x:250,y:250,observationId:observed.observationId},{signal:abort.signal,timeoutMs:2500}).catch(error=>error);
    await delay(150);
    const started=performance.now();abort.abort();
    assert.equal((await pending).code,'SCREEN_FAILED');
    assert.ok(performance.now()-started<1200,'viewport geometry must not block cancellation');
  } finally { await session.send('Debugger.resume');await trigger;await session.detach(); }
  assert.equal(await page.locator('button').textContent(),'Target');
});
