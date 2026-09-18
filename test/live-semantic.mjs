import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {JevBrowser,JevDecisionEngine} from '../dist/index.js';
import {fixtureBrowser} from './helpers.mjs';

let browser;
before(async()=>{
  assert.ok(process.env.JEV_API_KEY||process.env.TYPESAFE_API_KEY,'Set a Jev API key for live semantic tests.');
  browser=await fixtureBrowser();
});
after(async()=>{await browser?.close();});

function countedEngine(){
  const base=new JevDecisionEngine();
  const stats={requests:0};
  return {stats,engine:{async decide(request,options){stats.requests++;return base.decide(request,options);}}};
}

async function semanticPage(t,html){
  const page=await browser.newPage();await page.setContent(html);
  const {stats,engine}=countedEngine();
  const core=new JevBrowser({page,engine});
  t.after(async()=>{await core.close();await page.close();});
  return {core,stats};
}

const decisive=[
  {name:'plan paraphrase',html:'<dl><dt>Plan</dt><dd>Pro annual</dd></dl>',description:'The current subscription plan',expected:'Professional annual subscription',choice:'equivalent',evidence:'Pro annual',minSourceConfidence:0},
  {name:'multilingual payment',html:'<dl><dt>支払い状況</dt><dd>支払い済み</dd></dl>',description:'The payment status',expected:'Payment has been completed',choice:'equivalent',evidence:'支払い済み',minSourceConfidence:0},
  {name:'plan contradiction',html:'<dl><dt>Plan</dt><dd>Free plan</dd></dl>',description:'The current subscription plan',expected:'Enterprise annual plan',choice:'different',evidence:'Free plan',minSourceConfidence:0},
  {name:'status contradiction',html:'<dl><dt>Status</dt><dd>Cancelled</dd></dl>',description:'The subscription status',expected:'The subscription is active',choice:'different',evidence:'Cancelled',minSourceConfidence:0},
];

for(const scenario of decisive)test('LIVE semantic decisive direction: '+scenario.name,async t=>{
  const {core,stats}=await semanticPage(t,scenario.html);
  const started=performance.now();
  const result=await core.compareSemantic({actual:{description:scenario.description},expected:scenario.expected,minConfidence:0.8,minSourceConfidence:scenario.minSourceConfidence});
  console.log(JSON.stringify({case:scenario.name,status:result.status,choice:result.choice,confidence:result.confidence,sourceConfidence:result.sourceConfidence,threshold:result.threshold,source:result.source,evidence:result.evidence.text,usage:result.usage,totalMs:Math.round(performance.now()-started)}));
  assert.equal(result.evidence.text,scenario.evidence);
  assert.equal(result.choice,scenario.choice);
  const sourceThreshold=scenario.minSourceConfidence ?? 0.8;
  const expectedStatus=result.confidence>=0.8&&result.sourceConfidence>=sourceThreshold?(scenario.choice==='equivalent'?'passed':'failed'):'inconclusive';
  assert.equal(result.status,expectedStatus);
  assert.equal(stats.requests,result.usage.requests);
  assert.equal(result.usage.serialDecisionDepth,2);
});

test('LIVE semantic threshold: plausible equivalence below threshold remains inconclusive',async t=>{
  const {core}=await semanticPage(t,'<dl><dt>Renewal</dt><dd>Renews automatically on October 1</dd></dl>');
  const result=await core.compareSemantic({actual:{description:'The subscription renewal state'},expected:'The subscription is active and set to renew',minConfidence:0.8});
  console.log(JSON.stringify({case:'indirect-renewal',status:result.status,choice:result.choice,confidence:result.confidence,sourceConfidence:result.sourceConfidence,evidence:result.evidence.text,usage:result.usage}));
  assert.equal(result.choice,'equivalent');
  assert.equal(result.status,result.confidence>=0.8&&result.sourceConfidence>=0.8?'passed':'inconclusive');
  if(result.confidence<0.8||result.sourceConfidence<0.8)assert.equal(result.status,'inconclusive');
});

test('LIVE semantic evidence gap: unavailable state never passes as paid',async t=>{
  const {core}=await semanticPage(t,'<dl><dt>Status</dt><dd>Status unavailable</dd></dl>');
  const result=await core.compareSemantic({actual:{description:'The invoice payment status'},expected:'The invoice is paid',minConfidence:0.8});
  console.log(JSON.stringify({case:'unavailable-state',status:result.status,choice:result.choice,confidence:result.confidence,sourceConfidence:result.sourceConfidence,evidence:result.evidence.text,usage:result.usage}));
  assert.equal(result.evidence.text,'Status unavailable');
  assert.notEqual(result.status,'passed');
  assert.notEqual(result.choice,'equivalent');
});

test('LIVE semantic batch: independent sources and comparisons use two serial frontiers',async t=>{
  const cards=[
    '<article><h2>Plan</h2><p>Pro annual</p></article>',
    '<article><h2>Billing</h2><p>Settled</p></article>',
    '<article><h2>Region</h2><p>Japan</p></article>',
    '<article><h2>Renewal</h2><p>Automatic renewal enabled</p></article>',
  ];
  const {core,stats}=await semanticPage(t,cards.join(''));
  const results=await core.compareSemanticBatch([
    {actual:{description:'Current plan'},expected:'Professional annual plan'},
    {actual:{description:'Billing state'},expected:'Paid'},
    {actual:{description:'Account region'},expected:'Japan'},
    {actual:{description:'Renewal state'},expected:'Will renew automatically'},
  ],{minConfidence:0.8});
  console.log(JSON.stringify({case:'batch',results:results.map(result=>({status:result.status,choice:result.choice,confidence:result.confidence,sourceConfidence:result.sourceConfidence,evidence:result.evidence.text})),usage:results[0].usage,providerRequests:stats.requests}));
  assert.ok(results.every(result=>result.choice==='equivalent'));
  assert.ok(results.every(result=>result.status===(result.confidence>=0.8&&result.sourceConfidence>=0.8?'passed':'inconclusive')));
  assert.equal(results[0].usage.serialDecisionDepth,2);
  assert.equal(stats.requests,2);
});

test('LIVE semantic: candidate order preserves the unique grounded source and semantic direction',async t=>{
  const run=async html=>{
    const {core}=await semanticPage(t,html);
    return core.compareSemantic({actual:{description:'Current plan'},expected:'Professional annual subscription',minConfidence:0.8});
  };
  const first=await run('<dl><dt>Plan</dt><dd>Pro annual</dd><dt>Billing</dt><dd>Settled</dd></dl>');
  const second=await run('<dl><dt>Billing</dt><dd>Settled</dd><dt>Plan</dt><dd>Pro annual</dd></dl>');
  console.log(JSON.stringify({case:'candidate-order',first:{status:first.status,choice:first.choice,confidence:first.confidence,sourceConfidence:first.sourceConfidence,evidence:first.evidence.text},second:{status:second.status,choice:second.choice,confidence:second.confidence,sourceConfidence:second.sourceConfidence,evidence:second.evidence.text}}));
  assert.equal(first.evidence.text,'Pro annual');assert.equal(second.evidence.text,'Pro annual');
  assert.equal(first.choice,'equivalent');assert.equal(second.choice,'equivalent');
  assert.equal(first.status,first.confidence>=0.8&&first.sourceConfidence>=0.8?'passed':'inconclusive');
  assert.equal(second.status,second.confidence>=0.8&&second.sourceConfidence>=0.8?'passed':'inconclusive');
});

test('LIVE semantic: exact comparison after semantic locate makes no second provider request',async t=>{
  const {core,stats}=await semanticPage(t,'<button>Manage plan</button>');
  const target=await core.locateSemantic('The plan management control',{minConfidence:0.8});
  const afterLocate=stats.requests;
  const result=await core.compareSemantic({actual:target,expected:'Manage plan',minConfidence:0.8});
  console.log(JSON.stringify({case:'exact-after-locate',status:result.status,source:result.source,confidence:result.confidence,sourceConfidence:result.sourceConfidence,requestsBefore:afterLocate,requestsAfter:stats.requests,usage:result.usage}));
  assert.equal(result.status,'passed');
  assert.equal(result.source,'deterministic');
  assert.equal(stats.requests,afterLocate);
  assert.equal(result.usage.requests,0);
});
