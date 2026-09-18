// Real provider, synthetic app: opaque names/IDs and human labels, not caller JSON paths.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {fixtureBrowser} from './helpers.mjs';
import {modernFixture,fieldOrder} from './modern-fixture.mjs';
import {goalFixture} from './goal-fixture.mjs';
import {JevBrowser} from '../dist/index.js';
let browser;
before(async()=>{assert.ok(process.env.JEV_API_KEY||process.env.TYPESAFE_API_KEY);browser=await fixtureBrowser();});after(async()=>{await browser?.close();});
const variants=Number(process.env.JEV_MODERN_VARIANTS??6);assert.ok(Number.isInteger(variants)&&variants>=1&&variants<=6);
for(const widget of ['portal','inline','editable','search'])for(let variant=0;variant<variants;variant++)test(`LIVE modern ${widget} / layout ${variant+1}`,{timeout:60000},async t=>{
 const f=await modernFixture(t,browser,{widget,variant,live:true,delayMs:widget==='search'?250:0,noise:variant%2===1});
 const values={student:{fullName:`Learner ${widget} ${variant}`,contactEmail:`learner-${widget}-${variant}@example.invalid`},instrument:'Viola da gamba'};
 const start=performance.now();const result=await f.core.run('Create one new learner. Enter every supplied detail, select the supplied lesson instrument and save. Verify the new learner record.',{values,maxDecisions:10});
 console.log(JSON.stringify({case:widget,variant,layout:fieldOrder(variant),status:result.status,reason:result.reason,steps:result.steps.length,usage:result.usage,submissions:f.attempts.length,totalMs:Math.round(performance.now()-start)}));
 assert.equal(result.status,'complete',JSON.stringify(result));assert.equal(f.attempts.length,1);
 assert.deepEqual(f.records,[{fullName:values.student.fullName,email:values.student.contactEmail,instrument:'gamba'}]);
 assert.ok(result.inputs.every(input=>input.applied&&input.readback));assert.equal(await f.page.evaluate(()=>window.decoyClicked===true),false);
});
test('LIVE modern native list: 1000 options do not require all options in a named-input decision',async t=>{
 const options=Array.from({length:1000},(_,i)=>`Instrument ${i}`);
 const f=await goalFixture(t,browser,[{path:'/name',label:'Name'},{path:'/instrument',label:'Instrument',type:'select',options}],{live:true});
 const result=await f.core.run('Add one new contact, enter the supplied name, select the supplied instrument and Save.',{values:{name:'Large-list learner',instrument:'Instrument 999'}});
 console.log(JSON.stringify({case:'1000-options',status:result.status,usage:result.usage,steps:result.steps.length}));
 assert.equal(result.status,'complete');assert.equal(f.attempts.length,1);assert.equal(f.records[0]['/instrument'],'Instrument 999');
});
test('LIVE modern native list: a prose instruction resolves a distant option in bounded partitions',async t=>{
 const page=await browser.newPage();await page.setContent('<label>Instrument<select>'+Array.from({length:300},(_,i)=>`<option value="v${i}">Instrument ${i}</option>`).join('')+'</select></label>');
 const core=new JevBrowser({page});t.after(async()=>{await core.close();await page.close();});
 await core.act('Select exactly Instrument 299 in the Instrument field.');assert.equal(await page.locator('select').inputValue(),'v299');
});
