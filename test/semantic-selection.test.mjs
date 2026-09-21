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
