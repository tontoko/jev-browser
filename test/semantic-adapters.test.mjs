import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {httpServer,apiResult} from './helpers.mjs';
import {parseCommand,commandReadOnly} from '../dist/commands.js';

async function setup(t,{comparison='equivalent',confidence=0.95}={}){
  const site=await httpServer((_req,res)=>{
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end('<main><h1>Account</h1><dl><dt>Plan</dt><dd>Pro annual</dd></dl><button>Manage plan</button></main>');
  });
  const provider=await httpServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const request=JSON.parse(raw);
    const body=apiResult(request,(question,id)=>{
      if(id==='target')return Object.entries(question.criteria).find(([,candidate])=>candidate?.name==='Manage plan')?.[0]??'__none__';
      if(id.startsWith('source_'))return Object.entries(question.criteria).find(([,candidate])=>candidate?.text==='Pro annual')?.[0]??'__none__';
      if(id.startsWith('compare_'))return comparison;
      return Object.keys(question.criteria)[0];
    });
    for(const answer of Object.values(body.answers))answer.confidence=confidence;
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));
  });
  t.after(async()=>{await provider.close();await site.close();});
  return {url:site.url,env:{...process.env,JEV_API_KEY:'test-only',JEV_BASE_URL:provider.url}};
}

async function cli(env,args){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['dist/cli.js',...args],{cwd:fileURLToPath(new URL('..',import.meta.url)),env,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';const timer=setTimeout(()=>{child.kill('SIGTERM');reject(Error('semantic CLI timeout'));},20000);
    child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
    child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});
  });
}

test('semantic adapters: command schemas are read-only and validate threshold',()=>{
  for(const name of ['semantic_locate','semantic_compare','semantic_assert'])assert.equal(commandReadOnly(name),true);
  assert.equal(parseCommand({command:'semantic_locate',description:'Manage plan',minConfidence:0.8}).command,'semantic_locate');
  assert.equal(parseCommand({command:'semantic_compare',actual:{description:'Current plan'},expected:'Professional annual plan',minConfidence:0.8,minSourceConfidence:0.4}).command,'semantic_compare');
  assert.throws(()=>parseCommand({command:'semantic_assert',actual:{description:'Plan'},expected:'Pro',minConfidence:2}),{code:'INVALID_ARGUMENT'});
  assert.throws(()=>parseCommand({command:'semantic_assert',actual:{description:'Plan'},expected:'Pro',minSourceConfidence:2}),{code:'INVALID_ARGUMENT'});
});

test('semantic CLI: compare returns grounded semantic result',async t=>{
  const app=await setup(t);
  const args={actual:{description:'Current plan'},expected:'Professional annual plan',minConfidence:0.8};
  const result=await cli(app.env,['semantic_compare','--url',app.url,'--args',JSON.stringify(args)]);
  assert.equal(result.code,0,result.stdout+result.stderr);
  const output=JSON.parse(result.stdout).result;
  assert.equal(output.status,'passed');
  assert.equal(output.source,'semantic');
  assert.equal(output.evidence.text,'Pro annual');
});

test('semantic MCP: locate and assert use shared core with read-only annotations',async t=>{
  const app=await setup(t);const client=new Client({name:'semantic-adapter-tests',version:'1'});
  const transport=new StdioClientTransport({command:process.execPath,args:['dist/mcp-stdio.js'],cwd:fileURLToPath(new URL('..',import.meta.url)),env:app.env,stderr:'pipe'});
  t.after(()=>client.close());await client.connect(transport);
  const tools=await client.listTools();
  for(const name of ['browser_semantic_locate','browser_semantic_compare','browser_semantic_assert']){
    const tool=tools.tools.find(candidate=>candidate.name===name);assert.ok(tool,name);assert.equal(tool.annotations?.readOnlyHint,true);
  }
  assert.notEqual((await client.callTool({name:'browser_goto',arguments:{url:app.url}})).isError,true);
  const located=await client.callTool({name:'browser_semantic_locate',arguments:{description:'Manage plan',minConfidence:0.8}});
  assert.notEqual(located.isError,true,JSON.stringify(located));
  const assertion=await client.callTool({name:'browser_semantic_assert',arguments:{actual:{description:'Current plan'},expected:'Professional annual plan',minConfidence:0.8}});
  assert.notEqual(assertion.isError,true,JSON.stringify(assertion));
});

test('semantic MCP: failed semantic assertion is an error, not success',async t=>{
  const app=await setup(t,{comparison:'different',confidence:0.96});const client=new Client({name:'semantic-adapter-tests',version:'1'});
  const transport=new StdioClientTransport({command:process.execPath,args:['dist/mcp-stdio.js'],cwd:fileURLToPath(new URL('..',import.meta.url)),env:app.env,stderr:'pipe'});
  t.after(()=>client.close());await client.connect(transport);
  await client.callTool({name:'browser_goto',arguments:{url:app.url}});
  const result=await client.callTool({name:'browser_semantic_assert',arguments:{actual:{description:'Current plan'},expected:'Free plan',minConfidence:0.8}});
  assert.equal(result.isError,true);
  const error=JSON.parse(result.content.find(item=>item.type==='text').text).error;
  assert.equal(error.code,'SEMANTIC_ASSERTION_FAILED');
});
