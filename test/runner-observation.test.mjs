import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {JevBrowser} from '../dist/index.js';
import {fixtureBrowser} from './helpers.mjs';
import {orderWorkflowFixture} from './order-workflow-fixture.mjs';
let browser;before(async()=>{browser=await fixtureBrowser();});after(async()=>{await browser?.close();});

test('run observation: a form replaced while deciding is reobserved rather than declared ambiguous',async t=>{
 const app=await orderWorkflowFixture(t),page=await browser.newPage();await page.goto(app.url);
 await page.route('**/search?**',async route=>{const response=await route.fetch();await new Promise(r=>setTimeout(r,100));await route.fulfill({response});});
 let calls=0;const engine={async decide(request){calls++;if(calls===2)await new Promise(r=>setTimeout(r,150));const answers={};for(const [id,q]of Object.entries(request.questions)){
  let choice='__none__';
  if(id.startsWith('bind_')){const field=q.instructions.includes('/orderReference')?'q17':'c82';choice=request.state.page.elements.find(e=>e.fieldName===field)?.id??'__none__';}
  else if(id.startsWith('effect_'))choice=request.state.actions[id.slice(7)]?.target?.name==='Save order'?'commit':'advance';
  else if(id==='action')choice=Object.entries(q.criteria).find(([,a])=>a?.kind==='click'&&(a.target?.name==='Search orders'||a.target?.name==='Save order'||a.target?.name==='Edit'&&a.target.context.includes('[input:/orderReference] Pending')))?.[0]??'__none__';
  else if(id==='completion')choice='complete';
  else if(id.startsWith('read_')){const field=q.instructions.includes('/orderReference')?'/orderReference':'/status';choice=request.state.sources.find(x=>x.text==='[input:'+field+']')?.id??'__none__';}
  answers[id]={choice,confidence:1};
 }return {answers};}};
 const core=new JevBrowser({page,engine});t.after(async()=>{await core.close();await page.close();});
 const result=await core.run('Find the supplied order reference, edit its status and Save order once.',{values:{orderReference:app.reference,status:'Shipped'},until:async p=>await p.getByTestId('saved-status').count()===1});
 assert.equal(result.status,'complete',JSON.stringify(result));assert.deepEqual(app.writes,[{id:app.reference,status:'Shipped'}]);
});
