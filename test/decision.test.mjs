import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sdk from '../dist/index.js';
import { publicError } from '../dist/errors.js';
import { workersAiModel } from '../dist/decision.js';
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

test('custom System One base URL does not require a cloud API key', async () => {
  const saved={JEV_API_KEY:process.env.JEV_API_KEY,TYPESAFE_API_KEY:process.env.TYPESAFE_API_KEY};
  delete process.env.JEV_API_KEY; delete process.env.TYPESAFE_API_KEY;
  try {
    let url;
    const engine = new sdk.JevDecisionEngine({baseURL:'http://127.0.0.1:8765',fetch:async(u,init)=>{
      url=u; return Response.json(apiResult(JSON.parse(init.body)));
    }});
    const result=await engine.decide(request);
    assert.equal(url,'http://127.0.0.1:8765/v1/systemone');
    assert.equal(result.answers.action.choice,'a');
  } finally {
    for(const [key,value] of Object.entries(saved)) value===undefined?delete process.env[key]:process.env[key]=value;
  }
});

test('JEV_BASE_URL alone selects a custom System One endpoint', async () => {
  const saved={JEV_API_KEY:process.env.JEV_API_KEY,TYPESAFE_API_KEY:process.env.TYPESAFE_API_KEY,JEV_BASE_URL:process.env.JEV_BASE_URL};
  delete process.env.JEV_API_KEY; delete process.env.TYPESAFE_API_KEY;
  process.env.JEV_BASE_URL='http://127.0.0.1:8765';
  try {
    let url;
    const engine = new sdk.JevDecisionEngine({fetch:async(u,init)=>{
      url=u; return Response.json(apiResult(JSON.parse(init.body)));
    }});
    const result=await engine.decide(request);
    assert.equal(url,'http://127.0.0.1:8765/v1/systemone');
    assert.equal(result.answers.action.choice,'a');
  } finally {
    for(const [key,value] of Object.entries(saved)) value===undefined?delete process.env[key]:process.env[key]=value;
  }
});

test('default hosted endpoint still requires an API key', () => {
  const saved={JEV_API_KEY:process.env.JEV_API_KEY,TYPESAFE_API_KEY:process.env.TYPESAFE_API_KEY,JEV_BASE_URL:process.env.JEV_BASE_URL};
  delete process.env.JEV_API_KEY; delete process.env.TYPESAFE_API_KEY; delete process.env.JEV_BASE_URL;
  try { assert.throws(()=>new sdk.JevDecisionEngine(),{code:'CONFIG'}); }
  finally { for(const [key,value] of Object.entries(saved)) value===undefined?delete process.env[key]:process.env[key]=value; }
});

const providerEnv=['JEV_API_KEY','TYPESAFE_API_KEY','JEV_BASE_URL','TYPESAFE_BASE_URL','JEV_ENDPOINT_API_KEY'];
async function withEnv(values,body){
  const saved=Object.fromEntries(providerEnv.map(key=>[key,process.env[key]]));
  for(const key of providerEnv) delete process.env[key];
  Object.assign(process.env,values);
  try { return await body(); }
  finally { for(const [key,value] of Object.entries(saved)) value===undefined?delete process.env[key]:process.env[key]=value; }
}
// Records where each request went and which credential it carried; nothing leaves the process.
async function sent(options){
  let seen;
  await new sdk.JevDecisionEngine({...options,fetch:async(url,init)=>{seen={url:String(url),authorization:new Headers(init.headers).get('authorization')};return Response.json(apiResult(JSON.parse(init.body)));}}).decide(request);
  return seen;
}

test('hosted keys from the environment are never sent to a custom System One endpoint', async () => {
  for(const [env,options,url] of [
    [{JEV_API_KEY:'HOSTED-TEST-KEY'},{baseURL:'http://127.0.0.1:8765'},'http://127.0.0.1:8765/v1/systemone'],
    [{JEV_API_KEY:'HOSTED-TEST-KEY',JEV_BASE_URL:'http://127.0.0.1:8765'},{},'http://127.0.0.1:8765/v1/systemone'],
    [{TYPESAFE_API_KEY:'HOSTED-TEST-KEY',JEV_BASE_URL:'https://proxy.example.invalid/jev'},{},'https://proxy.example.invalid/jev/v1/systemone'],
    [{JEV_API_KEY:'HOSTED-TEST-KEY'},{baseURL:'http://api.typesafe.ai'},'http://api.typesafe.ai/v1/systemone'],
  ]) await withEnv(env,async()=>assert.deepEqual(await sent(options),{url,authorization:'Bearer local'},JSON.stringify({env,options})));
});
test('the SDK TYPESAFE_BASE_URL cannot redirect a hosted key away from hosted Jev', async () => {
  await withEnv({JEV_API_KEY:'HOSTED-TEST-KEY',TYPESAFE_BASE_URL:'http://127.0.0.1:8765'},async()=>{
    assert.deepEqual(await sent({}),{url:'https://api.typesafe.ai/v1/systemone',authorization:'Bearer HOSTED-TEST-KEY'});
    assert.deepEqual(await sent({baseURL:'https://api.typesafe.ai/'}),{url:'https://api.typesafe.ai/v1/systemone',authorization:'Bearer HOSTED-TEST-KEY'});
  });
});
test('a custom endpoint is authenticated only by an explicit apiKey or JEV_ENDPOINT_API_KEY', async () => {
  await withEnv({JEV_API_KEY:'HOSTED-TEST-KEY'},async()=>{
    assert.equal((await sent({baseURL:'https://proxy.example.invalid',apiKey:'PROXY-TEST-KEY'})).authorization,'Bearer PROXY-TEST-KEY');
    assert.equal((await sent({apiKey:'EXPLICIT-TEST-KEY'})).authorization,'Bearer EXPLICIT-TEST-KEY');
  });
  await withEnv({JEV_API_KEY:'HOSTED-TEST-KEY',JEV_ENDPOINT_API_KEY:'ENDPOINT-TEST-KEY',JEV_BASE_URL:'https://proxy.example.invalid'},async()=>{
    assert.equal((await sent({})).authorization,'Bearer ENDPOINT-TEST-KEY');
    assert.equal((await sent({baseURL:'https://api.typesafe.ai'})).authorization,'Bearer HOSTED-TEST-KEY');
  });
});
test('credentials are refused over plain HTTP to a non-loopback endpoint', async () => {
  await withEnv({},async()=>{
    for(const options of [{apiKey:'TEST-KEY',baseURL:'http://example.invalid:8765'},{apiKey:'TEST-KEY',baseURL:'http://10.0.0.5'}])
      assert.throws(()=>new sdk.JevDecisionEngine({...options,fetch:async()=>assert.fail('No request may be sent.')}),{code:'CONFIG',message:/HTTPS or to a loopback/});
    for(const baseURL of ['http://localhost:8765','http://127.0.0.2:8765','http://[::1]:8765'])
      assert.equal((await sent({apiKey:'TEST-KEY',baseURL})).authorization,'Bearer TEST-KEY',baseURL);
    assert.equal((await sent({baseURL:'http://example.invalid:8765'})).authorization,'Bearer local');
  });
  await withEnv({JEV_ENDPOINT_API_KEY:'ENDPOINT-TEST-KEY',JEV_BASE_URL:'http://example.invalid:8765'},async()=>
    assert.throws(()=>new sdk.JevDecisionEngine(),{code:'CONFIG'}));
});
test('blank keys are unset and do not block a custom endpoint', async () => {
  for(const [env,options] of [[{JEV_API_KEY:''},{baseURL:'http://127.0.0.1:8765'}],[{TYPESAFE_API_KEY:'  ',JEV_BASE_URL:'http://127.0.0.1:8765'},{}],[{JEV_ENDPOINT_API_KEY:' '},{baseURL:'http://127.0.0.1:8765',apiKey:''}]])
    await withEnv(env,async()=>assert.equal((await sent(options)).authorization,'Bearer local',JSON.stringify({env,options})));
  await withEnv({JEV_API_KEY:'HOSTED-TEST-KEY',JEV_BASE_URL:' '},async()=>assert.deepEqual(await sent({}),{url:'https://api.typesafe.ai/v1/systemone',authorization:'Bearer HOSTED-TEST-KEY'}));
  await withEnv({JEV_API_KEY:'',TYPESAFE_API_KEY:' '},async()=>assert.throws(()=>new sdk.JevDecisionEngine({apiKey:''}),{code:'CONFIG',message:/^Hosted Jev needs/}));
});
test('an invalid decision baseURL is a configuration error', async () => {
  await withEnv({JEV_API_KEY:'HOSTED-TEST-KEY'},async()=>{
    for(const baseURL of ['not a url','ftp://127.0.0.1:8765']) assert.throws(()=>new sdk.JevDecisionEngine({baseURL}),{code:'CONFIG'},baseURL);
  });
});

// The shape hosted Jev returns for an over-long request (captured live for #64).
const tokenLimit = () => Response.json({detail:{error_type:'max_tokens_exceeded'}},{status:400});
test('a hosted input token rejection is OBSERVATION_LIMIT with narrowing guidance, not PROVIDER_ERROR', async () => {
  let count=0;
  const engine = new sdk.JevDecisionEngine({apiKey:'test-only',fetch:async()=>{count++;return tokenLimit();}});
  await assert.rejects(engine.decide(request,{maxRetries:2}), error => error.code==='OBSERVATION_LIMIT' && error.retryable===false && /scope/.test(error.message) && /maxElements/.test(error.message) && error.cause?.status===400);
  assert.equal(count,1);
  assert.deepEqual(Object.keys(publicError(await engine.decide(request).catch(e=>e))),['code','message','retryable']);
});
test('other HTTP 400 rejections stay non-retryable PROVIDER_ERROR', async () => {
  for (const body of [{detail:{error_type:'invalid_request'}},{error_type:'max_tokens_exceeded'},'max_tokens_exceeded',{detail:'max_tokens_exceeded'}]) {
    const engine = new sdk.JevDecisionEngine({apiKey:'test-only',fetch:async()=>typeof body==='string'?new Response(body,{status:400}):Response.json(body,{status:400})});
    await assert.rejects(engine.decide(request), {code:'PROVIDER_ERROR',retryable:false,message:/HTTP 400/});
  }
  const engine = new sdk.JevDecisionEngine({apiKey:'test-only',fetch:async()=>Response.json({detail:{error_type:'max_tokens_exceeded'}},{status:500})});
  await assert.rejects(engine.decide(request), {code:'PROVIDER_ERROR',retryable:true});
});

const runUrl='https://api.cloudflare.com/client/v4/accounts/acc/ai/run/@cf/cloudflare/clef-flash';
test('a Workers AI run URL posts to that URL with the short model name and reads result', async () => {
  let url, body, auth;
  const engine = new sdk.JevDecisionEngine({baseURL:runUrl,apiKey:'cf-token',model:'jev-latest',fetch:async(u,init)=>{
    url=String(u); body=JSON.parse(init.body); auth=new Headers(init.headers).get('authorization');
    return Response.json({result:{...apiResult(body),model:'clef-flash'},success:true,errors:[],messages:[]});
  }});
  const result = await engine.decide(request);
  assert.equal(url,runUrl);
  assert.equal(body.model,'clef-flash');
  assert.deepEqual(body.questions,request.questions);
  assert.equal(auth,'Bearer cf-token');
  assert.equal(result.answers.action.choice,'a');
  assert.equal(result.model,'clef-flash');
});
test('a Workers AI success false or HTTP error is a provider error, never an answer', async () => {
  const ok = new sdk.JevDecisionEngine({baseURL:runUrl,apiKey:'cf',fetch:async()=>Response.json({success:false,errors:[{message:'Bad input'}],result:null})});
  await assert.rejects(ok.decide(request), {code:'PROVIDER_ERROR'});
  const down = new sdk.JevDecisionEngine({baseURL:runUrl,apiKey:'cf',fetch:async()=>Response.json({success:false,errors:[]},{status:401})});
  await assert.rejects(down.decide(request), {code:'PROVIDER_ERROR'});
});
test('a Workers AI run URL takes JEV_ENDPOINT_API_KEY, never a hosted key, and requires one', () => {
  const saved={JEV_API_KEY:process.env.JEV_API_KEY,TYPESAFE_API_KEY:process.env.TYPESAFE_API_KEY,JEV_ENDPOINT_API_KEY:process.env.JEV_ENDPOINT_API_KEY,JEV_BASE_URL:process.env.JEV_BASE_URL};
  process.env.JEV_API_KEY='hosted'; process.env.TYPESAFE_API_KEY='hosted'; delete process.env.JEV_ENDPOINT_API_KEY; process.env.JEV_BASE_URL=runUrl;
  try {
    assert.throws(()=>new sdk.JevDecisionEngine(),{code:'CONFIG'});
    process.env.JEV_ENDPOINT_API_KEY='cf';
    assert.doesNotThrow(()=>new sdk.JevDecisionEngine());
  } finally { for(const [key,value] of Object.entries(saved)) value===undefined?delete process.env[key]:process.env[key]=value; }
});
test('only a Cloudflare v4 run path for an @cf model is read as Workers AI', () => {
  assert.equal(workersAiModel(new URL(runUrl)),'clef-flash');
  for (const other of ['https://api.cloudflare.com/client/v4/accounts/acc/ai/models','http://api.cloudflare.com/client/v4/accounts/acc/ai/run/@cf/cloudflare/clef','https://example.com/client/v4/accounts/acc/ai/run/@cf/cloudflare/clef'])
    assert.equal(workersAiModel(new URL(other)),undefined,other);
});
