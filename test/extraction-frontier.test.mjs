import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {z} from 'zod';
import {extractStructured} from '../dist/structured.js';

function rows(count,padding=''){
  const texts=[],records=[];
  for(let i=0;i<count;i++){
    const context=`Person ${i} amount ${i+10} ${padding}`;
    const name={id:`n${i}`,frame:0,text:`Person ${i}`,context,role:'cell'};
    const amount={id:`a${i}`,frame:0,text:String(i+10),context,role:'cell'};
    texts.push(name,amount);records.push({id:`row${i}`,frame:0,context,textIds:[name.id,amount.id],readOnly:true});
  }
  return {id:'rows',url:'https://fixture.example.invalid/',title:'People',elements:[],texts,records,truncated:false,truncatedElements:false,truncatedTexts:false,scroll:{y:0,maxY:0,height:720}};
}
const schema=z.array(z.object({name:z.string(),amount:z.number()}));
function decide(request){
  return {model:'fixture',answers:Object.fromEntries(Object.entries(request.questions).map(([id,q])=>{
    if(q.criteria.include)return [id,{choice:'include',confidence:1}];
    const candidates=Object.entries(q.criteria).filter(([,x])=>typeof x==='object');
    const contextIndex=/Use only state.contexts.(g\d+)/.exec(q.instructions)?.[1];
    const context=contextIndex?request.state.contexts[contextIndex]:request.state;
    for(const [,candidate] of candidates)assert.ok(context.sources.some(source=>source.id===candidate.sourceId),'each question keeps only its record evidence');
    const choice=candidates.find(([,x])=>q.instructions.includes('"amount"')?typeof x.value==='number':typeof x.value==='string'&&x.value.startsWith('Person '))[0];
    return [id,{choice,confidence:0.98}];
  }))};
}

test('extraction frontier: independent 64/16 question chunks overlap without losing or ranking questions',async()=>{
  let active=0,peak=0;const requests=[];
  const engine={async decide(request,{signal}){requests.push(request);active++;peak=Math.max(peak,active);try{await sleep(15,undefined,{signal});return decide(request);}finally{active--;}}};
  const result=await extractStructured(rows(40),'Read all people',schema,()=>engine,new AbortController().signal,250);
  assert.equal(peak,2);
  assert.deepEqual(requests.map(r=>Object.keys(r.questions).length),[40,64,16]);
  assert.equal(result.decisions.length,3,'retain per-request metadata for existing consumers');
  assert.deepEqual(result.data,Array.from({length:40},(_,i)=>({name:`Person ${i}`,amount:i+10})));
});

test('extraction frontier: chunk contexts stay below budget without dropping candidates',async()=>{
  const requests=[];const engine={async decide(request){requests.push(request);return decide(request);}};
  const result=await extractStructured(rows(70,'context '.repeat(80)),'Read all people',schema,()=>engine,new AbortController().signal,250);
  assert.equal(result.data.length,70);
  assert.ok(requests.every(request=>Buffer.byteLength(JSON.stringify(request))<=128*1024));
  assert.ok(requests.every(request=>Object.keys(request.questions).length<=64));
  for(let i=0;i<70;i++)assert.equal(result.evidence[`${i}.amount`].id,`a${i}`);
  assert.deepEqual(result.data,Array.from({length:70},(_,i)=>({name:`Person ${i}`,amount:i+10})));
});

test('extraction frontier: custom engines receive the same confidence validation as semantic verification',async()=>{
  const engine={async decide(request){const result=decide(request);for(const answer of Object.values(result.answers))answer.confidence=2;return result;}};
  await assert.rejects(extractStructured(rows(1),'Read all people',schema,()=>engine,new AbortController().signal,250),{code:'INVALID_DECISION'});
});
