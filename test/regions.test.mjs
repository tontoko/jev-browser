import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {fixtureBrowser} from './helpers.mjs';
import {goalFixture,formEngine} from './goal-fixture.mjs';
let browser;before(async()=>{browser=await fixtureBrowser();});after(async()=>{await browser?.close();});
function areaEngine({ambiguous=false}={}){
 const base=formEngine();const requests=[];
 return {requests,async decide(request,options){requests.push(structuredClone(request));
   if(request.questions.region){
     const selected=ambiguous?'__ambiguous__':Object.entries(request.questions.region.criteria).find(([,candidate])=>candidate&&typeof candidate==='object'&&(request.state.purpose==='readback'?candidate.name==='Saved contacts':candidate.role==='form'))?.[0]??'__none__';
     return {answers:{region:{choice:selected,confidence:1}}};
   }return base.decide(request,options);
 }};
}
async function crowded(t,options={}){
 const f=await goalFixture(t,browser,[{path:'/email',label:'Email',type:'email'}],{engine:areaEngine(),...options});
 await f.page.locator('#add').click();await f.page.locator('form').waitFor();
 await f.page.evaluate(()=>{
   const nav=document.createElement('nav');nav.setAttribute('aria-label','Reference links');
   for(let i=0;i<400;i++){const a=document.createElement('a');a.href=`#reference-${i}`;a.textContent=`Reference ${i}`;nav.append(a);}
   document.body.prepend(nav);document.getElementById('results').setAttribute('aria-label','Saved contacts');
 });return f;
}
test('regions: a crowded page can locate its form and result without a caller selector',async t=>{
 const f=await crowded(t);const before=await f.core.snapshot();assert.equal(before.truncatedElements,true);
 const result=await f.core.run('Enter the supplied email and Save a new contact.',{values:{email:'crowded@example.invalid'}});
 assert.equal(result.status,'complete',JSON.stringify(result));assert.equal(f.attempts.length,1);assert.equal(f.records[0]['/email'],'crowded@example.invalid');
 const regions=f.decider.requests.filter(request=>request.questions.region);assert.equal(regions.length,2,'One region decision for input, one for readback; no provider polling');
});
test('regions: a preexisting result outside the input scope does not falsely verify a new save',async t=>{
 const f=await crowded(t,{noReadback:true});
 await f.page.locator('#results').evaluate(el=>{el.innerHTML='<article><h2>Contact created</h2><dl><dt>/email</dt><dd>old-match@example.invalid</dd></dl></article>';});
 const result=await f.core.run('Save this new contact.',{values:{email:'old-match@example.invalid'},settleTimeoutMs:100});
 assert.equal(result.status,'unverified');assert.equal(f.attempts.length,1);
});
test('regions: an explicit caller scope is never silently widened',async t=>{
 const f=await crowded(t);
 await assert.rejects(f.core.run('Fill email and Save.',{values:{email:'scope@example.invalid'},scope:'nav'}),{code:'OBSERVATION_LIMIT'});
 assert.equal(f.attempts.length,0);
});
test('regions: ambiguous region selection produces no form writes',async t=>{
 const f=await crowded(t,{engine:areaEngine({ambiguous:true})});
 await assert.rejects(f.core.run('Fill email and Save.',{values:{email:'ambiguous@example.invalid'}}),{code:'AMBIGUOUS_REGION'});
 assert.equal(await f.page.locator('input').inputValue(),'');assert.equal(f.attempts.length,0);
});
