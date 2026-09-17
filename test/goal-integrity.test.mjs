import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {JevBrowser} from '../dist/index.js';
import {fixtureBrowser,engine,select} from './helpers.mjs';
import {goalFixture,formEngine} from './goal-fixture.mjs';
let browser;before(async()=>{browser=await fixtureBrowser();});after(async()=>{await browser?.close();});
async function fixture(t,fields,options={}){return goalFixture(t,browser,fields,options);}
const email={path:'/email',label:'Email',type:'email'};
for(const expectation of [[],{property:'unknown'},{command:'click',target:'#add'}])test('goal integrity: malformed or mutating expect fails before all effects '+JSON.stringify(expectation),async t=>{
 const {core,page,attempts}=await fixture(t,[email]);
 await assert.rejects(core.run('Add and Save',{values:{email:'valid@example.invalid'},expect:expectation}),{code:'INVALID_ARGUMENT'});
 assert.equal(await page.locator('#add').count(),1);assert.equal(attempts.length,0);
});
test('goal integrity: authorization cannot leave a stale row target executable',async t=>{
 const page=await browser.newPage();await page.setContent('<div role="row"><span id="person">Alice</span><button onclick="document.body.dataset.clicked=1">Change</button></div>');
 const core=new JevBrowser({page,engine:select(c=>c.kind==='click'),allowCommand:async()=>{await page.locator('#person').evaluate(el=>el.textContent='Bob');return true;}});
 t.after(async()=>{await core.close();await page.close();});
 await assert.rejects(core.act('Change Alice'),{code:'STALE_TARGET'});assert.equal(await page.locator('body').getAttribute('data-clicked'),null);
});
test('goal integrity: input form and commit form must agree before any writes',async t=>{
 const page=await browser.newPage();await page.setContent('<form><label>Email<input name="/email" type="email"></label><button>Save</button></form><form><h2>Other record</h2><button onclick="event.preventDefault();document.body.dataset.wrong=1">Save</button></form>');
 const base=formEngine();const decider={async decide(req,options){const r=await base.decide(req,options);if(req.questions.action){r.answers.action.choice=Object.entries(req.questions.action.criteria).find(([,c])=>c?.kind==='click'&&c.target.context.includes('Other record'))[0];}return r;}};
 const core=new JevBrowser({page,engine:decider});t.after(async()=>{await core.close();await page.close();});
 const result=await core.run('Save supplied email',{values:{email:'valid@example.invalid'},settleTimeoutMs:80});
 assert.equal(result.reason,'ambiguous');assert.equal(await page.locator('input').inputValue(),'');assert.equal(await page.locator('body').getAttribute('data-wrong'),null);
});
test('goal integrity: unrelated required search controls do not block the correct form',async t=>{
 const {core,page,attempts}=await fixture(t,[email]);
 await page.evaluate(()=>{const form=document.createElement('form');form.innerHTML='<label>Search<input name="search" required></label>';document.body.prepend(form);});
 const result=await core.run('Add and Save email',{values:{email:'valid@example.invalid'}});
 assert.equal(result.status,'complete');assert.equal(attempts.length,1);assert.equal(await page.locator('[name=search]').inputValue(),'');
});
test('goal integrity: a later input resetting an earlier input is repaired before saving',async t=>{
 const {core,page,records,attempts}=await fixture(t,[email,{path:'/name',label:'Name'}]);
 await page.locator('#add').click();await page.locator('form').waitFor();
 await page.locator('[name="/name"]').evaluate(el=>el.addEventListener('input',()=>{document.querySelector('[name="/email"]').value='';},{once:true}));
 const result=await core.run('Fill and Save',{values:{email:'reset@example.invalid',name:'Reset Example'}});
 assert.equal(result.status,'complete',JSON.stringify({reason:result.reason,inputs:result.inputs,steps:result.steps.map(s=>s.plan.action.kind)}));assert.equal(attempts.length,1);assert.equal(records[0]['/email'],'reset@example.invalid');
});
test('goal integrity: updated select options are observed again rather than using an old index',async t=>{
 const {core,page,records,attempts}=await fixture(t,[{path:'/country',label:'Country',type:'select',options:['Choose','Japan']},{path:'/region',label:'Region',type:'select',options:['Choose']},email]);
 await page.locator('#add').click();await page.locator('form').waitFor();
 await page.locator('[name="/country"]').evaluate(el=>el.addEventListener('change',()=>{document.querySelector('[name="/region"]').innerHTML='<option value="">Choose</option><option>Tokyo</option><option>Kanazawa</option>';},{once:true}));
 const result=await core.run('Fill and Save',{values:{country:'Japan',region:'Kanazawa',email:'region@example.invalid'},settleTimeoutMs:300});
 assert.equal(result.status,'complete');assert.equal(attempts.length,1);assert.equal(records[0]['/region'],'Kanazawa');
});
test('goal integrity: a task constraint can disable a prechecked unbound notification',async t=>{
 const base=formEngine();const decider={async decide(req,options){const r=await base.decide(req,options);if(req.questions.action){const off=Object.entries(req.questions.action.criteria).find(([,c])=>c?.kind==='uncheck');if(off)r.answers.action.choice=off[0];}return r;}};
 const {core,records,attempts}=await fixture(t,[email,{path:'/notify',label:'Send notification',type:'checkbox',checked:true,required:false}],{engine:decider});
 const result=await core.run('Add email, disable notification, and Save without sending a notification',{values:{email:'no-notify@example.invalid'}});
 assert.equal(result.status,'complete');assert.equal(attempts.length,1);assert.equal(records[0]['/notify'],undefined);
});
test('goal integrity: a declarative assertion verifies a run without named input values',async t=>{
 const page=await browser.newPage();await page.setContent('<button onclick="this.remove();document.querySelector(\'p\').textContent=\'Saved\'">Save</button><p role="status">Pending</p>');
 const core=new JevBrowser({page,engine:engine((q,r,n)=>n.startsWith('effect_')?'commit':Object.entries(q.criteria).find(([,c])=>c?.kind==='click')?.[0]??'__done__')});t.after(async()=>{await core.close();await page.close();});
 const result=await core.run('Save',{expect:{target:'[role=status]',property:'text',expected:'Saved'},settleTimeoutMs:80});assert.equal(result.status,'complete');assert.equal(result.verification.source,'caller');
});
