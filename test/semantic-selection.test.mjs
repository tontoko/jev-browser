import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {JevBrowser} from '../dist/index.js';
import {engine,fixtureBrowser} from './helpers.mjs';
import {selectionFixture} from './selection-fixture.mjs';
let browser;
before(async()=>{browser=await fixtureBrowser();});
after(async()=>{await browser?.close();});

const instruction='Set the supplied country and private note, then save once and verify the address.';
const values={country:'Japan',note:'private-note-42'};

test('selection: supplied but unresolved value is not missing caller data',async t=>{
  const f=await selectionFixture(t,browser);
  const r=await f.core.run(instruction,{values});
  assert.equal(r.status,'stopped');assert.equal(r.reason,'unresolved-input');
  assert.equal(r.blockers[0].inputPath,'/country');assert.equal(r.blockers[0].target.name,'Country');
  assert.equal(r.blockers[0].reason,'semantic-permission-required');assert.equal(f.submissions.length,0);
  assert.ok(!f.decider.requests.some(r=>JSON.stringify(r).includes('Japan')));
});
test('selection: opt-in delegates representation to Jev and preserves a verified option identity',async t=>{
  const f=await selectionFixture(t,browser);
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
  const f=await selectionFixture(t,browser,{choice,confidence});
  const r=await f.core.run(instruction,{values,semanticInputs:{'/country':0.8}});
  assert.equal(r.reason,'unresolved-input');assert.equal(r.blockers[0].reason,reason);assert.equal(f.submissions.length,0);
});
test('selection: exact label or value does not disclose other named inputs',async t=>{
  const f=await selectionFixture(t,browser);
  const r=await f.core.run(instruction,{values:{...values,country:'JP'},semanticInputs:{'/country':0.8}});
  assert.equal(r.status,'complete');assert.equal(f.submissions.length,1);
  assert.ok(!f.decider.requests.some(r=>Object.keys(r.questions).some(id=>id.startsWith('selection_'))));
});
test('selection: incorrect saved mapped value is not verified',async t=>{
  const f=await selectionFixture(t,browser,{resultCountry:'DE'});
  const r=await f.core.run(instruction,{values,semanticInputs:{'/country':0.8},settleTimeoutMs:150});
  assert.equal(r.status,'unverified');assert.equal(f.submissions.length,1);
});
test('selection: only opted-in current selections may be disclosed',async t=>{
  const f=await selectionFixture(t,browser);
  const r=await f.core.run(instruction,{values,semanticInputs:{'/note':0.8}});
  assert.equal(r.reason,'unresolved-input');assert.equal(f.submissions.length,0);
  assert.ok(!f.decider.requests.some(r=>JSON.stringify(r).includes(values.note)||JSON.stringify(r).includes(values.country)));
});
test('selection: malformed permission or threshold fails before browser/provider work',async t=>{
  const f=await selectionFixture(t,browser);
  for(const semanticInputs of [{country:0.8},{'/country':2},{'/country':-1},{'/country':NaN},true,['/country']]){
    await assert.rejects(f.core.run(instruction,{values,semanticInputs}),{code:'INVALID_ARGUMENT'});
  }
  assert.equal(f.decider.requests.length,0);assert.equal(f.submissions.length,0);
});
test('selection: unknown save retains the semantic mapping for read-only resume',async t=>{
  const f=await selectionFixture(t,browser,{omitResult:true});
  const first=await f.core.run(instruction,{values,semanticInputs:{'/country':0.8},settleTimeoutMs:150});
  assert.equal(first.reason,'effect-unknown');assert.equal(f.submissions.length,1);
  await f.page.evaluate(()=>{document.querySelector('form').remove();document.querySelector('#result').innerHTML='<article><h2>Address saved</h2><dl><dt>Country</dt><dd>JP</dd></dl></article>';});
  const resumed=await f.core.resume(first.continuation.id);
  assert.equal(resumed.status,'complete',JSON.stringify(resumed));assert.equal(f.submissions.length,1);
  assert.deepEqual(resumed.verification.semanticInputs,['/country']);
});

test('missing-data diagnosis identifies a grounded control without guessing values',async t=>{
  const page=await browser.newPage();await page.setContent('<form><label>Reservation time<input required></label><button>Save</button></form>');
  const decider=engine((q,r,id)=>id==='blocker'?'missing':id==='blocker_field'?r.state.page.elements.find(e=>e.name==='Reservation time').id:id.startsWith('effect_')?'commit':'__none__');
  const core=new JevBrowser({page,engine:decider});t.after(async()=>{await core.close();await page.close();});
  const result=await core.run('Create a reservation. Ask for any missing time.',{settleTimeoutMs:120});
  assert.equal(result.reason,'missing-input');
  assert.equal(result.blockers[0].target.name,'Reservation time');
  assert.equal(result.blockers[0].reason,'missing-value');
});

test('selection: long lists keep distant options and batch all partitions',async t=>{
  const options=[{label:'Choose',value:''},...Array.from({length:998},(_,index)=>({label:`Option ${index}`,value:`v${index}`})),{label:'日本',value:'JP'}];
  const f=await selectionFixture(t,browser,{options});
  const base=f.decider.decide.bind(f.decider);
  f.decider.decide=async(r,o)=>{
    if(!Object.keys(r.questions).some(id=>id.startsWith('selection_')))return base(r,o);
    f.decider.requests.push(structuredClone(r));
    return {answers:Object.fromEntries(Object.entries(r.questions).map(([id,q])=>[id,{choice:Object.hasOwn(q.criteria,'option_999')?'option_999':'__none__',confidence:0.95}]))};
  };
  const r=await f.core.run(instruction,{values,semanticInputs:{'/country':0.8}});
  assert.equal(r.status,'complete',JSON.stringify(r));assert.equal(f.submissions.length,1);assert.equal(f.submissions[0].a9,'JP');
  const calls=f.decider.requests.filter(r=>Object.keys(r.questions).some(id=>id.startsWith('selection_')));
  assert.equal(calls.length,1);assert.equal(Object.keys(calls[0].questions).length,16);
});
test('selection: native multiselect values are semantically resolved independently',async t=>{
  const page=await browser.newPage();await page.setContent('<form><label>Countries<select multiple><option value="JP">日本</option><option value="DE">ドイツ</option></select></label><button>Save</button></form>');
  await page.evaluate(()=>document.querySelector('form').onsubmit=e=>{e.preventDefault();window.saved=[...document.querySelector('select').selectedOptions].map(o=>o.value);});
  const decider=engine((q,r,id)=>id.startsWith('bind_')?r.state.page.elements.find(e=>e.tag==='select').id:id.startsWith('effect_')?'commit':id.startsWith('selection_')?id.startsWith('selection_0_0_')?'option_0':'option_1':id==='action'?c=>c?.kind==='click'&&c.target?.name==='Save':'__none__');
  const core=new JevBrowser({page,engine:decider});t.after(async()=>{await core.close();await page.close();});
  const r=await core.run('Select the supplied countries and Save once.',{values:{countries:['Japan','Germany']},semanticInputs:{'/countries':0.8},until:page=>page.evaluate(()=>window.saved?.join(',')==='JP,DE')});
  assert.equal(r.status,'complete');assert.deepEqual(await page.evaluate(()=>window.saved),['JP','DE']);
});
test('selection: unsupported or denied writes never execute a Save',async t=>{
  const f=await selectionFixture(t,browser,{coreOptions:{allowCommand:command=>command.command!=='select_option'}});
  await assert.rejects(f.core.run(instruction,{values,semanticInputs:{'/country':0.8}}),{code:'ACTION_DENIED'});
  assert.equal(f.submissions.length,0);
});
test('selection: permission is copied before asynchronous decisions',async t=>{
  const policy={'/country':0.8};
  const f=await selectionFixture(t,browser);const decide=f.decider.decide.bind(f.decider);
  f.decider.decide=async(r,o)=>{delete policy['/country'];return decide(r,o);};
  const r=await f.core.run(instruction,{values,semanticInputs:policy});
  assert.equal(r.status,'complete');assert.equal(f.submissions.length,1);
});
