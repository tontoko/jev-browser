import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {JevDecisionEngine} from '../dist/index.js';
import {fixtureBrowser} from './helpers.mjs';
import {continuationFixture,goal,values} from './continuation-fixture.mjs';
const available=!!(process.env.JEV_API_KEY||process.env.TYPESAFE_API_KEY||process.env.JEV_BASE_URL);
let browser;
before(async()=>{if(available)browser=await fixtureBrowser();});
after(async()=>{await browser?.close();});

function verify(app){
  assert.deepEqual(app.submissions.map(x=>x.stage),['account','membership','reservation']);
  assert.deepEqual(app.submissions.map(x=>Object.values(x.data)[0]),Object.values(values));
}
function report(name,start,results,app){
  const keys=['requests','questions','serialDecisionDepth','providerMs'];
  console.log(JSON.stringify({case:name,status:results.at(-1).status,submissions:app.submissions.length,checkpoints:results.at(-1).checkpoints?.length,totalMs:Math.round(performance.now()-start),usage:Object.fromEntries(keys.map(key=>[key,results.reduce((n,r)=>n+(r.usage?.[key]??0),0)])),models:[...new Set(results.flatMap(r=>r.steps.map(s=>s.plan.decision.model).filter(Boolean)))]}));
}
const options={timeout:90000,skip:!available};

test('real provider: three independent commits from one goal and all supplied values',options,async t=>{
  const app=await continuationFixture(t,browser,{decider:new JevDecisionEngine()});const start=performance.now();
  const result=await app.core.run(goal,{values,timeoutMs:60000,expect:{target:'#final',property:'text',expected:'Ready'}});
  assert.equal(result.status,'complete',JSON.stringify(result));assert.equal(result.checkpoints.length,3);verify(app);report('three-commits',start,[result],app);
});

test('real provider: missing later input resumes without recreating verified work',options,async t=>{
  const app=await continuationFixture(t,browser,{decider:new JevDecisionEngine()});const start=performance.now();
  const first=await app.core.run(goal,{values:{email:values.email},timeoutMs:60000});
  assert.equal(first.reason,'missing-input',JSON.stringify(first));assert.ok(first.continuation?.id);assert.equal(app.submissions.length,1);
  const second=await app.core.resume(first.continuation.id,{values:{membershipCode:values.membershipCode,reservationReference:values.reservationReference}});
  assert.equal(second.status,'complete',JSON.stringify(second));assert.equal(second.checkpoints.length,3);verify(app);report('missing-input-resume',start,[first,second],app);
});

test('real provider: second commit remains unknown until read-only reconciliation',options,async t=>{
  const app=await continuationFixture(t,browser,{decider:new JevDecisionEngine(),holdStage:1});const start=performance.now();
  const first=await app.core.run(goal,{values,timeoutMs:60000,settleTimeoutMs:250});
  assert.equal(first.reason,'effect-unknown',JSON.stringify(first));assert.equal(first.continuation?.pendingEffect,'commit');assert.equal(app.submissions.length,2);
  const unresolved=await app.core.resume(first.continuation.id);
  assert.equal(unresolved.reason,'effect-unknown');assert.equal(app.submissions.length,2);
  await app.release();
  const second=await app.core.resume(first.continuation.id);
  assert.equal(second.status,'complete',JSON.stringify(second));assert.equal(second.checkpoints.length,3);verify(app);report('unknown-second-commit',start,[first,unresolved,second],app);
});

test('real provider: cancelling a sent second commit preserves a resumable partial',options,async t=>{
  const abort=new AbortController();
  const app=await continuationFixture(t,browser,{decider:new JevDecisionEngine(),onSave:({stage})=>{if(stage==='membership')abort.abort();}});const start=performance.now();let partial;
  await assert.rejects(app.core.run(goal,{values,signal:abort.signal,timeoutMs:60000}),error=>{partial=error.partial;return true;});
  assert.equal(partial?.continuation?.pendingEffect,'commit');assert.equal(app.submissions.length,2);
  await app.page.getByRole('heading',{name:'Membership created',exact:true}).waitFor();
  const result=await app.core.resume(partial.continuation.id);
  assert.equal(result.status,'complete',JSON.stringify(result));assert.equal(result.checkpoints.length,3);verify(app);report('cancelled-second-commit',start,[partial,result],app);
});
