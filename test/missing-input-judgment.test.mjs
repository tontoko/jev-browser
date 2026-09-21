import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {fixtureBrowser} from './helpers.mjs';
import {JevBrowser} from '../dist/index.js';
import {wizardFixture} from './wizard-fixture.mjs';
import {formEngine} from './goal-fixture.mjs';
import {continuationFixture,stagedDecider,goal,values} from './continuation-fixture.mjs';
let browser;
before(async()=>{browser=await fixtureBrowser();});
after(async()=>{await browser?.close();});

test('goal judgment: Jev can identify a missing later-stage value without attempting a save',async t=>{
  const base=stagedDecider();let missingQuestions=0;
  const decider={async decide(request,options){
    if(request.questions.blocker){missingQuestions++;assert.deepEqual(request.state.inputs.map(input=>input.path),['/email']);return {answers:{blocker:{choice:'missing',confidence:0.99}}};}
    const result=await base.decide(request,options);
    if(request.questions.action&&request.state.page.elements.some(e=>e.name==='Membership code')&&!request.state.inputs.some(input=>input.path==='/membershipCode')){
      assert.deepEqual(request.state.inputs.map(input=>input.path),['/email']);
      result.answers.action={choice:'__none__',confidence:0.99};
    }
    return result;
  }};
  const app=await continuationFixture(t,browser,{decider});
  const first=await app.core.run(goal,{values:{email:values.email}});
  assert.equal(first.reason,'missing-input',JSON.stringify(first));
  assert.equal(first.status,'stopped');assert.equal(missingQuestions,1);
  assert.deepEqual(app.submissions.map(x=>x.stage),['account']);assert.ok(first.continuation?.id);
  const resumed=await app.core.resume(first.continuation.id,{values:{membershipCode:values.membershipCode,reservationReference:values.reservationReference}});
  assert.equal(resumed.status,'complete');
  assert.deepEqual(app.submissions.map(x=>x.stage),['account','membership','reservation']);
});

test('goal judgment: a missing-data judgment cannot override a satisfied caller oracle',async t=>{
  const page=await browser.newPage();await page.setContent('<p>Pending</p><button>Save</button>');
  const decider={async decide(request){
    if(request.questions.blocker){await page.locator('p').evaluate(node=>{node.textContent='Done';});return {answers:{blocker:{choice:'missing',confidence:1}}};}
    return {answers:Object.fromEntries(Object.keys(request.questions).map(id=>[id,{choice:id==='action'?'__none__':'commit',confidence:1}]))};
  }};
  const core=new JevBrowser({page,engine:decider});t.after(async()=>{await core.close();await page.close();});
  const result=await core.run('Save when needed',{settleTimeoutMs:20,until:async page=>(await page.locator('p').textContent())==='Done'});
  assert.equal(result.status,'complete');assert.equal(result.reason,'verified');assert.deepEqual(result.steps,[]);
});

test('goal judgment: unavailable action is not relabeled as missing data by form heuristics',async t=>{
  const page=await browser.newPage();await page.setContent('<form><label>Code<input required></label><button>Save</button></form>');
  const core=new JevBrowser({page,engine:{async decide(request){if(request.questions.blocker)return {answers:{blocker:{choice:'__none__',confidence:1}}};return {answers:Object.fromEntries(Object.keys(request.questions).map(id=>[id,{choice:id==='action'?'__none__':'commit',confidence:1}]))};}}});
  t.after(async()=>{await core.close();await page.close();});
  const result=await core.run('Open the unrelated inventory screen',{settleTimeoutMs:20});
  assert.equal(result.reason,'no-match');assert.deepEqual(result.steps,[]);
});

test('goal judgment: available actions do not compete with a missing-data diagnosis',async t=>{
  const base=stagedDecider();const decider={async decide(request,options){
    assert.equal(request.questions.blocker,undefined);
    if(request.questions.action)assert.equal(Object.hasOwn(request.questions.action.criteria,'__missing__'),false);
    return base.decide(request,options);
  }};
  const app=await continuationFixture(t,browser,{decider});
  const result=await app.core.run(goal,{values});
  assert.equal(result.status,'complete');assert.deepEqual(app.submissions.map(x=>x.stage),['account','membership','reservation']);
});

test('goal judgment: a no-action verdict made before new input effects is reconsidered on their resulting state',async t=>{
  const app=await wizardFixture(t,browser);await app.core.close();
  const base=formEngine();let preliminaryStops=0;
  const core=new JevBrowser({page:app.page,engine:{async decide(request,options){
    const result=await base.decide(request,options);
    if(request.questions.action&&request.state.page.elements.some(element=>element.name==='Contact email')&&request.state.inputs.some(input=>input.path==='/email'&&!input.applied)){
      result.answers.action={choice:'__none__',confidence:0.9};preliminaryStops++;
    }
    return result;
  }}});
  t.after(()=>core.close());
  const result=await core.run('Create the contact with name, Next, email, then Save.',{values:{name:'New contact',email:'progress@example.invalid'}});
  assert.equal(result.status,'complete',JSON.stringify(result));assert.equal(preliminaryStops,1);
  assert.equal(app.attempts.length,1);
  assert.deepEqual(app.records,[{'/name':'New contact','/email':'progress@example.invalid'}]);
});
