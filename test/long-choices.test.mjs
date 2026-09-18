import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {JevBrowser} from '../dist/index.js';
import {fixtureBrowser,engine} from './helpers.mjs';
import {goalFixture} from './goal-fixture.mjs';
let browser;
before(async()=>{browser=await fixtureBrowser();});after(async()=>{await browser?.close();});

for(const count of [300,1000])test(`long choices: ${count} native options remain locally resolvable in one goal`,async t=>{
 const labels=Array.from({length:count},(_,i)=>`Instrument ${i}`);
 const {core,records,attempts,decider}=await goalFixture(t,browser,[{path:'/name',label:'Name'},{path:'/instrument',label:'Instrument',type:'select',options:labels}]);
 const result=await core.run('Add the contact, enter all supplied information, select the instrument and Save.',{values:{name:'Long list person',instrument:labels.at(-1)}});
 assert.equal(result.status,'complete');assert.equal(attempts.length,1);
 assert.equal(records[0]['/instrument'],labels.at(-1));
 assert.ok(result.usage.requests<=4);
 assert.ok(!JSON.stringify(decider.requests).includes('Instrument 157'),'Unrelated option lists should stay local when the supplied value is resolved exactly');
});
test('long choices: a prose-only action resolves the last option without dropping candidates',async t=>{
 const page=await browser.newPage();await page.setContent('<label>Instrument<select>'+Array.from({length:300},(_,i)=>`<option value="v${i}">Instrument ${i}</option>`).join('')+'</select></label>');
 const decider=engine((question,_request,id)=>{
   if(id==='action')return candidate=>candidate?.kind==='select';
   return Object.entries(question.criteria).find(([,candidate])=>candidate?.option?.label==='Instrument 299')?.[0]??'__none__';
 });
 const core=new JevBrowser({page,engine:decider});t.after(async()=>{await core.close();await page.close();});
 await core.act('Choose Instrument 299.');assert.equal(await page.locator('select').inputValue(),'v299');
 assert.ok(decider.requests.length>=2);
 assert.ok(decider.requests.every(request=>Object.values(request.questions).every(question=>Object.keys(question.criteria).length<=66)));
});
test('long choices: duplicate matches across partitions are ambiguous, not first-match wins',async t=>{
 const page=await browser.newPage();await page.setContent('<label>Instrument<select>'+Array.from({length:300},(_,i)=>`<option value="v${i}">${i===5||i===299?'Duplicate':`Instrument ${i}`}</option>`).join('')+'</select></label>');
 const decider=engine((question,_request,id)=>id==='action'?candidate=>candidate?.kind==='select':Object.entries(question.criteria).find(([,candidate])=>candidate?.option?.label==='Duplicate')?.[0]??'__none__');
 const core=new JevBrowser({page,engine:decider});t.after(async()=>{await core.close();await page.close();});
 await assert.rejects(core.act('Choose Duplicate.'),{code:'AMBIGUOUS_SELECTION'});
 assert.equal(await page.locator('select').inputValue(),'v0');
});
test('long choices: an unknown option does not execute any selection',async t=>{
 const page=await browser.newPage();await page.setContent('<label>Instrument<select>'+Array.from({length:300},(_,i)=>`<option value="v${i}">Instrument ${i}</option>`).join('')+'</select></label>');
 const decider=engine((q,_r,id)=>id==='action'?candidate=>candidate?.kind==='select':'__none__');
 const core=new JevBrowser({page,engine:decider});t.after(async()=>{await core.close();await page.close();});
 await assert.rejects(core.act('Choose an unavailable instrument.'),{code:'NO_MATCH'});
 assert.equal(await page.locator('select').inputValue(),'v0');
});

for(const preserve of [true,false])test(`native selection: changed semantics at the same index ${preserve?'are repaired':'cannot be saved'}`,async t=>{
 const f=await goalFixture(t,browser,[{path:'/instrument',label:'Instrument',type:'select',options:['Choose','Piano','Viola da gamba']},{path:'/name',label:'Name'}]);
 await f.page.locator('#add').click();await f.page.locator('form').waitFor();
 await f.page.locator('input').evaluate((input,preserve)=>{
   input.addEventListener('input',()=>{
     const select=input.form.querySelector('select');
     select.innerHTML='<option>Choose</option><option>Wrong instrument</option>'+(preserve?'<option>Piano</option>':'');
     select.selectedIndex=1;
   },{once:true});
 },preserve);
 const result=await f.core.run('Fill the instrument and name, then Save.',{values:{instrument:'Piano',name:'Index Drift'}});
 if(preserve){assert.equal(result.status,'complete');assert.equal(f.attempts.length,1);assert.equal(f.records[0]['/instrument'],'Piano');}
 else{assert.notEqual(result.status,'complete');assert.equal(f.attempts.length,0);}
});
