import { fileURLToPath } from 'node:url';
// Explicit live API tests for both wire adapters; synthetic local pages only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { httpServer } from './helpers.mjs';

let site;
before(async()=>{
  assert.ok(process.env.JEV_API_KEY||process.env.TYPESAFE_API_KEY,'Set the Jev API key for explicit live tests.');
  site=await httpServer((req,res)=>{
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end('<h1>未保存</h1><button onclick="document.querySelector(\'h1\').textContent=\'保存済み\'">保存</button>');
  });
});
after(async()=>{await site?.close();});
function childEnvironment(){
  const env={JEV_API_KEY:process.env.JEV_API_KEY??process.env.TYPESAFE_API_KEY};
  if(process.env.JEV_MODEL)env.JEV_MODEL=process.env.JEV_MODEL;
  if(process.env.JEV_BASE_URL)env.JEV_BASE_URL=process.env.JEV_BASE_URL;
  return env;
}
test('LIVE CLI: real Jev selects an action and JSONL retains its page result',async()=>{
  const requests=[{command:'goto',url:site.url},{command:'act',instruction:'保存ボタンをクリックしてください。'},{command:'snapshot',scope:'h1'}];
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['dist/cli.js','session'],{cwd:new URL('..',import.meta.url),env:{PATH:process.env.PATH,HOME:process.env.HOME,...childEnvironment()},stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);
    child.once('error',reject);child.once('close',code=>resolve({code,stdout,stderr}));
    child.stdin.end(requests.map(request=>JSON.stringify(request)).join('\n')+'\n');
  });
  assert.equal(result.code,0,result.stderr);
  const lines=result.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(lines[1].result.status,'executed');
  assert.ok(lines[2].result.texts.some(t=>t.text==='保存済み'));
  console.log(JSON.stringify({interface:'cli',model:lines[1].result.plan.decision.model}));
});
test('LIVE MCP: official stdio exchange executes through the real Jev API',async t=>{
  const transport=new StdioClientTransport({command:process.execPath,args:['dist/mcp-stdio.js'],cwd:fileURLToPath(new URL('..',import.meta.url)),env:childEnvironment(),stderr:'pipe'});
  const client=new Client({name:'jev-live-mcp',version:'1'});
  t.after(async()=>{await client.close();});
  await client.connect(transport);
  const navigation=await client.callTool({name:'browser_goto',arguments:{url:site.url}});assert.notEqual(navigation.isError,true);
  const action=await client.callTool({name:'browser_act',arguments:{instruction:'保存ボタンをクリックしてください。'}});assert.notEqual(action.isError,true);
  const snapshot=await client.callTool({name:'browser_snapshot',arguments:{scope:'h1'}});assert.notEqual(snapshot.isError,true);
  const data=JSON.parse(snapshot.content.find(c=>c.type==='text').text);
  assert.ok(data.texts.some(t=>t.text==='保存済み'));
  console.log(JSON.stringify({interface:'mcp',model:JSON.parse(action.content.find(c=>c.type==='text').text).plan.decision.model}));
});
