import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {JevBrowser} from '../dist/index.js';
import {fixtureBrowser,engine} from './helpers.mjs';

let browser;
before(async()=>{browser=await fixtureBrowser();});
after(async()=>{await browser?.close();});

async function coreFor(t,html,decider,options={}){
  const page=await browser.newPage();
  await page.setContent(html);
  const core=new JevBrowser({page,engine:decider,...options});
  t.after(async()=>{await core.close();await page.close();});
  return {core,page};
}

test('semantic locate: returns a real grounded element ref and evidence',async t=>{
  const decider=engine((question,_request,id)=>{
    if(id!=='target')return '__none__';
    return Object.entries(question.criteria).find(([,candidate])=>candidate?.name==='Archive order')?.[0]??'__none__';
  });
  const {core}=await coreFor(t,'<button>Archive order</button><button>Refund order</button>',decider);
  const target=await core.locateSemantic('The control that archives the order');
  assert.match(target.ref,/^r[0-9a-f]+_e/);
  assert.equal(target.evidence.text,'Archive order');
  assert.equal(target.evidence.role,'button');
  assert.equal(target.confidence,0.95);
  assert.equal(decider.requests.length,1);
});

test('semantic locate: returned ref uses the existing native execution authority',async t=>{
  const decider=engine(q=>Object.entries(q.criteria).find(([,candidate])=>candidate?.name==='Archive order')?.[0]??'__none__');
  const {core,page}=await coreFor(t,'<button onclick="this.dataset.hit=1">Archive order</button>',decider);
  const target=await core.locateSemantic('Archive the order');
  await core.native({command:'click',ref:target.ref});
  assert.equal(await page.locator('button').getAttribute('data-hit'),'1');
});

test('semantic locate: ambiguity and no-match never choose a target',async t=>{
  for(const [choice,code] of [['__ambiguous__','SEMANTIC_AMBIGUOUS'],['__none__','SEMANTIC_NO_MATCH']]){
    const decider=engine(()=>choice);
    const {core}=await coreFor(t,'<button>A</button><button>B</button>',decider);
    await assert.rejects(core.locateSemantic('Unknown target'),{code});
  }
});

test('semantic locate: below-threshold choice is inconclusive',async t=>{
  const decider={async decide(request){
    const id=Object.keys(request.questions.target.criteria).find(key=>!key.startsWith('__'));
    return {answers:{target:{choice:id,confidence:0.79}},model:'fixture'};
  }};
  const {core}=await coreFor(t,'<button>Archive order</button>',decider);
  await assert.rejects(core.locateSemantic('Archive order',{minConfidence:0.8}),{code:'SEMANTIC_INCONCLUSIVE'});
});

test('semantic locate: threshold is validated before provider work',async t=>{
  let calls=0;
  const decider={async decide(){calls++;return {answers:{}};}};
  const {core}=await coreFor(t,'<button>A</button>',decider);
  for(const value of [-0.1,1.1,NaN])await assert.rejects(core.locateSemantic('A',{minConfidence:value}),{code:'INVALID_ARGUMENT'});
  assert.equal(calls,0);
});

test('semantic locate: caller scope bounds the candidate inventory',async t=>{
  const decider=engine(q=>{
    const candidates=Object.entries(q.criteria).filter(([id])=>!id.startsWith('__'));
    assert.equal(candidates.length,1);
    return candidates[0][0];
  });
  const {core}=await coreFor(t,'<section id="wanted"><button>Save</button></section><section><button>Save</button></section>',decider);
  const target=await core.locateSemantic('Save in the wanted area',{scope:'#wanted'});
  assert.equal(target.evidence.text,'Save');
});

test('semantic locate: reversing DOM candidate order does not change a uniquely described target',async t=>{
  for(const html of ['<button>Archive order</button><button>Refund order</button>','<button>Refund order</button><button>Archive order</button>']){
    const decider=engine(q=>Object.entries(q.criteria).find(([,candidate])=>candidate?.name==='Archive order')?.[0]??'__none__');
    const {core}=await coreFor(t,html,decider);
    const target=await core.locateSemantic('The archive control');
    assert.equal(target.evidence.text,'Archive order');
  }
});

async function groundedTarget(core,label){
  const snapshot=await core.snapshot();
  const element=snapshot.elements.find(candidate=>candidate.name===label);
  assert.ok(element);
  return {
    ref:element.id,
    snapshotId:snapshot.id,
    confidence:1,
    evidence:{sourceId:element.id,frame:element.frame,role:element.role,text:element.name,context:element.context},
  };
}

for(const [choice,confidence,expectedStatus] of [
  ['equivalent',0.95,'passed'],
  ['different',0.95,'failed'],
  ['equivalent',0.70,'inconclusive'],
  ['different',0.70,'inconclusive'],
  ['insufficient_evidence',1,'inconclusive'],
])test(`semantic compare: ${choice} at ${confidence} becomes ${expectedStatus}`,async t=>{
  const decider={requests:[],async decide(request){
    this.requests.push(structuredClone(request));
    return {answers:Object.fromEntries(Object.keys(request.questions).map(id=>[id,{choice,confidence}])),model:'fixture',usage:{input_tokens:5,output_tokens:1}};
  }};
  const {core}=await coreFor(t,'<button>Pro annual</button>',decider);
  const actual=await groundedTarget(core,'Pro annual');
  const result=await core.compareSemantic({actual,expected:'Professional annual plan',minConfidence:0.8});
  assert.equal(result.status,expectedStatus);
  assert.equal(result.choice,choice);
  assert.equal(result.confidence,confidence);
  assert.equal(result.threshold,0.8);
  assert.equal(result.source,'semantic');
  assert.equal(result.evidence.text,'Pro annual');
});

test('semantic compare: exact equality after semantic locate reports deterministic comparison without a second provider call',async t=>{
  let calls=0;
  const decider=engine((question,_request,id)=>{calls++;return Object.entries(question.criteria).find(([,candidate])=>candidate?.name==='Manage plan')?.[0]??'__none__';});
  const {core}=await coreFor(t,'<button>Manage plan</button>',decider);
  const actual=await core.locateSemantic('The plan management control',{minConfidence:0.8});
  const afterLocate=calls;
  const result=await core.compareSemantic({actual,expected:'Manage plan',minConfidence:0.8});
  assert.equal(result.status,'passed');
  assert.equal(result.source,'deterministic');
  assert.equal(result.confidence,1);
  assert.equal(result.sourceConfidence,actual.confidence);
  assert.equal(result.usage.requests,0);
  assert.equal(calls,afterLocate);
});

test('semantic compare: exact grounded equality is deterministic and makes no provider request',async t=>{
  let calls=0;const decider={async decide(){calls++;throw new Error('provider should not run');}};
  const {core}=await coreFor(t,'<button>  Paid\n now </button>',decider);
  const actual=await groundedTarget(core,'Paid now');
  const result=await core.compareSemantic({actual:{ref:actual.ref},expected:'Paid now'});
  assert.equal(result.status,'passed');
  assert.equal(result.choice,'equivalent');
  assert.equal(result.source,'deterministic');
  assert.equal(result.confidence,1);
  assert.equal(result.usage.requests,0);
  assert.equal(result.usage.serialDecisionDepth,0);
  assert.equal(calls,0);
});

test('semantic assert: failed and inconclusive outcomes use distinct errors',async t=>{
  for(const [choice,confidence,code] of [
    ['different',0.95,'SEMANTIC_ASSERTION_FAILED'],
    ['equivalent',0.5,'SEMANTIC_ASSERTION_INCONCLUSIVE'],
    ['insufficient_evidence',1,'SEMANTIC_ASSERTION_INCONCLUSIVE'],
  ]){
    const decider={async decide(request){return {answers:Object.fromEntries(Object.keys(request.questions).map(id=>[id,{choice,confidence}]))};}};
    const {core}=await coreFor(t,'<button>Pro annual</button>',decider);
    const actual=await groundedTarget(core,'Pro annual');
    await assert.rejects(core.assertSemantic({actual,expected:'Professional annual plan',minConfidence:0.8}),{code});
  }
});

test('semantic compare: invalid source threshold fails before provider work',async t=>{
  let calls=0;const decider={async decide(){calls++;return {answers:{}};}};
  const {core}=await coreFor(t,'<button>A</button>',decider);
  const actual=await groundedTarget(core,'A');
  for(const minSourceConfidence of [-1,2,NaN])await assert.rejects(core.compareSemantic({actual,expected:'B',minSourceConfidence}),{code:'INVALID_ARGUMENT'});
  assert.equal(calls,0);
});

test('semantic compare: invalid threshold fails before provider work',async t=>{
  let calls=0;const decider={async decide(){calls++;return {answers:{}};}};
  const {core}=await coreFor(t,'<button>A</button>',decider);
  const actual=await groundedTarget(core,'A');
  for(const minConfidence of [-1,2,NaN])await assert.rejects(core.compareSemantic({actual,expected:'B',minConfidence}),{code:'INVALID_ARGUMENT'});
  assert.equal(calls,0);
});
