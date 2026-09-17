import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sdk from '../dist/index.js';
import { apiResult } from './helpers.mjs';
const request = {state:{screen:'synthetic test'},questions:{action:{type:'choice',instructions:'Choose a button',criteria:{a:'Submit',__none__:'No match'}}}};

test('Jev uses the official systemOne payload and validates the chosen ID', async () => {
  let body, url;
  const engine = new sdk.JevDecisionEngine({apiKey:'test-only',model:'pinned-model',fetch:async(u,init)=>{
    url=u; body=JSON.parse(init.body); return Response.json(apiResult(body));
  }});
  const result = await engine.decide(request);
  assert.equal(new URL(url).pathname,'/v1/systemone');
  assert.equal(body.model,'pinned-model');
  assert.deepEqual(body.questions,request.questions);
  assert.equal(result.answers.action.choice,'a');
  assert.equal(result.usage.input_tokens,10);
});
test('unknown model choice cannot become a browser command', async () => {
  const engine = new sdk.JevDecisionEngine({apiKey:'test-only',fetch:async()=>Response.json(apiResult(request,()=> 'invented'))});
  await assert.rejects(engine.decide(request), {code:'INVALID_DECISION'});
});
test('invalid or absent confidence is rejected', async () => {
  const response=apiResult(request); response.answers.action.confidence=2;
  const engine = new sdk.JevDecisionEngine({apiKey:'test-only',fetch:async()=>Response.json(response)});
  await assert.rejects(engine.decide(request), {code:'INVALID_DECISION'});
});
test('provider calls are not silently retried', async () => {
  let count=0;
  const engine = new sdk.JevDecisionEngine({apiKey:'test-only',fetch:async()=>{count++;return Response.json({error:'unavailable'},{status:503});}});
  await assert.rejects(engine.decide(request)); assert.equal(count,1);
});
test('already aborted decisions do not invoke the provider', async () => {
  let count=0;
  const engine = new sdk.JevDecisionEngine({apiKey:'test-only',fetch:async()=>{count++;return Response.json(apiResult(request));}});
  const abort=new AbortController();abort.abort();
  await assert.rejects(engine.decide(request,{signal:abort.signal}));assert.equal(count,0);
});
