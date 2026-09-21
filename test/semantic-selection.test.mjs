import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {JevBrowser} from '../dist/index.js';
import {engine,fixtureBrowser,httpServer} from './helpers.mjs';
let browser;
before(async()=>{browser=await fixtureBrowser();});
after(async()=>{await browser?.close();});

export async function selectionFixture(t,options={}){
  const submissions=[];
  const opts=options.options??[{label:'Choose',value:''},{label:'日本',value:'JP'},{label:'ドイツ',value:'DE'}];
  const service=await httpServer(async(req,res)=>{
    if(req.url==='/save'){
      let raw='';for await(const chunk of req)raw+=chunk;const data=JSON.parse(raw);submissions.push(data);
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return;
    }
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`<h1>Address</h1><form><label>Country<select name="a9">${opts.map(o=>`<option value="${o.value}">${o.label}</option>`).join('')}</select></label><label>Private note<input name="b4"></label><button>Save</button></form><section id="result"></section><script>
      document.querySelector('form').onsubmit=async event=>{event.preventDefault();const form=event.target;const response=await fetch('/save',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});const data=await response.json();window.saved=data;if(!${!!options.omitResult}){const article=document.createElement('article');article.innerHTML='<h2>Address saved</h2><dl><dt>Country</dt><dd></dd></dl><dl><dt>Private note</dt><dd></dd></dl>';article.querySelectorAll('dd')[0].textContent=${JSON.stringify(options.resultCountry??'JP')};article.querySelectorAll('dd')[1].textContent=data.b4;form.remove();document.querySelector('#result').append(article);}};
    </script>`);
  });
  const decider=engine((q,r,id)=>{
    if(id.startsWith('bind_'))return r.state.page.elements.find(e=>e.name===(q.instructions.includes('"/country"')?'Country':'Private note'))?.id??'__none__';
    if(id.startsWith('effect_'))return r.state.actions?.[id.slice(7)]?.target?.name==='Save'?'commit':'advance';
    if(id==='action')return c=>c?.kind==='click'&&c.target?.name==='Save';
    if(id.startsWith('stage_input_'))return 'current';
    if(id.startsWith('selection_'))return options.choice??(Object.hasOwn(q.criteria,'option_1')?'option_1':'__none__');
    if(id==='completion')return 'complete';
    if(id.startsWith('read_'))return r.state.sources.find(s=>s.context.startsWith(q.instructions.includes('"/country"')?'Country ':'Private note '))?.id??'__none__';
    return '__none__';
  });
  const original=decider.decide.bind(decider);
  decider.decide=async(r,o)=>{const answer=await original(r,o);if(Object.keys(r.questions).some(id=>id.startsWith('selection_'))){
    for(const [id,a] of Object.entries(answer.answers))if(id.startsWith('selection_'))a.confidence=options.confidence??0.95;
    if(options.afterSelection)await options.afterSelection(page);
  }return answer;};
  const page=await browser.newPage();await page.goto(service.url);
  const core=new JevBrowser({page,engine:decider,...options.coreOptions});
  t.after(async()=>{await core.close();await page.close();await service.close();});
  return {core,page,submissions,decider};
}
const instruction='Set the supplied country and private note, then save once and verify the address.';
const values={country:'Japan',note:'private-note-42'};

test('selection: supplied but unresolved value is not missing caller data',async t=>{
  const f=await selectionFixture(t);
  const r=await f.core.run(instruction,{values});
  assert.equal(r.status,'stopped');assert.equal(r.reason,'unresolved-input');
  assert.equal(r.blockers[0].inputPath,'/country');assert.equal(r.blockers[0].target.name,'Country');
  assert.equal(r.blockers[0].reason,'semantic-permission-required');assert.equal(f.submissions.length,0);
  assert.ok(!f.decider.requests.some(r=>JSON.stringify(r).includes('Japan')));
});
test('selection: opt-in delegates representation to Jev and preserves a verified option identity',async t=>{
  const f=await selectionFixture(t);
  const r=await f.core.run(instruction,{values,semanticInputs:{'/country':0.8}});
  assert.equal(r.status,'complete',JSON.stringify(r));assert.equal(f.submissions.length,1);
  assert.equal(f.submissions[0].a9,'JP');assert.equal(f.submissions[0].b4,values.note);
  assert.equal(r.inputs.find(i=>i.path==='/country').resolution.confidence,0.95);
  assert.deepEqual(r.verification.semanticInputs,['/country']);
  const calls=f.decider.requests.filter(r=>Object.keys(r.questions).some(id=>id.startsWith('selection_')));
  assert.equal(calls.length,1);assert.deepEqual(calls[0].state.suppliedSelections,{'/country':'Japan'});
  assert.ok(!f.decider.requests.some(r=>JSON.stringify(r).includes(values.note)));
  assert.ok(f.decider.requests.filter(r=>!Object.keys(r.questions).some(id=>id.startsWith('selection_'))).every(r=>!JSON.stringify(r).includes('Japan')));
});
for(const [choice,confidence,reason] of [['__none__',0.99,'no-match'],['__ambiguous__',0.99,'ambiguous'],['option_1',0.3,'low-confidence']])test('selection refuses '+reason,async t=>{
  const f=await selectionFixture(t,{choice,confidence});
  const r=await f.core.run(instruction,{values,semanticInputs:{'/country':0.8}});
  assert.equal(r.reason,'unresolved-input');assert.equal(r.blockers[0].reason,reason);assert.equal(f.submissions.length,0);
});
test('selection: exact label or value does not disclose other named inputs',async t=>{
  const f=await selectionFixture(t);
  const r=await f.core.run(instruction,{values:{...values,country:'JP'},semanticInputs:{'/country':0.8}});
  assert.equal(r.status,'complete');assert.equal(f.submissions.length,1);
  assert.ok(!f.decider.requests.some(r=>Object.keys(r.questions).some(id=>id.startsWith('selection_'))));
});
test('selection: incorrect saved mapped value is not verified',async t=>{
  const f=await selectionFixture(t,{resultCountry:'DE'});
  const r=await f.core.run(instruction,{values,semanticInputs:{'/country':0.8},settleTimeoutMs:150});
  assert.equal(r.status,'unverified');assert.equal(f.submissions.length,1);
});
test('selection: only opted-in current selections may be disclosed',async t=>{
  const f=await selectionFixture(t);
  const r=await f.core.run(instruction,{values,semanticInputs:{'/note':0.8}});
  assert.equal(r.reason,'unresolved-input');assert.equal(f.submissions.length,0);
  assert.ok(!f.decider.requests.some(r=>JSON.stringify(r).includes(values.note)||JSON.stringify(r).includes(values.country)));
});
test('selection: malformed permission or threshold fails before browser/provider work',async t=>{
  const f=await selectionFixture(t);
  for(const semanticInputs of [{country:0.8},{'/country':2},{'/country':-1},{'/country':NaN},true,['/country']]){
    await assert.rejects(f.core.run(instruction,{values,semanticInputs}),{code:'INVALID_ARGUMENT'});
  }
  assert.equal(f.decider.requests.length,0);assert.equal(f.submissions.length,0);
});
test('selection: unknown save retains the semantic mapping for read-only resume',async t=>{
  const f=await selectionFixture(t,{omitResult:true});
  const first=await f.core.run(instruction,{values,semanticInputs:{'/country':0.8},settleTimeoutMs:150});
  assert.equal(first.reason,'effect-unknown');assert.equal(f.submissions.length,1);
  await f.page.evaluate(()=>{document.querySelector('form').remove();document.querySelector('#result').innerHTML='<article><h2>Address saved</h2><dl><dt>Country</dt><dd>JP</dd></dl></article>';});
  const resumed=await f.core.resume(first.continuation.id);
  assert.equal(resumed.status,'complete',JSON.stringify(resumed));assert.equal(f.submissions.length,1);
  assert.deepEqual(resumed.verification.semanticInputs,['/country']);
});
