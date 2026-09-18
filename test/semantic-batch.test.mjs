import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {JevBrowser} from '../dist/index.js';
import {fixtureBrowser} from './helpers.mjs';

let browser;
before(async()=>{browser=await fixtureBrowser();});
after(async()=>{await browser?.close();});

async function makeCore(t,reverse=false,abortAfterSource){
  const page=await browser.newPage();
  const rows=Array.from({length:10},(_,i)=>`<dt>Field ${i}</dt><dd>Actual ${i}</dd>`);
  if(reverse)rows.reverse();
  await page.setContent('<dl>'+rows.join('')+'</dl>');
  const requests=[];
  let call=0;
  const engine={requests,async decide(request){
    call++;requests.push(structuredClone(request));
    const answers={};
    for(const [id,question] of Object.entries(request.questions)){
      if(id.startsWith('source_')){
        const index=Number(id.slice('source_'.length));
        const choice=Object.entries(question.criteria).find(([,candidate])=>candidate?.text===`Actual ${index}`)?.[0]??'__none__';
        answers[id]={choice,confidence:0.96};
      }else if(id.startsWith('compare_')){
        const index=Number(id.slice('compare_'.length));
        assert.match(question.instructions,new RegExp(`Actual ${index}`));
        assert.match(question.instructions,new RegExp(`Expected ${index}`));
        for(let other=0;other<10;other++)if(other!==index)assert.doesNotMatch(question.instructions,new RegExp(`Expected ${other}(?!\\d)`));
        answers[id]={choice:'equivalent',confidence:0.94};
      }
    }
    if(call===1&&abortAfterSource)abortAfterSource.abort();
    return {answers,model:'fixture',usage:{input_tokens:10,output_tokens:2}};
  }};
  const core=new JevBrowser({page,engine});
  t.after(async()=>{await core.close();await page.close();});
  return {core,engine};
}

const requests=()=>Array.from({length:10},(_,i)=>({actual:{description:`Value for Field ${i}`},expected:`Expected ${i}`}));

test('semantic batch: ten independent assertions use two serial decision frontiers',async t=>{
  const {core,engine}=await makeCore(t);
  const results=await core.compareSemanticBatch(requests(),{minConfidence:0.8});
  assert.equal(results.length,10);
  assert.ok(results.every(result=>result.status==='passed'&&result.source==='semantic'));
  assert.equal(engine.requests.length,2);
  assert.equal(results[0].usage.requests,2);
  assert.equal(results[0].usage.questions,20);
  assert.equal(results[0].usage.serialDecisionDepth,2);
});

test('semantic batch: source candidate order does not change result mapping',async t=>{
  const {core}=await makeCore(t,true);
  const results=await core.compareSemanticBatch(requests(),{minConfidence:0.8});
  assert.deepEqual(results.map(result=>result.evidence.text),Array.from({length:10},(_,i)=>`Actual ${i}`));
});

test('semantic batch: cancellation after source selection prevents comparison frontier',async t=>{
  const abort=new AbortController();
  const {core,engine}=await makeCore(t,false,abort);
  await assert.rejects(core.compareSemanticBatch(requests(),{minConfidence:0.8,signal:abort.signal}),error=>error?.name==='AbortError'||error?.code==='CANCELLED');
  assert.equal(engine.requests.length,1);
});

test('semantic batch: low source confidence short-circuits before the comparison frontier',async t=>{
  const page=await browser.newPage();await page.setContent('<p>Actual status text</p>');
  const requestsSeen=[];
  const engine={async decide(request){
    requestsSeen.push(structuredClone(request));
    if(request.questions.source_0){
      const choice=Object.keys(request.questions.source_0.criteria).find(key=>!key.startsWith('__'));
      return {answers:{source_0:{choice,confidence:0.5}},model:'fixture'};
    }
    return {answers:{compare_0:{choice:'equivalent',confidence:0.95}},model:'fixture'};
  }};
  const core=new JevBrowser({page,engine});t.after(async()=>{await core.close();await page.close();});
  const [result]=await core.compareSemanticBatch([{actual:{description:'Actual status'},expected:'Equivalent status'}],{minConfidence:0.8});
  assert.equal(result.status,'inconclusive');
  assert.equal(result.choice,'insufficient_evidence');
  assert.equal(result.confidence,0.5);
  assert.equal(result.sourceConfidence,0.5);
  assert.equal(requestsSeen.length,1);
  assert.equal(result.usage.serialDecisionDepth,1);
});

test('semantic batch: source threshold can be tuned independently from comparison threshold',async t=>{
  const page=await browser.newPage();await page.setContent('<p>Actual status text</p>');
  const requestsSeen=[];
  const engine={async decide(request){
    requestsSeen.push(structuredClone(request));
    if(request.questions.source_0){
      const choice=Object.keys(request.questions.source_0.criteria).find(key=>!key.startsWith('__'));
      return {answers:{source_0:{choice,confidence:0.5}},model:'fixture'};
    }
    return {answers:{compare_0:{choice:'equivalent',confidence:0.95}},model:'fixture'};
  }};
  const core=new JevBrowser({page,engine});t.after(async()=>{await core.close();await page.close();});
  const [result]=await core.compareSemanticBatch([{actual:{description:'Actual status'},expected:'Equivalent status',minConfidence:0.8,minSourceConfidence:0.4}]);
  assert.equal(result.status,'passed');
  assert.equal(result.confidence,0.95);
  assert.equal(result.sourceConfidence,0.5);
  assert.equal(result.threshold,0.8);
  assert.equal(result.sourceThreshold,0.4);
  assert.equal(requestsSeen.length,2);
  assert.equal(result.usage.serialDecisionDepth,2);
});

test('semantic source discovery: definition-list terms are labels, not actual value candidates',async t=>{
  const page=await browser.newPage();await page.setContent('<dl><dt>Plan</dt><dd>Pro annual</dd></dl>');
  const engine={async decide(request){
    if(request.questions.source_0){
      const question=request.questions.source_0;
      const candidates=Object.entries(question.criteria).filter(([id])=>!id.startsWith('__')).map(([,candidate])=>candidate);
      assert.equal(candidates.some(candidate=>candidate.role==='term'),false);
      const actual=Object.entries(question.criteria).find(([,candidate])=>candidate?.role==='definition'&&candidate.text==='Pro annual')?.[0];
      return {answers:{source_0:{choice:actual,confidence:0.9}}};
    }
    return {answers:{compare_0:{choice:'equivalent',confidence:0.95}}};
  }};
  const core=new JevBrowser({page,engine});t.after(async()=>{await core.close();await page.close();});
  const result=await core.compareSemantic({actual:{description:'Current plan'},expected:'Professional annual plan',minConfidence:0.8});
  assert.equal(result.status,'passed');
  assert.equal(result.evidence.text,'Pro annual');
});

test('semantic metrics: observation provider and local verification time are explicit',async t=>{
  const {core}=await makeCore(t);
  const [result]=await core.compareSemanticBatch([{actual:{description:'Value for Field 0'},expected:'Expected 0'}],{minConfidence:0.8});
  for(const key of ['providerMs','observationMs','verificationMs']){
    assert.equal(typeof result.usage[key],'number',key);
    assert.ok(Number.isFinite(result.usage[key])&&result.usage[key]>=0,key);
  }
  assert.ok(result.usage.observationMs>0);
  assert.equal(result.usage.serialDecisionDepth,2);
});
