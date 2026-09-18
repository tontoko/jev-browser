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
