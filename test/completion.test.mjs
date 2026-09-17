import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyReadback} from '../dist/completion.js';
import {flattenInputs} from '../dist/bindings.js';
const inputs=()=>flattenInputs({email:'fixture@example.invalid',name:'Fixture Name'}).map(i=>({...i,applied:true}));
const snapshot={id:'snapshot',url:'https://example.invalid/new',title:'Contacts',elements:[],scroll:{y:0,maxY:0,height:720},truncated:false,truncatedTexts:false,truncatedElements:false,
 texts:[{id:'label',frame:0,text:'Email',context:'Email fixture@example.invalid',role:'term'}, {id:'email',frame:0,text:'fixture@example.invalid',context:'Email fixture@example.invalid',role:'definition'},{id:'name',frame:0,text:'Fixture Name',context:'Name Fixture Name',role:'definition'},{id:'status',frame:0,text:'Created',context:'Created',role:'status'}],
 records:[{id:'record',frame:0,textIds:['label','email','name'],context:'Email fixture@example.invalid Name Fixture Name',readOnly:true}]};
test('readback: each field sees value evidence and causal context, not label-only sources',async()=>{
 const result=await verifyReadback(new Map(),snapshot,'Create the contact',inputs(),async request=>{
   assert.deepEqual(Object.keys(request.questions.read_0.criteria).sort(),['__none__','email','name']);
   assert.deepEqual(Object.keys(request.questions.read_1.criteria).sort(),['__none__','email','name']);
   assert.equal(request.state.commit.attempted,true);
   assert.ok(request.state.inputs.every(input=>input.applied===true));
   assert.ok(request.state.page.texts.some(text=>text.id==='status'));
   return {answers:{completion:{choice:'complete',confidence:1},read_0:{choice:'email',confidence:1},read_1:{choice:'name',confidence:1}}};
 });
 assert.deepEqual(result.readback,['/email','/name']);
});
test('readback: invented or mismatched evidence cannot verify completion',async()=>{
 for(const choice of ['label','invented'])assert.equal(await verifyReadback(new Map(),snapshot,'Create',inputs(),async()=>({answers:{completion:{choice:'complete'},read_0:{choice},read_1:{choice:'name'}}})),undefined);
});
test('readback: an unchanged preexisting record never becomes evidence of this commit',async()=>{
 let calls=0;const before=new Map([[snapshot.records[0].context,1]]);
 assert.equal(await verifyReadback(before,snapshot,'Create',inputs(),async()=>{calls++;throw Error('must not call');}),undefined);assert.equal(calls,0);
});
test('readback: a model opinion with no selected identity remains unverified',async()=>{
 assert.equal(await verifyReadback(new Map(),snapshot,'Create',inputs(),async()=>({answers:{completion:{choice:'complete'},read_0:{choice:'__none__'},read_1:{choice:'__none__'}}})),undefined);
});
test('readback: two new matching records are ambiguous rather than arbitrarily selecting one',async()=>{
 const duplicate={...snapshot,records:[...snapshot.records,{...snapshot.records[0],id:'duplicate'}]};let calls=0;
 assert.equal(await verifyReadback(new Map(),duplicate,'Create',inputs(),async()=>{calls++;}),undefined);assert.equal(calls,0);
});

test('readback: a visibly wrong saved field cannot be hidden by filtering its candidate out',async()=>{
 const changed={...snapshot,texts:snapshot.texts.map(source=>source.id==='name'?{...source,text:'Wrong Name',context:'Name Wrong Name'}:source),records:[{...snapshot.records[0],context:'Email fixture@example.invalid Name Wrong Name'}]};
 const result=await verifyReadback(new Map(),changed,'Create the contact',inputs(),async request=>({answers:{completion:{choice:'complete'},read_0:{choice:'email'},read_1:{choice:request.questions.read_1.criteria.name?'name':'__none__'}}}));
 assert.equal(result,undefined);
});
test('readback: genuinely undisplayed fields retain explicit unobserved coverage',async()=>{
 const changed={...snapshot,texts:snapshot.texts.filter(source=>source.id!=='name'),records:[{...snapshot.records[0],textIds:['email'],context:'Email fixture@example.invalid'}]};
 const result=await verifyReadback(new Map(),changed,'Create the contact',inputs(),async()=>({answers:{completion:{choice:'complete'},read_0:{choice:'email'},read_1:{choice:'__none__'}}}));
 assert.deepEqual(result.unobserved,['/name']);assert.deepEqual(result.readback,['/email']);
});

test('readback: one explicitly supplied field can identify a unique new result',async()=>{
 const supplied=flattenInputs({name:'One-field contact'}).map(input=>({...input,applied:true}));
 const current={...snapshot,texts:[{id:'name',frame:0,text:'One-field contact',context:'Name One-field contact',role:'definition'}],records:[{id:'new',frame:0,textIds:['name'],context:'Name One-field contact',readOnly:true}]};
 const result=await verifyReadback(new Map(),current,'Create this contact',supplied,async()=>({answers:{completion:{choice:'complete',confidence:1},read_0:{choice:'name',confidence:1}}}));
 assert.equal(result.basis,'ui-readback');assert.deepEqual(result.readback,['/name']);
});

for (const [expected,shown] of [[true,'on'],[true,'true'],[false,'off'],[false,'false']]) test(`readback: canonical boolean ${shown} verifies the supplied ${expected}`,async()=>{
  const supplied=flattenInputs({email:'fixture@example.invalid',subscribed:expected}).map(input=>({...input,applied:true}));
  const current={...snapshot,texts:[snapshot.texts[1],{id:'subscribed',frame:0,text:shown,context:`Subscribed ${shown}`,role:'definition'}],records:[{id:'new',frame:0,textIds:['email','subscribed'],context:`Email fixture@example.invalid Subscribed ${shown}`,readOnly:true}]};
  const result=await verifyReadback(new Map(),current,'Save the supplied contact',supplied,async()=>({answers:{completion:{choice:'complete'},read_0:{choice:'email'},read_1:{choice:'subscribed'}}}));
  assert.deepEqual(result?.readback,['/email','/subscribed']);
});
test('readback: a mismatched visible boolean cannot verify the requested state',async()=>{
  const supplied=flattenInputs({email:'fixture@example.invalid',subscribed:true}).map(input=>({...input,applied:true}));
  const current={...snapshot,texts:[snapshot.texts[1],{id:'subscribed',frame:0,text:'off',context:'Subscribed off',role:'definition'}],records:[{id:'new',frame:0,textIds:['email','subscribed'],context:'Email fixture@example.invalid Subscribed off',readOnly:true}]};
  assert.equal(await verifyReadback(new Map(),current,'Save',supplied,async()=>({answers:{completion:{choice:'complete'},read_0:{choice:'email'},read_1:{choice:'subscribed'}}})),undefined);
});
