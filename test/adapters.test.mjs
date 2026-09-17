import { fileURLToPath } from 'node:url';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { httpServer, apiResult, select } from './helpers.mjs';
import { JevBrowser } from '../dist/index.js';
let service; const requests=[];
before(async()=>{service=await httpServer(async(req,res)=>{
  if(req.url==='/v1/systemone'){
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw);requests.push(body);
    const result=apiResult(body,q=>Object.entries(q.criteria).find(([,c])=>c&&typeof c==='object'&&
      (c.kind==='click'&&c.target?.name==='保存'||c.text==='保存済み'))?.[0]??'__none__');
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
  }
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end('<h1>未保存</h1><button onclick="document.querySelector(\'h1\').textContent=\'保存済み\'">保存</button>');
});});
after(async()=>{await service?.close();});
function cli(args,input='') {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['dist/cli.js',...args],{cwd:new URL('..',import.meta.url),env:{...process.env,JEV_API_KEY:'test-only',JEV_BASE_URL:service.url},stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('CLI did not terminate'));},12000);
    child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});child.stdin.end(input);
  });
}
test('CLI help works without launching a browser',async()=>{
  const result=await cli(['--help']);assert.equal(result.code,0);assert.match(result.stdout,/session/);assert.match(result.stdout,/mcp/);
});
test('CLI one-shot snapshot returns clean machine-readable JSON',async()=>{
  const result=await cli(['snapshot','--url',service.url]);assert.equal(result.code,0,result.stderr);
  const output=JSON.parse(result.stdout);assert.equal(output.ok,true);assert.ok(output.result.elements.some(e=>e.name==='保存'));
});
test('CLI JSONL session preserves page state across goto, act and extract',async()=>{
  const commands=[{id:1,command:'goto',url:service.url},{id:2,command:'act',instruction:'保存をクリック'},
    {id:3,command:'extract',instruction:'見出しの状態',scope:'h1',fields:{status:'string'}}];
  const result=await cli(['session'],commands.map(c=>JSON.stringify(c)).join('\n')+'\n');
  assert.equal(result.code,0,result.stderr);const lines=result.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(lines.length,3);assert.equal(lines[1].result.status,'executed');assert.equal(lines[2].result.data.status,'保存済み');
});
test('CLI rejects malformed arguments without a successful exit status',async()=>{
  const result=await cli(['act','保存','--values','not-json','--url',service.url]);
  assert.notEqual(result.code,0);const output=JSON.parse(result.stdout);assert.equal(output.ok,false);assert.ok(!result.stdout.includes('test-only'));
});
test('MCP tools call the same borrowed core and enforce input schemas',async t=>{
  const {createMcpServer}=await import('../dist/mcp.js');
  const core=await JevBrowser.launch({engine:select(c=>c.kind==='click')});await core.goto(service.url);
  const server=createMcpServer(core);const [ct,st]=InMemoryTransport.createLinkedPair();
  const client=new Client({name:'jev-browser-tests',version:'1'});
  t.after(async()=>{await client.close();await server.close();await core.close();});
  await server.connect(st);await client.connect(ct);
  const listed=await client.listTools();assert.ok(listed.tools.some(t=>t.name==='browser_act'));assert.ok(listed.tools.some(t=>t.name==='browser_extract'));
  const result=await client.callTool({name:'browser_act',arguments:{instruction:'保存をクリック'}});
  assert.notEqual(result.isError,true);assert.equal(await core.page.locator('h1').textContent(),'保存済み');
  const invalid=await client.callTool({name:'browser_act',arguments:{}});assert.equal(invalid.isError,true);
});
test('MCP stdio binary initializes, navigates and observes using the real protocol',async t=>{
  const transport=new StdioClientTransport({command:process.execPath,args:['dist/mcp-stdio.js'],cwd:fileURLToPath(new URL('..',import.meta.url)),
    env:{...process.env,JEV_API_KEY:'test-only',JEV_BASE_URL:service.url},stderr:'pipe'});
  const client=new Client({name:'jev-stdio-test',version:'1'});
  t.after(async()=>{await client.close();});
  await client.connect(transport);
  const tools=await client.listTools();assert.ok(tools.tools.some(t=>t.name==='browser_snapshot'));
  const goto=await client.callTool({name:'browser_goto',arguments:{url:service.url}});assert.notEqual(goto.isError,true);
  const observe=await client.callTool({name:'browser_observe',arguments:{instruction:'保存をクリック'}});assert.notEqual(observe.isError,true);
  const plan=JSON.parse(observe.content.find(c=>c.type==='text').text).plan;assert.ok(plan.id);
  const act=await client.callTool({name:'browser_act',arguments:{planId:plan.id}});assert.notEqual(act.isError,true);
  const snapshot=await client.callTool({name:'browser_snapshot',arguments:{scope:'h1'}});
  assert.ok(JSON.parse(snapshot.content.find(c=>c.type==='text').text).texts.some(t=>t.text==='保存済み'));
});

test('MCP cancellation is forwarded to the pending Jev decision',async t=>{
  const {createMcpServer}=await import('../dist/mcp.js');
  let start;const started=new Promise(r=>{start=r;});let finish;const cancelled=new Promise(r=>{finish=r;});
  const core=await JevBrowser.launch({engine:{async decide(req,{signal}){
    start();await new Promise(resolve=>signal.addEventListener('abort',()=>{finish();resolve();},{once:true}));signal.throwIfAborted();
  }}});await core.goto(service.url);
  const server=createMcpServer(core);const [ct,st]=InMemoryTransport.createLinkedPair();
  const client=new Client({name:'cancellation-test',version:'1'});
  t.after(async()=>{await client.close();await server.close();await core.close();});
  await server.connect(st);await client.connect(ct);
  const abort=new AbortController();
  const request=client.callTool({name:'browser_act',arguments:{instruction:'保存'}},{signal:abort.signal});
  await started;abort.abort();await assert.rejects(request);await cancelled;
  assert.equal(await core.page.locator('h1').textContent(),'未保存');
});
