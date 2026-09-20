import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {fixtureBrowser} from './helpers.mjs';
import {continuationFixture,goal,values} from './continuation-fixture.mjs';
let browser;
before(async()=>{browser=await fixtureBrowser();});
after(async()=>{await browser?.close();});

test('continuation settling: default budget covers a slow second save without replay',async t=>{
  const app=await continuationFixture(t,browser,{onSave:async({stage})=>{
    if(stage==='membership')await delay(240);
  }});
  const result=await app.core.run(goal,{values});
  assert.equal(result.status,'complete',JSON.stringify(result));
  assert.deepEqual(app.submissions.map(x=>x.stage),['account','membership','reservation']);
  assert.deepEqual(app.submissions.map(x=>Object.values(x.data)[0]),Object.values(values));
  assert.equal(result.checkpoints.length,3);
});

test('continuation settling: an explicitly short wait retains an unknown commit for read-only resume',async t=>{
  let acknowledge;
  const submitted=new Promise(resolve=>{acknowledge=resolve;});
  const app=await continuationFixture(t,browser,{count:1,holdStage:0,onSave:()=>acknowledge()});
  const first=await app.core.run('Create and save the account once.',{values:{email:values.email},settleTimeoutMs:80});
  await submitted;
  assert.equal(first.reason,'effect-unknown');
  assert.equal(first.checkpoints?.length??0,0);
  assert.equal(first.continuation.pendingEffect,'commit');
  assert.deepEqual(app.submissions.map(x=>x.stage),['account']);
  const still=await app.core.resume(first.continuation.id);
  assert.equal(still.reason,'effect-unknown');
  assert.equal(app.submissions.length,1);
  await app.release();
  const result=await app.core.resume(still.continuation.id);
  assert.equal(result.status,'complete',JSON.stringify(result));
  assert.deepEqual(app.submissions.map(x=>x.stage),['account']);
  assert.equal(result.checkpoints.length,1);
});
