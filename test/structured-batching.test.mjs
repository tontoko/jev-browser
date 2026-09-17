import {test} from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {extractStructured} from '../dist/structured.js';
import {engine} from './helpers.mjs';
function rows(count){
  const texts=[],records=[];
  for(let i=0;i<count;i++){
    const name={id:`name${i}`,frame:0,text:`Person ${i}`,context:`Person ${i} amount ${i+10}`,role:'cell'};
    const amount={id:`amount${i}`,frame:0,text:String(i+10),context:name.context,role:'cell'};
    texts.push(name,amount);records.push({id:`row${i}`,frame:0,context:name.context,textIds:[name.id,amount.id],readOnly:true});
  }
  return {id:'rows',url:'https://fixture.example.invalid/',title:'People',elements:[],texts,records,truncated:false,truncatedTexts:false,truncatedElements:false,scroll:{y:0,maxY:0,height:720}};
}
const schema=z.array(z.object({name:z.string(),amount:z.number()}));
function choices(){return engine(q=>{
  if(q.criteria.include)return 'include';
  return q.instructions.includes('"amount"')?candidate=>typeof candidate?.value==='number':candidate=>typeof candidate?.value==='string'&&candidate.value.startsWith('Person ');
});}
test('structured batching: twenty records use two provider requests, not twenty-one',async()=>{
  const provider=choices();const result=await extractStructured(rows(20),'Read all people',schema,()=>provider,new AbortController().signal,250);
  assert.equal(provider.requests.length,2);assert.equal(result.decisions.length,2);
  assert.deepEqual(result.data,Array.from({length:20},(_,i)=>({name:`Person ${i}`,amount:i+10})));
  for(let i=0;i<20;i++)assert.equal(result.evidence[`${i}.amount`].context,`Person ${i} amount ${i+10}`);
});
test('structured batching: larger frontiers are bounded and keep output order',async()=>{
  const provider=choices();const result=await extractStructured(rows(40),'Read all people',schema,()=>provider,new AbortController().signal,250);
  assert.equal(provider.requests.length,3);
  assert.ok(provider.requests.every(request=>Object.keys(request.questions).length<=64));
  assert.deepEqual(result.data,Array.from({length:40},(_,i)=>({name:`Person ${i}`,amount:i+10})));
});
test('structured batching: a provider failure rejects the frontier without leaving promises pending',async()=>{
  let calls=0;const base=choices();const provider={async decide(request,options){calls++;if(calls===2)throw new Error('Fixture outage');return base.decide(request,options);}};
  await assert.rejects(extractStructured(rows(20),'Read all people',schema,()=>provider,new AbortController().signal,250),/Fixture outage/);
  assert.equal(calls,2);
});
