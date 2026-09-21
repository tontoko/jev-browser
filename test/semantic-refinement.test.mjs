import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {JevBrowser} from '../dist/index.js';
import {decideFrontier,emptyDecisionUsage} from '../dist/frontier.js';
import {fixtureBrowser} from './helpers.mjs';
let browser;
before(async()=>{browser=await fixtureBrowser();});
after(async()=>{await browser?.close();});
async function setup(t,html,engine){const page=await browser.newPage();await page.setContent(html);const core=new JevBrowser({page,engine});t.after(async()=>{await core.close();await page.close();});return {page,core};}

test('semantic refinement: exact grounded equality is usable with no provider configuration',async t=>{
  const saved=Object.fromEntries(['JEV_API_KEY','TYPESAFE_API_KEY','JEV_BASE_URL'].map(k=>[k,process.env[k]]));
  for(const k of Object.keys(saved))delete process.env[k];
  try{const {core}=await setup(t,'<button>Manage plan</button>');const s=await core.snapshot();const r=await core.compareSemantic({actual:{ref:s.elements[0].id},expected:'Manage plan'});assert.equal(r.status,'passed');assert.equal(r.usage.requests,0);}
  finally{for(const [k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});

for(const models of [['A','B','A'],['A',undefined,'A']])test('frontier provenance: '+JSON.stringify(models),async()=>{
  let calls=0;const provider={async decide(r){const model=models[calls++];return {answers:Object.fromEntries(Object.keys(r.questions).map(id=>[id,{choice:'yes',confidence:1}])),...(model?{model}:{})};}};
  const questions=Object.fromEntries(Array.from({length:129},(_,i)=>['q'+i,{type:'choice',instructions:'Choose',criteria:{yes:'Yes'}}]));
  const result=await decideFrontier(provider,{state:{},questions},{signal:new AbortController().signal,usage:emptyDecisionUsage()});
  assert.equal(result.model,undefined);assert.deepEqual(result.models,[...new Set(models.filter(Boolean))]);
});

for(const useAssertion of [false,true])test('semantic refinement: evidence change during discovery '+(useAssertion?'cannot pass live assertion':'retains explicit snapshot comparison'),async t=>{
  let page,calls=0;const provider={async decide(r){calls++;const id=Object.entries(r.questions.source_0.criteria).find(([,v])=>v?.text==='Paid')?.[0];await page.locator('#status').evaluate(el=>el.textContent='Unpaid');return {answers:{source_0:{choice:id,confidence:0.99}},model:'fixture'};}};
  const fixture=await setup(t,'<dl><dt>Payment status</dt><dd id="status">Paid</dd></dl>',provider);page=fixture.page;
  const request={actual:{description:'Current payment status'},expected:'Paid'};
  if(useAssertion){await assert.rejects(fixture.core.assertSemantic(request),e=>e.code==='SEMANTIC_ASSERTION_INCONCLUSIVE'&&e.semantic?.results[0].freshness==='changed');}
  else {const r=await fixture.core.compareSemantic(request);assert.equal(r.status,'passed');assert.equal(r.freshness,'snapshot');assert.equal(r.evidence.text,'Paid');}
  assert.equal(await page.locator('#status').innerText(),'Unpaid');assert.equal(calls,1);
});

test('semantic refinement: assertion errors preserve exact evidence and both thresholds',async t=>{
  const engine={async decide(r){return {answers:Object.fromEntries(Object.keys(r.questions).map(id=>[id,{choice:'different',confidence:0.93}])),model:'comparison-fixture'};}};
  const {core}=await setup(t,'<button>Cancelled</button>',engine);const snapshot=await core.snapshot();
  await assert.rejects(core.assertSemantic({actual:{ref:snapshot.elements[0].id},expected:'Active',minConfidence:0.8,minSourceConfidence:0.4}),e=>{
    assert.equal(e.code,'SEMANTIC_ASSERTION_FAILED');assert.equal(e.semantic.results[0].evidence.text,'Cancelled');assert.deepEqual(e.semantic.expected,['Active']);assert.equal(e.semantic.results[0].sourceThreshold,0.4);return true;
  });
});
