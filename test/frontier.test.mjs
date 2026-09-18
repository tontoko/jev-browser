import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decideFrontier,emptyDecisionUsage} from '../dist/frontier.js';

const questions=count=>Object.fromEntries(Array.from({length:count},(_,i)=>[`q${i}`,{type:'choice',instructions:`Question ${i}`,criteria:{yes:'Yes'}}]));

test('frontier: transport chunks share one serial dependency depth',async()=>{
 let active=0,peak=0;
 const engine={async decide(request){
   active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,20));active--;
   return {answers:Object.fromEntries(Object.keys(request.questions).map(id=>[id,{choice:'yes',confidence:1}])),model:'fixture',usage:{input_tokens:3,output_tokens:2}};
 }};
 const usage=emptyDecisionUsage();
 const result=await decideFrontier(engine,{state:{task:'fixture'},questions:questions(130)},{signal:new AbortController().signal,usage});
 assert.equal(Object.keys(result.answers).length,130);
 assert.equal(usage.requests,3);
 assert.equal(usage.questions,130);
 assert.equal(usage.serialDecisionDepth,1);
 assert.equal(usage.inputTokens,9);
 assert.equal(usage.outputTokens,6);
 assert.ok(usage.providerMs>=15);
 assert.ok(peak>1,'independent transport chunks should overlap');
});

test('frontier: missing or unknown answers are rejected',async()=>{
 const usage=emptyDecisionUsage();
 const engine={async decide(){return {answers:{q0:{choice:'unknown',confidence:1}}};}};
 await assert.rejects(decideFrontier(engine,{state:{},questions:{q0:{type:'choice',instructions:'Pick',criteria:{yes:'Yes'}}}},{signal:new AbortController().signal,usage}),{code:'INVALID_DECISION'});
});

test('frontier: invalid confidence is rejected',async()=>{
 const usage=emptyDecisionUsage();
 const engine={async decide(){return {answers:{q0:{choice:'yes',confidence:2}}};}};
 await assert.rejects(decideFrontier(engine,{state:{},questions:{q0:{type:'choice',instructions:'Pick',criteria:{yes:'Yes'}}}},{signal:new AbortController().signal,usage}),{code:'INVALID_DECISION'});
});

test('frontier: abort before launch performs no provider work',async()=>{
 let calls=0;const abort=new AbortController();abort.abort();
 const usage=emptyDecisionUsage();
 const engine={async decide(){calls++;return {answers:{}};}};
 await assert.rejects(decideFrontier(engine,{state:{},questions:questions(1)},{signal:abort.signal,usage}),error=>error?.name==='AbortError'||error?.code==='ABORT_ERR');
 assert.equal(calls,0);assert.equal(usage.requests,0);assert.equal(usage.serialDecisionDepth,0);
});

test('frontier: provider request budget is checked before any chunk launches',async()=>{
 let calls=0;const usage=emptyDecisionUsage();
 const engine={async decide(){calls++;return {answers:{}};}};
 await assert.rejects(decideFrontier(engine,{state:{},questions:questions(130)},{signal:new AbortController().signal,usage,maxRequests:2}),{code:'DECISION_LIMIT'});
 assert.equal(calls,0);assert.equal(usage.requests,0);assert.equal(usage.serialDecisionDepth,0);
});
