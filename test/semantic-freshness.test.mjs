import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {JevBrowser} from '../dist/index.js';
import {fixtureBrowser,semanticCandidates} from './helpers.mjs';
let browser;before(async()=>{browser=await fixtureBrowser();});after(async()=>{await browser?.close();});
async function setup(t,html,provider){const page=await browser.newPage();await page.setContent(html);const core=new JevBrowser({page,engine:provider});t.after(async()=>{await core.close();await page.close();});return {core,page};}
for(const mutation of ['replace','hide','navigate'])test('semantic live source: '+mutation+' cannot retain the old assertion',async t=>{
 let page;const provider={async decide(r){const id=semanticCandidates(r.questions.source_0,r).find(([,v])=>v?.text==='Paid')?.[0];if(mutation==='navigate')await page.goto('data:text/html,<p>Paid</p>');else await page.locator('#value').evaluate((el,operation)=>{if(operation==='replace')el.replaceWith(el.cloneNode(true));else el.hidden=true;},mutation);return {answers:{source_0:{choice:id,confidence:1}}};}};
 const app=await setup(t,'<dl><dt>Status</dt><dd id="value">Paid</dd></dl>',provider);page=app.page;await assert.rejects(app.core.assertSemantic({actual:{description:'Payment status'},expected:'Paid'}),e=>e.code==='SEMANTIC_ASSERTION_INCONCLUSIVE'&&e.semantic.results[0].freshness==='changed');
});

test('semantic live batch: one changed source does not discard the independent result',async t=>{
 let page,calls=0;const provider={async decide(r){calls++;const answers={};for(const [id,q] of Object.entries(r.questions)){if(id.startsWith('source_'))answers[id]={choice:semanticCandidates(q,r).find(([,v])=>v?.text===(id==='source_0'?'Paid':'Pro annual'))[0],confidence:1};else answers[id]={choice:'equivalent',confidence:0.99};}if(calls===2)await page.locator('#payment').evaluate(el=>el.textContent='Unpaid');return {answers};}};
 const app=await setup(t,'<dl><dt>Payment</dt><dd id="payment">Paid</dd><dt>Plan</dt><dd>Pro annual</dd></dl>',provider);page=app.page;await assert.rejects(app.core.assertSemanticBatch([{actual:{description:'Payment'},expected:'Paid'},{actual:{description:'Plan'},expected:'Professional annual'}]),e=>{assert.deepEqual(e.semantic.results.map(x=>x.freshness),['changed','verified']);assert.deepEqual(e.semantic.results.map(x=>x.status),['inconclusive','passed']);return true;});assert.equal(calls,2);
});

test('semantic API validation: malformed requests fail before observation and inference',async t=>{
 let calls=0;const {core}=await setup(t,'<p>A</p>',{async decide(){calls++;throw Error('must not run');}});
 for(const request of [null,{}, {actual:null,expected:'A'},{actual:{},expected:'A'},{actual:{description:'A',ref:'x'},expected:'A'}])await assert.rejects(core.compareSemantic(request),{code:'INVALID_ARGUMENT'});
 await assert.rejects(core.assertSemanticBatch([]),{code:'INVALID_ARGUMENT'});assert.equal(calls,0);
});

test('semantic API: expected diagnostics retain the request used, not later caller mutation',async t=>{
 let request;const provider={async decide(r){request.expected='changed-after-start';return {answers:Object.fromEntries(Object.keys(r.questions).map(id=>[id,{choice:'different',confidence:1}]))};}};
 const {core,page}=await setup(t,'<p id="status">Cancelled</p>',provider);request={actual:{locator:page.locator('#status')},expected:'Active'};
 await assert.rejects(core.assertSemantic(request),e=>{assert.deepEqual(e.semantic.expected,['Active']);return true;});
});
