import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {JevBrowser,JevDecisionEngine} from '../dist/index.js';
import {fixtureBrowser} from './helpers.mjs';
import {orderWorkflowFixture} from './order-workflow-fixture.mjs';
let browser;before(async()=>{assert.ok(process.env.JEV_API_KEY||process.env.TYPESAFE_API_KEY,'Explicit opt-in requires provider credentials.');browser=await fixtureBrowser();});after(async()=>{await browser?.close();});
for(let variant=0;variant<6;variant++)test('LIVE refinement: search and update one order / frozen layout '+variant,async t=>{
 const app=await orderWorkflowFixture(t,{variant}),page=await browser.newPage();await page.goto(app.url);
 const provider=new JevDecisionEngine(),decisions=[];const core=new JevBrowser({page,engine:{async decide(request,options){const r=await provider.decide(request,options);decisions.push(r);return r;}}});t.after(async()=>{await core.close();await page.close();});
 const start=performance.now();
 const result=await core.run('Search orders using the supplied orderReference. Among the search results, open Edit for exactly that order reference, not the similarly named orders. Set its status to the supplied status and Save order once. Verify the updated order.',{values:{orderReference:app.reference,status:'Shipped'},timeoutMs:45000,maxDecisions:20});
 console.log(JSON.stringify({case:'order-update',variant,status:result.status,reason:result.reason,writes:app.writes,steps:result.steps.length,usage:result.usage,totalMs:Math.round(performance.now()-start),models:[...new Set(decisions.map(x=>x.model))]}));
 assert.equal(result.status,'complete',JSON.stringify(result));assert.deepEqual(app.writes,[{id:app.reference,status:'Shipped'}]);
 assert.deepEqual(app.records,app.before.map(row=>row.id===app.reference?{...row,status:'Shipped'}:row));
 const reads=await core.assertSemanticBatch([{actual:{locator:page.getByTestId('saved-reference')},expected:app.reference},{actual:{locator:page.getByTestId('saved-status')},expected:'Shipped'}]);
 assert.ok(reads.every(x=>x.status==='passed'&&x.freshness==='verified'&&x.usage.requests===0));
});

test('LIVE refinement: batched semantic source verification and direct Locator comparison',async t=>{
 const page=await browser.newPage();await page.setContent('<dl><dt>Payment</dt><dd id="payment">Payment complete</dd><dt>Plan</dt><dd id="plan">Professional annual subscription</dd></dl><button>Archive order</button><button>Refund order</button>');
 const core=new JevBrowser({page});t.after(async()=>{await core.close();await page.close();});
 const result=await core.assertSemanticBatch([{actual:{locator:page.locator('#payment')},expected:'Payment has been completed'},{actual:{locator:page.locator('#plan')},expected:'Professional plan billed yearly'}]);
 console.log(JSON.stringify({case:'locator-semantic-batch',status:result.map(x=>x.status),usage:result[0].usage,confidence:result.map(x=>x.confidence)}));
 assert.ok(result.every(x=>x.freshness==='verified'));assert.equal(result[0].usage.serialDecisionDepth,1);
 const targets=await core.locateSemanticBatch(['Archive order button','Refund order button']);assert.deepEqual(targets.map(t=>t.evidence.text),['Archive order','Refund order']);
});
