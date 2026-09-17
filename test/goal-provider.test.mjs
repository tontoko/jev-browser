import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JevDecisionEngine} from '../dist/index.js';
import {apiResult} from './helpers.mjs';
const request={state:'synthetic',questions:{action:{type:'choice',instructions:'Choose A',criteria:{a:'A'}}}};
test('goal provider: opt-in decision retries use the SDK and never call a browser',async()=>{
 let calls=0;const provider=new JevDecisionEngine({apiKey:'test-only',fetch:async()=>++calls===1?new Response('{}',{status:529,headers:{'retry-after-ms':'1'}}):Response.json(apiResult(request))});
 const result=await provider.decide(request,{maxRetries:1});assert.equal(result.answers.action.choice,'a');assert.equal(calls,2);
});
test('goal provider: cancellation stops the SDK retry before another HTTP request',async()=>{
 let calls=0;const abort=new AbortController();const provider=new JevDecisionEngine({apiKey:'test-only',fetch:async()=>{calls++;setTimeout(()=>abort.abort(),10);return new Response('{}',{status:529,headers:{'retry-after-ms':'200'}});}});
 await assert.rejects(provider.decide(request,{signal:abort.signal,maxRetries:1}),{code:'CANCELLED'});assert.equal(calls,1);
});
