import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Client,InMemoryTransport} from '@modelcontextprotocol/client';
import {JevBrowser} from '../dist/index.js';
import {createMcpServer} from '../dist/mcp.js';
import {fixtureBrowser,httpServer,apiResult,engine} from './helpers.mjs';

let browser;
before(async()=>{browser=await fixtureBrowser();});
after(async()=>{await browser?.close();});

function decisionEngine(){
  let completions=0;
  return engine((question,request,name)=>{
    if(name.startsWith('bind_')){
      const input=request.state.inputs.find(input=>question.instructions.includes(JSON.stringify(input.path)));
      return request.state.page.elements.find(element=>element.fieldName===input?.path)?.id??'__none__';
    }
    if(name.startsWith('effect_'))return request.state.actions?.[name.slice('effect_'.length)]?.target?.name?.startsWith('Save ')?'commit':'advance';
    if(name==='completion')return ++completions===1?'incomplete':'complete';
    if(name.startsWith('read_')){
      const input=request.state.inputs.find(input=>question.instructions.includes(JSON.stringify(input.path)));
      return request.state.sources.find(source=>source.text===`[input:${input?.path}]`)?.id??'__none__';
    }
    if(name.startsWith('reuse_'))return '__none__';
    if(name==='action')return candidate=>candidate?.kind==='click'&&candidate.target?.name?.startsWith('Save ');
    return '__none__';
  });
}

async function setup(t){
  const submissions=[];
  const site=await httpServer(async(req,res)=>{
    if(req.url==='/account'||req.url==='/membership'){
      let raw='';for await(const chunk of req)raw+=chunk;const data=JSON.parse(raw);submissions.push({kind:req.url.slice(1),data});
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return;
    }
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<main><div id="editor"><form><label>Reference<input name="/reference" required></label><button type="button">Save account</button></form></div><section id="results"></section></main><script>
      const editor=document.querySelector('#editor'),results=document.querySelector('#results');let reference='';
      function add(title,data){const a=document.createElement('article');a.innerHTML='<h2>'+title+'</h2>';for(const [key,value] of Object.entries(data)){const dl=document.createElement('dl'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;dl.append(dt,dd);a.append(dl);}results.append(a);}
      function membership(){editor.innerHTML='<form><label>Membership code<input name="/membershipCode" required></label><button type="button">Save membership</button></form>';editor.querySelector('button').onclick=async()=>{const membershipCode=editor.querySelector('input').value;const data={reference,membershipCode};await fetch('/membership',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});add('Membership created',data);editor.innerHTML='';};}
      editor.querySelector('button').onclick=async()=>{reference=editor.querySelector('input').value;const data={reference};await fetch('/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});add('Account created',data);membership();};
    </script>`);
  });
  const decider=decisionEngine();
  const provider=await httpServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;const request=JSON.parse(raw),result=await decider.decide(request);
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(apiResult(request,(_q,id)=>result.answers[id].choice)));
  });
  t.after(async()=>{await site.close();await provider.close();});
  return {site,provider,submissions,decider};
}

function cli(env,args){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['dist/cli.js',...args],{cwd:new URL('..',import.meta.url),env,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('resume CLI exceeded its test budget'));},20000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});
  });
}

test('resume adapters: MCP exposes and executes resume on the same core',async t=>{
  const app=await setup(t);
  const page=await browser.newPage();await page.goto(app.site.url);
  const core=new JevBrowser({page,engine:app.decider});
  const server=createMcpServer(core);const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
  const client=new Client({name:'resume-adapter',version:'1'});
  t.after(async()=>{await client.close();await server.close();await core.close();await page.close();});
  await server.connect(serverTransport);await client.connect(clientTransport);
  const tools=await client.listTools();assert.ok(tools.tools.some(tool=>tool.name==='browser_resume'));
  const first=await client.callTool({name:'browser_run',arguments:{instruction:'Save the account, then save its membership.',values:{reference:'mcp-reference'},settleTimeoutMs:100}});
  assert.notEqual(first.isError,true,JSON.stringify(first));
  const firstResult=first.structuredContent??JSON.parse(first.content.find(item=>item.type==='text').text);
  assert.equal(firstResult.reason,'missing-input');assert.ok(firstResult.continuation?.id);
  const second=await client.callTool({name:'browser_resume',arguments:{continuationId:firstResult.continuation.id,values:{membershipCode:'MCP-42'}}});
  assert.notEqual(second.isError,true,JSON.stringify(second));
  const secondResult=second.structuredContent??JSON.parse(second.content.find(item=>item.type==='text').text);
  assert.equal(secondResult.status,'complete');assert.deepEqual(app.submissions.map(entry=>entry.kind),['account','membership']);
});

test('resume adapters: persistent CLI session resumes, fresh one-shot core cannot',async t=>{
  const app=await setup(t),session=`resume-${process.pid}-${Date.now()}`;
  const env={...process.env,JEV_API_KEY:'fixture',JEV_BASE_URL:app.provider.url,JEV_SESSION_DIR:join(tmpdir(),`jev-resume-session-${process.pid}-${Date.now()}`)};
  try{
    const opened=await cli(env,['open',app.site.url,'--session',session]);assert.equal(opened.code,0,opened.stdout+opened.stderr);
    const first=await cli(env,['run','--session',session,'--args',JSON.stringify({instruction:'Save the account, then save its membership.',values:{reference:'cli-reference'},settleTimeoutMs:100})]);
    assert.equal(first.code,2,first.stdout+first.stderr);const firstResult=JSON.parse(first.stdout).result;assert.ok(firstResult.continuation?.id);
    const second=await cli(env,['resume',firstResult.continuation.id,'--session',session,'--values',JSON.stringify({membershipCode:'CLI-42'})]);
    assert.equal(second.code,0,second.stdout+second.stderr);assert.equal(JSON.parse(second.stdout).result.status,'complete');
    assert.deepEqual(app.submissions.map(entry=>entry.kind),['account','membership']);
    const fresh=await cli(env,['resume',firstResult.continuation.id,'--url',app.site.url]);
    assert.equal(fresh.code,1);assert.equal(JSON.parse(fresh.stdout).error.code,'CONTINUATION_NOT_FOUND');
  }finally{await cli(env,['close','--session',session]).catch(()=>undefined);}
});
