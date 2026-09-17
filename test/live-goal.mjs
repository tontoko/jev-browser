// Explicit real Jev tests against a local HTTP application, not a model-self-graded result.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {fixtureBrowser} from './helpers.mjs';
import {goalFixture} from './goal-fixture.mjs';
let browser;
before(async()=>{assert.ok(process.env.JEV_API_KEY||process.env.TYPESAFE_API_KEY);browser=await fixtureBrowser();});
after(async()=>{await browser?.close();});
function report(name,result,start){console.log(JSON.stringify({case:name,status:result.status,reason:result.reason,steps:result.steps.length,usage:result.usage,verification:result.verification,totalMs:Math.round(performance.now()-start)}));}
test('LIVE goal: sixteen fields are bound together and a single new record is independently verified',async t=>{
  const fields=Array.from({length:16},(_,i)=>({path:`/field${i}`,label:`Field ${i}`}));
  const values=Object.fromEntries(fields.map((_,i)=>[`field${i}`,i===0?'live-sixteen@example.invalid':`separate-${i}-value`]));
  const {core,records,attempts}=await goalFixture(t,browser,fields,{live:true});
  const start=performance.now();const result=await core.run('Open Add, fill all sixteen supplied fields (field0 through field15), then Save the new contact. Verify the created record.',{values});
  report('sixteen',result,start);assert.equal(result.status,'complete',JSON.stringify(result));assert.equal(attempts.length,1);assert.equal(records.length,1);
  assert.deepEqual(records[0],Object.fromEntries(Object.entries(values).map(([key,value])=>['/'+key,value])));
  assert.ok(result.inputs.every(input=>input.applied));assert.ok(result.usage.requests<=6);assert.ok(!JSON.stringify(result).includes(values.field0));
});
test('LIVE goal: one nested request differentiates student and guardian and selects locally',async t=>{
  const fields=[{path:'/student/name',label:'Student name'},{path:'/student/email',label:'Student email'}, {path:'/guardian/name',label:'Guardian name'},{path:'/guardian/email',label:'Guardian email'},{path:'/course',label:'Instrument',type:'select',options:['Choose','Viola da gamba','Piano']}];
  const values={student:{name:'Student One',email:'student-one@example.invalid'},guardian:{name:'Guardian Two',email:'guardian-two@example.invalid'},course:'Viola da gamba'};
  const {core,records,attempts}=await goalFixture(t,browser,fields,{live:true,delayMs:400,title:'Students',formName:'New student',resultTitle:'Student created'});const start=performance.now();
  const result=await core.run('Add a new student. Fill their name and email, their guardian name and email, and select the supplied course. Save and verify the new student record.',{values});
  report('nested',result,start);assert.equal(result.status,'complete',JSON.stringify(result));assert.equal(attempts.length,1);assert.equal(records.length,1);
  assert.equal(records[0]['/student/email'],values.student.email);assert.equal(records[0]['/guardian/email'],values.guardian.email);assert.equal(records[0]['/course'],values.course);
});

import {wizardFixture} from './wizard-fixture.mjs';
test('LIVE goal: one request completes a two-screen wizard and reads back both stages',async t=>{
 const {core,records,attempts}=await wizardFixture(t,browser,{live:true});const start=performance.now();
 const result=await core.run('Create a new contact. Enter the supplied name, continue to the email step, enter the email and Save. Verify the created contact.',{values:{name:'Wizard Contact',email:'live-wizard@example.invalid'}});
 report('wizard',result,start);assert.equal(result.status,'complete',JSON.stringify(result));assert.equal(attempts.length,1);assert.deepEqual(records,[{'/name':'Wizard Contact','/email':'live-wizard@example.invalid'}]);
 assert.ok(result.inputs.every(input=>input.applied&&input.readback));
});
