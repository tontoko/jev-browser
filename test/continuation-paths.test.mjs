import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {fixtureBrowser} from './helpers.mjs';
import {privateFilter,flattenInputs} from '../dist/bindings.js';
import {continuationFixture,goal,values} from './continuation-fixture.mjs';
let browser;
before(async()=>{browser=await fixtureBrowser();});
after(async()=>{await browser?.close();});

test('continuation paths: value echoes cannot replace structural checkpoint paths',()=>{
  const filter=privateFilter(flattenInputs({email:'/email'}));
  const result=filter({checkpoints:[{inputPaths:['/email'],verification:{readback:['/email'],unobserved:[]}}],texts:[{text:'/email'}]});
  assert.deepEqual(result.checkpoints[0].inputPaths,['/email']);
  assert.deepEqual(result.checkpoints[0].verification.readback,['/email']);
  assert.equal(result.texts[0].text,'[input:/email]');
});

test('continuation paths: a literal equal to its path remains resumable',async t=>{
  const app=await continuationFixture(t,browser,{count:2});
  const first=await app.core.run(goal,{values:{email:'/email'},settleTimeoutMs:100});
  assert.equal(first.reason,'missing-input');
  assert.deepEqual(first.checkpoints[0].inputPaths,['/email']);
  const result=await app.core.resume(first.continuation.id,{values:{membershipCode:values.membershipCode}});
  assert.equal(result.status,'complete',JSON.stringify(result));
  assert.deepEqual(app.submissions.map(x=>x.stage),['account','membership']);
  assert.equal(app.submissions[0].data.a7,'/email');
});
