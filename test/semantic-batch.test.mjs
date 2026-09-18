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

test('semantic batch: below-threshold source selection is inconclusive without comparison',async t=>{
  const page=await browser.newPage();await page.setContent('<p>Actual</p>');
  const requestsSeen=[];
  const engine={async decide(request){
    requestsSeen.push(structuredClone(request));
    return {answers:Object.fromEntries(Object.keys(request.questions).map(id=>[id,{choice:Object.keys(request.questions[id].criteria).find(key=>!key.startsWith('__')),confidence:0.5}]))};
  }};
  const core=new JevBrowser({page,engine});t.after(async()=>{await core.close();await page.close();});
  const [result]=await core.compareSemanticBatch([{actual:{description:'Actual status'},expected:'Equivalent status'}],{minConfidence:0.8});
  assert.equal(result.status,'inconclusive');
  assert.equal(result.choice,'insufficient_evidence');
  assert.equal(requestsSeen.length,1);
});
