import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JevBrowser } from '../dist/index.js';
import { fixtureBrowser, engine, httpServer } from './helpers.mjs';
let browser;
before(async () => { browser = await fixtureBrowser(); });
after(async () => { await browser?.close(); });
import { goalFixture, formEngine } from './goal-fixture.mjs';
const fixture=(t,fields,options)=>goalFixture(t,browser,fields,options);

test('goal: one request opens a form, batches sixteen bindings, saves once and reads back', async t => {
  const fields=Array.from({length:16},(_,i)=>({path:`/field${i}`,label:`field${i}`}));
  const values=Object.fromEntries(fields.map((_,i)=>[`field${i}`, i===0 ? 'unique@example.invalid' : `value-${i}-distinct`]));
  const {core,records,decider}=await fixture(t,fields);
  const result=await core.run('Add a new contact, fill every supplied field and Save.',{values});
  assert.equal(result.status,'complete');assert.equal(result.verification.basis,'ui-readback');
  assert.equal(records.length,1);assert.deepEqual(records[0],Object.fromEntries(Object.entries(values).map(([k,v])=>['/'+k,v])));
  assert.equal(result.inputs.length,16);assert.ok(result.inputs.every(input=>input.applied));
  const bindings=decider.requests.map(request=>Object.keys(request.questions).filter(k=>k.startsWith('bind_')).length);
  assert.ok(bindings.includes(16));assert.ok(result.usage.requests<=5,JSON.stringify(result.usage));
  assert.ok(!JSON.stringify(decider.requests).includes(values.field0));
  assert.ok(!JSON.stringify(result).includes(values.field0));
});

test('goal: nested paths retain student and guardian meaning',async t=>{
  const fields=[{path:'/student/name',label:'student.name'},{path:'/student/email',label:'student.email'},
    {path:'/guardian/name',label:'guardian.name'},{path:'/guardian/email',label:'guardian.email'}];
  const {core,records,decider}=await fixture(t,fields);
  const result=await core.run('Add a student and their guardian on this form. Save.',{values:{student:{name:'Student Uno',email:'student@example.invalid'},guardian:{name:'Guardian Duo',email:'guardian@example.invalid'}}});
  assert.equal(result.status,'complete');assert.equal(records.length,1);
  assert.equal(records[0]['/student/name'],'Student Uno');assert.equal(records[0]['/guardian/name'],'Guardian Duo');
  assert.ok(decider.requests.some(request=>Object.values(request.questions).some(q=>q.instructions.includes('/guardian/email'))));
});

test('goal: colliding parallel answers cause zero form writes and no submission',async t=>{
  const {core,page,attempts}=await fixture(t,[{path:'/first',label:'first'},{path:'/last',label:'last'}],{engine:formEngine({collide:true})});
  const result=await core.run('Add and save',{values:{first:'One',last:'Two'},settleTimeoutMs:100});
  assert.equal(result.status,'stopped');assert.equal(result.reason,'ambiguous');assert.equal(attempts.length,0);
  assert.deepEqual(await page.locator('input').evaluateAll(nodes=>nodes.map(n=>n.value)),['','']);
});

test('goal: an input with no field is not silently discarded before saving',async t=>{
  const {core,attempts}=await fixture(t,[{path:'/email',label:'email'}]);
  const result=await core.run('Add and save all supplied data',{values:{email:'new@example.invalid',notes:'Do not discard this'},settleTimeoutMs:100});
  assert.equal(result.status,'stopped');assert.equal(result.reason,'missing-input');assert.equal(attempts.length,0);
  assert.ok(result.inputs.some(input=>input.path==='/notes'&&!input.applied));
});

test('goal: a caller completion oracle prevents model-complete before the required save',async t=>{
  const decider=formEngine();const decide=decider.decide.bind(decider);
  decider.decide=async(request,options)=>{
    const result=await decide(request,options);
    if(request.questions.action&&request.state.phase==='bind-inputs'&&Object.hasOwn(request.questions.action.criteria,'__inputs__'))
      result.answers.action={choice:'__inputs__',confidence:0.95};
    else if(request.questions.action&&request.state.phase==='continue'&&request.state.callerCompletion!==false)
      result.answers.action={choice:'__done__',confidence:0.95};
    return result;
  };
  const {core,attempts}=await fixture(t,[{path:'/email',label:'email'}],{engine:decider});
  const result=await core.run('Add the contact, fill the email, and Save.',{
    values:{email:'oracle@example.invalid'},
    until:async page=>await page.locator('article').count()===1,
  });
  assert.equal(result.status,'complete');
  assert.equal(result.verification.source,'caller');
  assert.equal(attempts.length,1);
  const continued=decider.requests.filter(request=>request.state?.phase==='continue');
  assert.ok(continued.length>=2);
  assert.notEqual(continued[0].state.callerCompletion,false);
  assert.equal(continued.at(-1).state.callerCompletion,false);
});

test('goal: native selects resolve exact labels locally without exposing input values',async t=>{
  const {core,page,records,decider}=await fixture(t,[{path:'/email',label:'email'},{path:'/course',label:'course',type:'select',options:['Choose','Gamba','Piano']}]);
  const result=await core.run('Add a contact with the supplied email and course, then Save.',{values:{email:'lesson@example.invalid',course:'Gamba'}});
  assert.equal(result.status,'complete');assert.equal(records[0]['/course'],'Gamba');
  assert.ok(!JSON.stringify(decider.requests).includes('lesson@example.invalid'));
});

test('goal: a delayed form is awaited without resending the same decision',async t=>{
  const {core,records,decider}=await fixture(t,[{path:'/email',label:'email'}],{delayMs:400});
  const result=await core.run('Add then Save',{values:{email:'delayed@example.invalid'},settleTimeoutMs:1500});
  assert.equal(result.status,'complete');assert.equal(records.length,1);
  assert.ok(decider.requests.length<=5);
});

test('goal: a success toast without a record never becomes automatic verified completion',async t=>{
  const {core,attempts}=await fixture(t,[{path:'/email',label:'email'}],{noReadback:true});
  const result=await core.run('Add and Save',{values:{email:'toast@example.invalid'},settleTimeoutMs:150});
  assert.equal(result.status,'unverified');assert.equal(attempts.length,1);
  assert.ok(result.effects.some(effect=>effect.kind==='commit'&&effect.status==='unknown'));
});

test('goal: shared declarative expect verifies after all requested inputs, not before',async t=>{
  const {core,attempts}=await fixture(t,[{path:'/email',label:'email'}],{noReadback:true});
  const result=await core.run('Add and Save',{values:{email:'expect@example.invalid'},expect:{target:'[role=status]',property:'text',expected:'Saved'}});
  assert.equal(result.status,'complete');assert.equal(result.verification.source,'caller');assert.equal(attempts.length,1);
});

test('goal: AI actions honor both allowAction and allowCommand hooks',async t=>{
  let policies=0;
  const {core,page}=await fixture(t,[{path:'/email',label:'email'}],{browserOptions:{allowAction:()=>true,allowCommand:command=>{policies++;return command.command!=='click';}}});
  await assert.rejects(core.run('Add and Save',{values:{email:'blocked@example.invalid'}}),error=>{
    assert.equal(error.code,'ACTION_DENIED');assert.ok(error.partial);return true;
  });
  assert.equal(policies,1);assert.equal(await page.locator('#add').count(),1);
});

test('goal: run errors retain prior actions without replaying them',async t=>{
  let calls=0;
  const decider=formEngine();const decide=decider.decide.bind(decider);
  decider.decide=async(...args)=>{if(++calls===2)throw new Error('private provider body');return decide(...args);};
  const {core,page}=await fixture(t,[{path:'/email',label:'email'}],{engine:decider});
  await assert.rejects(core.run('Add and Save',{values:{email:'error@example.invalid'}}),error=>{
    assert.equal(error.partial.steps.length,1);assert.ok(!JSON.stringify(error.partial).includes('private provider'));return true;
  });
  assert.equal(await page.locator('#add').count(),0);
});

test('goal: two wrappers of one Page cannot interleave operations',async t=>{
  let entered,release;const started=new Promise(r=>entered=r),block=new Promise(r=>release=r);
  const {core,page}=await fixture(t,[],{engine:engine(async()=>{entered();await block;return '__none__';})});
  const second=new JevBrowser({page});t.after(()=>second.close());
  const pending=core.observe('Add');await started;
  try {await assert.rejects(second.snapshot(),{code:'BUSY'});}finally{release();await pending;}
});

test('goal: a key containing a dot is distinct from a nested input path',async t=>{
  const {core,records}=await fixture(t,[{path:'/person.name',label:'literal key'},{path:'/person/name',label:'nested key'},{path:'/email',label:'email'}]);
  const result=await core.run('Add and Save',{values:{'person.name':'Literal',person:{name:'Nested'},email:'paths@example.invalid'}});
  assert.equal(result.status,'complete');assert.equal(records[0]['/person.name'],'Literal');assert.equal(records[0]['/person/name'],'Nested');
});

test('goal: object arrays cannot partially create one record and claim the whole batch',async t=>{
  const {core,attempts,page}=await fixture(t,[{path:'/name',label:'name'}]);
  await assert.rejects(core.run('Create all these people',{values:{people:[{name:'A'},{name:'B'}]}}),{code:'UNSUPPORTED_INPUT'});
  assert.equal(attempts.length,0);assert.equal(await page.locator('#add').count(),1);
});
