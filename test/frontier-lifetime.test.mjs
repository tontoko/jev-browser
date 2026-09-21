import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {decideFrontier,emptyDecisionUsage} from '../dist/frontier.js';
const request={state:{},questions:Object.fromEntries(Array.from({length:80},(_,i)=>[`q${i}`,{type:'choice',instructions:'Select',criteria:{yes:'Yes'}}]))};
const answers=r=>Object.fromEntries(Object.keys(r.questions).map(id=>[id,{choice:'yes',confidence:1}]));

for(const invalid of [false,true])test(`frontier ownership: ${invalid?'invalid answer':'provider rejection'} aborts siblings before returning`,async()=>{
  const parent=new AbortController(),usage=emptyDecisionUsage();let started,finished=false,aborted=false;
  const ready=new Promise(resolve=>{started=resolve;});
  const failure=new Error('first request failed');
  const engine={async decide(r,{signal}){
    if(Object.hasOwn(r.questions,'q0')){await ready;if(!invalid)throw failure;return {answers:{q0:{choice:'not-offered',confidence:1}}};}
    started();
    try{await sleep(100,undefined,{signal});return {answers:answers(r)};}
    catch(error){aborted=signal.aborted;throw error;}
    finally{finished=true;}
  }};
  await assert.rejects(decideFrontier(engine,request,{signal:parent.signal,usage}),error=>invalid?error.code==='INVALID_DECISION':error===failure);
  assert.equal(aborted,true);assert.equal(finished,true);
  assert.equal(parent.signal.aborted,false,'only the current frontier owns this cancellation');
});

test('frontier accounting: a successful sibling is counted even when the operation fails',async()=>{
  const usage=emptyDecisionUsage();let success;const ready=new Promise(resolve=>{success=resolve;});
  const engine={async decide(r){
    if(Object.hasOwn(r.questions,'q0')){success();return {answers:answers(r),usage:{input_tokens:7,output_tokens:3}};}
    await ready;await sleep(5);throw new Error('unavailable');
  }};
  await assert.rejects(decideFrontier(engine,request,{signal:new AbortController().signal,usage}),/unavailable/);
  assert.equal(usage.requests,2);assert.equal(usage.inputTokens,7);assert.equal(usage.outputTokens,3);
  assert.equal(usage.serialDecisionDepth,1);
});

test('frontier ownership: outer cancellation reaches every chunk',async()=>{
  const controller=new AbortController();let count=0,closed=0;
  const engine={async decide(r,{signal}){count++;if(count===2)controller.abort();try{await sleep(100,undefined,{signal});return {answers:answers(r)};}finally{closed++;}}};
  await assert.rejects(decideFrontier(engine,request,{signal:controller.signal,usage:emptyDecisionUsage()}));
  assert.equal(closed,2);
});
