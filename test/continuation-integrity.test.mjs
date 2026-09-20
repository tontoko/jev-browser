import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {fixtureBrowser,engine,httpServer} from './helpers.mjs';
import {JevBrowser} from '../dist/index.js';
import {privateFilter,flattenInputs} from '../dist/bindings.js';
import {continuationFixture,stagedDecider,goal,values} from './continuation-fixture.mjs';
let browser;
before(async()=>{browser=await fixtureBrowser();});
after(async()=>{await browser?.close();});

test('continuation integrity: all stage values may be supplied in one request',async t=>{
  const app=await continuationFixture(t,browser);
  const result=await app.core.run(goal,{values,settleTimeoutMs:100});
  assert.equal(result.status,'complete',JSON.stringify(result));
  assert.deepEqual(app.submissions.map(x=>x.stage),['account','membership','reservation']);
  assert.deepEqual(app.submissions.map(x=>Object.values(x.data)[0]),Object.values(values));
  assert.equal(result.checkpoints.length,3);
  assert.ok(result.inputs.every(input=>input.applied));
});

test('continuation integrity: changing an existing leaf into an object is rejected',async t=>{
  const app=await continuationFixture(t,browser,{count:2});
  const first=await app.core.run(goal,{values:{email:values.email},settleTimeoutMs:100});
  assert.ok(first.continuation?.id);
  await assert.rejects(app.core.resume(first.continuation.id,{values:{email:{address:'different@example.invalid'}}}),{code:'CONTINUATION_CONFLICT'});
  assert.equal(app.submissions.length,1);
});

test('continuation integrity: a new origin cannot consume old verified work',async t=>{
  const app=await continuationFixture(t,browser,{count:2});
  const first=await app.core.run(goal,{values:{email:values.email},settleTimeoutMs:100});
  assert.ok(first.continuation?.id);
  await app.page.route('https://other.example.invalid/',route=>route.fulfill({contentType:'text/html',body:'<p>Different account</p>'}));
  await app.page.goto('https://other.example.invalid/');
  await assert.rejects(app.core.resume(first.continuation.id,{values:{membershipCode:values.membershipCode}}),{code:'CONTINUATION_CONTEXT_CHANGED'});
  assert.equal(app.submissions.length,1);
});

test('continuation integrity: interruption during commit retains read-only reconciliation',async t=>{
  const abort=new AbortController();
  const app=await continuationFixture(t,browser,{count:1,onSave:()=>abort.abort()});
  let partial;
  await assert.rejects(app.core.run('Create and save the account once.',{values:{email:values.email},signal:abort.signal}),error=>{partial=error.partial;return true;});
  assert.equal(app.submissions.length,1);
  assert.equal(partial?.continuation?.pendingEffect,'commit');
  await app.page.locator('#results article').waitFor();
  const result=await app.core.resume(partial.continuation.id);
  assert.equal(result.status,'complete',JSON.stringify(result));
  assert.equal(app.submissions.length,1);
});

test('continuation integrity: provider interruption after a sent commit preserves continuation',async t=>{
  const decider=stagedDecider(1),decide=decider.decide.bind(decider);let fail=true;
  decider.decide=async(request,options)=>{if(fail&&request.questions.completion){fail=false;throw Object.assign(new Error('synthetic validation refusal'),{code:'INVALID_DECISION'});}return decide(request,options);};
  const app=await continuationFixture(t,browser,{count:1,decider});let partial;
  await assert.rejects(app.core.run('Create and save the account.',{values:{email:values.email},decisionRetries:0}),error=>{partial=error.partial;return true;});
  assert.equal(partial?.continuation?.pendingEffect,'commit');
  const result=await app.core.resume(partial.continuation.id);
  assert.equal(result.status,'complete');assert.equal(app.submissions.length,1);
});

test('continuation integrity: a caller final condition also checkpoints the last save',async t=>{
  const app=await continuationFixture(t,browser);
  const result=await app.core.run(goal,{values,until:async page=>(await page.locator('#final').textContent())==='Ready'});
  assert.equal(result.status,'complete');assert.equal(result.verification.source,'caller');
  assert.equal(result.checkpoints.length,3);assert.equal(app.submissions.length,3);
});

test('continuation integrity: a step budget preserves verified work for resume',async t=>{
  const app=await continuationFixture(t,browser,{count:2});
  const first=await app.core.run(goal,{values:{email:values.email,membershipCode:values.membershipCode},maxSteps:2});
  assert.equal(first.reason,'step-limit');assert.equal(first.checkpoints.length,1);assert.ok(first.continuation?.id);
  const second=await app.core.resume(first.continuation.id);
  assert.equal(second.status,'complete');assert.equal(app.submissions.length,2);
});

test('continuation integrity: scrolling cannot rearm a verified save',async t=>{
  const submissions=[];
  const service=await httpServer(async(req,res)=>{
    if(req.url==='/save'){
      let raw='';for await(const chunk of req)raw+=chunk;const data=JSON.parse(raw);submissions.push(data);
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return;
    }
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<form style="position:fixed;top:0"><label>Reference<input required></label><button type="button">Save</button></form><section style="margin-top:80px"></section><div style="height:3000px"></div><script>
      document.querySelector('button').onclick=async()=>{const reference=document.querySelector('input').value;await fetch('/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reference})});const article=document.createElement('article');article.innerHTML='<h2>Record created</h2><dl><dt>Reference</dt><dd></dd></dl>';article.querySelector('dd').textContent=reference;document.querySelector('section').append(article);};
    </script>`);
  });
  const decider=engine((q,r,id)=>{
    if(id.startsWith('bind_'))return r.state.page.elements.find(e=>e.name==='Reference')?.id??'__none__';
    if(id.startsWith('effect_'))return 'commit';
    if(id==='completion')return submissions.length===1?'continue':'complete';
    if(id.startsWith('read_'))return r.state.sources.find(e=>e.text==='[input:/reference]')?.id??'__none__';
    if(id==='action'){
      if(submissions.length&&!r.state.history.some(action=>action.kind==='scroll'))return c=>c?.kind==='scroll';
      return c=>c?.kind==='click'&&c.target?.name==='Save';
    }
    return '__none__';
  });
  const page=await browser.newPage();await page.goto(service.url);const core=new JevBrowser({page,engine:decider});
  t.after(async()=>{await core.close();await page.close();await service.close();});
  const result=await core.run('Save one record, then inspect the page below. Do not save again.',{values:{reference:'scroll-test'},maxSteps:5,settleTimeoutMs:100});
  assert.equal(submissions.length,1);assert.equal(result.checkpoints.length,1);
});

test('continuation integrity: redaction cannot rewrite checkpoint authority identifiers',()=>{
  const filter=privateFilter(flattenInputs({reference:'abc'}));
  const result=filter({checkpoints:[{id:'abc-001',effectId:'abc-002',resultRecordId:'abc-003'}]});
  assert.equal(result.checkpoints[0].effectId,'abc-002');assert.equal(result.checkpoints[0].resultRecordId,'abc-003');
});

test('continuation speed: field binding and later-stage placement share one frontier',async t=>{
  const app=await continuationFixture(t,browser);
  const result=await app.core.run(goal,{values});
  assert.equal(result.status,'complete');assert.equal(result.usage.serialDecisionDepth,6);
  assert.equal(result.usage.requests,6);assert.equal(app.submissions.length,3);
});

test('continuation integrity: input objects are captured before awaiting provider work',async t=>{
  const initial={email:values.email},decider=stagedDecider(2),decide=decider.decide.bind(decider);let changed=false;
  decider.decide=async(...args)=>{if(!changed){initial.email='changed@example.invalid';changed=true;}return decide(...args);};
  const app=await continuationFixture(t,browser,{count:2,decider});
  const first=await app.core.run(goal,{values:initial});
  assert.ok(first.continuation?.id);
  const second=await app.core.resume(first.continuation.id,{values:{membershipCode:values.membershipCode}});
  assert.equal(second.status,'complete',JSON.stringify(second));assert.equal(app.submissions[0].data.a7,values.email);
});

test('caller verification: true until cannot bypass a separately required assertion',async t=>{
  const app=await continuationFixture(t,browser,{count:1,coreOptions:{allowCommand:command=>command.command!=='assert'}});
  await assert.rejects(app.core.run('Verify the existing state.',{until:()=>true,expect:{target:'#final',property:'text',expected:'Ready'}}),{code:'ACTION_DENIED'});
  assert.equal(app.submissions.length,0);
});

test('caller verification: true assertion cannot override a false until',async t=>{
  const app=await continuationFixture(t,browser,{count:1});
  const result=await app.core.run('Create and save the account once.',{values:{email:values.email},until:()=>false,expect:{target:'#final',property:'text',expected:'Ready'},settleTimeoutMs:80});
  assert.notEqual(result.status,'complete');assert.equal(app.submissions.length,1);
});

test('continuation review: empty object structure cannot be replaced by a scalar',async t=>{
  const app=await continuationFixture(t,browser,{count:2});
  const first=await app.core.run(goal,{values:{email:values.email,metadata:{nested:{}}},settleTimeoutMs:100});
  assert.ok(first.continuation?.id);
  await assert.rejects(app.core.resume(first.continuation.id,{values:{metadata:null}}),{code:'CONTINUATION_CONFLICT'});
  assert.equal(app.submissions.length,1);
});

for(const changed of [false,true])test(`continuation review: paused wizard ${changed?'rejects changed context':'retains uncommitted carried inputs'}`,async t=>{
  const app=await continuationFixture(t,browser,{count:2});
  // Insert a native wizard step when the membership form appears.
  await app.page.evaluate(()=>{
    const editor=document.querySelector('#editor');
    new MutationObserver(()=>{
      const form=editor.querySelector('form');
      if(form?.getAttribute('aria-label')!=='membership details'||form.dataset.wizard)return;
      form.dataset.wizard='yes';
      const button=form.querySelector('button');button.hidden=true;
      const next=document.createElement('button');next.type='button';next.textContent='Next';form.append(next);
      next.onclick=()=>{form.querySelector('input').type='hidden';next.remove();button.hidden=false;};
    }).observe(editor,{childList:true});
  });
  const original=app.decider.decide.bind(app.decider);
  app.decider.decide=async(request,options)=>{
    const result=await original(request,options);
    const next=Object.entries(request.questions.action?.criteria??{}).find(([,c])=>c?.kind==='click'&&c.target?.name==='Next');
    if(next)result.answers.action={choice:next[0],confidence:0.95};
    return result;
  };
  const first=await app.core.run(goal,{values:{email:values.email,membershipCode:values.membershipCode},maxSteps:4});
  assert.equal(first.reason,'step-limit');assert.equal(first.checkpoints.length,1);assert.ok(first.continuation?.id);
  assert.equal(await app.page.locator('input[type=hidden]').count(),1);
  if(changed){
    await app.page.locator('h1').evaluate(element=>element.textContent='Different wizard');
    await assert.rejects(app.core.resume(first.continuation.id),{code:'CONTINUATION_CONTEXT_CHANGED'});
    assert.equal(app.submissions.length,1);return;
  }
  const second=await app.core.resume(first.continuation.id);
  assert.equal(second.status,'complete',JSON.stringify(second));
  assert.deepEqual(app.submissions.map(x=>x.stage),['account','membership']);
  assert.equal(app.submissions[1].data.b3,values.membershipCode);
});
