import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { JevBrowser } from '../dist/index.js';
import { fixtureBrowser, engine } from './helpers.mjs';
let browser;
before(async()=>{browser=await fixtureBrowser();});
after(async()=>{await browser?.close();});
async function fixture(t,html='<p>No amount supplied</p>',options={}){
  const page=await browser.newPage();await page.setContent(html);
  const decider=engine(()=> '__none__');
  const core=new JevBrowser({page,engine:decider,...options});
  t.after(async()=>{await core.close();await page.close();});return {core,page,decider};
}
test('a cancelled completion check cannot report verified success',async t=>{
  const abort=new AbortController();
  const {core}=await fixture(t);
  await assert.rejects(core.run('Verify saved',{signal:abort.signal,until:async()=>{
    abort.abort();return true;
  }}));
});
test('only literal true from the completion check verifies a run',async t=>{
  const {core}=await fixture(t,'<p>Pending</p>',{engine:engine(()=> '__done__')});
  const result=await core.run('Save',{until:async()=>({complete:false})});
  assert.notEqual(result.status,'complete');
});
test('extraction never manufactures an absent value from a schema default',async t=>{
  const {core,decider}=await fixture(t);
  await assert.rejects(core.extract('Amount',z.object({amount:z.number().default(999)})),{code:'UNSUPPORTED_SCHEMA'});
  assert.equal(decider.requests.length,0);
});
test('extraction never manufactures an absent value from a schema catch',async t=>{
  const {core,decider}=await fixture(t);
  await assert.rejects(core.extract('Amount',z.object({amount:z.number().catch(999)})),{code:'UNSUPPORTED_SCHEMA'});
  assert.equal(decider.requests.length,0);
});

test('authorization requires literal true rather than a truthy object',async t=>{
  const {core,page}=await fixture(t,'<button onclick="this.dataset.saved=1">Save</button>',{
    engine:engine(()=>c=>c?.kind==='click'),allowAction:()=>({allowed:false}),
  });
  await assert.rejects(core.act('Save'),{code:'ACTION_DENIED'});
  assert.equal(await page.locator('button').getAttribute('data-saved'),null);
});
test('nested heading markup retains a complete grounded heading source',async t=>{
  const {core}=await fixture(t,'<h1><span>Invoice </span><span>INV-042</span></h1>');
  const snapshot=await core.snapshot();
  assert.ok(snapshot.texts.some(s=>s.role==='heading'&&s.text==='Invoice INV-042'));
});
test('nullable optional catch cannot fabricate a value from invalid source text',async t=>{
  const {core}=await fixture(t,'<p>Amount unavailable</p>',{engine:engine(()=>c=>c?.value==='Amount unavailable')});
  await assert.rejects(core.extract('Amount',z.object({amount:z.number().optional().nullable().catch(999)})),{code:'UNSUPPORTED_SCHEMA'});
});
test('scalar schema normalization cannot silently change copied evidence',async t=>{
  const {core}=await fixture(t,'<h1>Invoice</h1>',{engine:engine(()=>c=>c?.value==='Invoice')});
  await assert.rejects(core.extract('Title',z.object({title:z.string().toUpperCase()})),{code:'UNSUPPORTED_SCHEMA'});
});
test('cancellation during navigation cannot return successful navigation',async t=>{
  const abort=new AbortController();const {core,page}=await fixture(t);
  await page.route('https://navigation.example.invalid/',async route=>{
    abort.abort();await route.fulfill({contentType:'text/html',body:'<p>Arrived</p>'});
  });
  await assert.rejects(core.goto('https://navigation.example.invalid/',{signal:abort.signal}));
});
test('cancelling a blocked click prevents a later click when the cover disappears',async t=>{
  const abort=new AbortController();let timer;
  const {core,page}=await fixture(t,'<button onclick="document.body.dataset.saved=1">Save</button><div id="cover" style="position:fixed;inset:0;z-index:99"></div>',{
    engine:engine(()=>c=>c?.kind==='click'),timeoutMs:2000,
    allowAction:async()=>{
      await page.evaluate(()=>setTimeout(()=>document.getElementById('cover')?.remove(),400));
      timer=setTimeout(()=>abort.abort(),75);return true;
    },
  });
  t.after(()=>clearTimeout(timer));
  await assert.rejects(core.act('Save',{signal:abort.signal}));
  await page.waitForFunction(()=>!document.getElementById('cover'),null,{timeout:2000});
  assert.equal(await page.locator('body').getAttribute('data-saved'),null);
});
test('a changed base URL invalidates the actual destination of an observed link',async t=>{
  const {core,page}=await fixture(t,'<base href="https://first.example.invalid/"><a href="/save" onclick="event.preventDefault();document.body.dataset.hit=1">Save</a>',{
    engine:engine(()=>c=>c?.kind==='click'),
  });
  const plan=await core.observe('Save');
  await page.locator('base').evaluate(el=>{el.href='https://second.example.invalid/';});
  await assert.rejects(core.act(plan),{code:'STALE_TARGET'});
  assert.equal(await page.locator('body').getAttribute('data-hit'),null);
});

for (const [label,text] of [['yen suffix','12,800円'],['full-width digits','￥１２，８００']]) {
  test(`Japanese currency ${label} is normalized from grounded text`,async t=>{
    const {core}=await fixture(t,`<dl><dt>合計</dt><dd>${text}</dd></dl>`,{engine:engine(()=>c=>c?.value===12800)});
    const result=await core.extract('合計金額',z.object({total:z.number()}));
    assert.equal(result.data.total,12800);assert.equal(result.evidence.total.text,text);
  });
}
test('missing optional and nullable fields still remain absent rather than invented',async t=>{
  const {core}=await fixture(t);
  const result=await core.extract('Amounts',z.object({optional:z.number().optional(),nullable:z.number().nullable()}));
  assert.deepEqual(result.data,{nullable:null});assert.deepEqual(result.evidence,{});
});
test('a commit-classified confirmation opener hands the changed screen back instead of ending condition-unmet',async t=>{
  const page=await browser.newPage();
  await page.setContent(`<p>Lesson end review</p>
    <button id="open" type="button">End lesson</button>
    <div id="confirm" hidden><p>End this lesson?</p><button id="confirm-save" type="button">Confirm</button></div>
    <script>
      window.saved=false;
      document.getElementById('open').addEventListener('click',()=>{document.getElementById('confirm').hidden=false;});
      document.getElementById('confirm-save').addEventListener('click',()=>{window.saved=true;document.getElementById('confirm').hidden=true;});
    </script>`);
  const decider=engine((question,request,name)=>{
    if(name==='action')return candidate=>candidate?.kind==='click'&&candidate.target?.name===(decider.requests.length>1?'Confirm':'End lesson');
    if(name.startsWith('effect_'))return request.state.actions?.[name.slice('effect_'.length)]?.target?.name==='End lesson'?'commit':'advance';
    return '__none__';
  });
  const core=new JevBrowser({page,engine:decider});
  t.after(async()=>{await core.close();await page.close();});
  const result=await core.run('End the lesson.',{settleTimeoutMs:250,timeoutMs:6000,until:page=>page.evaluate(()=>window.saved===true)});
  assert.equal(result.status,'complete');
  assert.equal(await page.evaluate(()=>window.saved),true);
});
test('repeated unproductive confirmation openers stay bounded by the step budget',async t=>{
  const page=await browser.newPage();
  await page.setContent('<button id="open" type="button">Save</button>');
  const decider=engine((question,request,name)=>{
    if(name==='action')return candidate=>candidate?.kind==='click'&&candidate.target?.name==='Save';
    if(name.startsWith('effect_'))return 'commit';
    return '__none__';
  });
  const core=new JevBrowser({page,engine:decider});
  t.after(async()=>{await core.close();await page.close();});
  const result=await core.run('Save once.',{settleTimeoutMs:150,timeoutMs:6000,maxSteps:3,until:()=>false});
  assert.equal(result.status,'stopped');
  assert.equal(result.reason,'step-limit');
});
test('a submit chosen before quoted inputs are filled is sent back once, then the fields fill and the form saves',async t=>{
  const page=await browser.newPage();
  await page.setContent(`<form id="f"><label>Your name<input name="name" required></label>
    <label>Email address<input name="email" type="email" required></label><button>Get tickets</button></form><p id="out"></p>
    <script>document.getElementById('f').onsubmit=e=>{e.preventDefault();document.getElementById('out').textContent='saved '+new FormData(e.target).get('name');};</script>`);
  const decider=engine((question,request,name)=>{
    if(name.startsWith('effect_'))return request.state.actions?.[name.slice('effect_'.length)]?.target?.name==='Get tickets'?'commit':'advance';
    if(name!=='action')return '__none__';
    const filled=new Set(request.state.history.filter(step=>step.kind==='fill').map(step=>step.target?.name));
    const premature=!decider.requests.some(r=>r.state.submitRefused);
    return candidate=>{
      if(premature)return candidate?.kind==='click'&&candidate.target?.name==='Get tickets';
      if(!filled.has('Your name'))return candidate?.kind==='fill'&&candidate.target?.name==='Your name'&&candidate.valueKey==='quoted_0';
      if(!filled.has('Email address'))return candidate?.kind==='fill'&&candidate.target?.name==='Email address'&&candidate.valueKey==='quoted_1';
      return candidate?.kind==='click'&&candidate.target?.name==='Get tickets';
    };
  });
  const core=new JevBrowser({page,engine:decider});
  t.after(async()=>{await core.close();await page.close();});
  const result=await core.run('Book in the name "Mika" (the first quoted value) with "mika@example.test" (the second quoted value).',{settleTimeoutMs:250,timeoutMs:8000,until:page=>page.evaluate(()=>document.getElementById('out').textContent==='saved Mika')});
  assert.equal(result.status,'complete');
  assert.ok(decider.requests.some(request=>request.state.submitRefused?.form==='invalid'));
});
test('a second premature submit with no step between still stops missing-input',async t=>{
  const page=await browser.newPage();
  await page.setContent('<form><label>Your name<input name="name" required></label><button>Get tickets</button></form>');
  const decider=engine((question,request,name)=>{
    if(name.startsWith('effect_'))return 'commit';
    if(name==='action')return candidate=>candidate?.kind==='click'&&candidate.target?.name==='Get tickets';
    return '__none__';
  });
  const core=new JevBrowser({page,engine:decider});
  t.after(async()=>{await core.close();await page.close();});
  const result=await core.run('Book in the name "Mika".',{settleTimeoutMs:150,timeoutMs:6000,until:()=>false});
  assert.equal(result.status,'stopped');
  assert.equal(result.reason,'missing-input');
  assert.equal(decider.requests.filter(request=>request.state.submitRefused).length>=1,true);
});
