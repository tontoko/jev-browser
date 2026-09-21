import {semanticCandidates} from './helpers.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {httpServer,apiResult} from './helpers.mjs';
import {parseCommand,commandReadOnly} from '../dist/commands.js';
const requests=[{actual:{description:'Plan value'},expected:'Professional annual plan'},{actual:{description:'Payment value'},expected:'Payment complete'}];
async function app(t,{fail=false}={}){
 const site=await httpServer((_q,r)=>{r.setHeader('content-type','text/html');r.end('<dl><dt>Plan</dt><dd>Pro annual</dd><dt>Payment</dt><dd>Settled</dd></dl>');});const calls=[];
 const provider=await httpServer(async(q,r)=>{let raw='';for await(const c of q)raw+=c;const request=JSON.parse(raw);calls.push(request);const result=apiResult(request,(question,id)=>{if(id.startsWith('source_'))return semanticCandidates(question,request).find(([,v])=>v?.text===(id==='source_0'?'Pro annual':'Settled'))?.[0]??'__none__';return fail&&id==='compare_1'?'different':'equivalent';});r.setHeader('content-type','application/json');r.end(JSON.stringify(result));});
 t.after(async()=>{await provider.close();await site.close();});return {url:site.url,calls,env:{...process.env,JEV_API_KEY:'fixture',JEV_BASE_URL:provider.url}};
}
function cli(env,args){return new Promise((resolve,reject)=>{const c=spawn(process.execPath,['dist/cli.js',...args],{cwd:fileURLToPath(new URL('..',import.meta.url)),env,stdio:['ignore','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>{c.kill('SIGTERM');reject(new Error('batch CLI timeout'));},25000);c.stdout.on('data',x=>out+=x);c.stderr.on('data',x=>err+=x);c.once('error',e=>{clearTimeout(timer);reject(e);});c.once('close',code=>{clearTimeout(timer);resolve({code,out,err});});});}

test('semantic batch commands: shared schemas are read-only and reject empty assertions',()=>{for(const name of ['semantic_compare_batch','semantic_assert_batch']){assert.equal(commandReadOnly(name),true);assert.equal(parseCommand({command:name,requests}).command,name);assert.throws(()=>parseCommand({command:name,requests:[]}),{code:'INVALID_ARGUMENT'});}});

test('semantic batch CLI: independent comparisons use the shared two-frontier core',async t=>{const a=await app(t);const r=await cli(a.env,['semantic_compare_batch','--url',a.url,'--args',JSON.stringify({requests})]);assert.equal(r.code,0,r.out+r.err);const output=JSON.parse(r.out).result;assert.equal(output.results.length,2);assert.ok(output.results.every(x=>x.status==='passed'));assert.equal(output.usage.serialDecisionDepth,2);assert.equal(a.calls.length,2);});

test('semantic batch MCP: failed assertion retains every result and original expected values',async t=>{const a=await app(t,{fail:true});const client=new Client({name:'semantic-batch',version:'1'});t.after(()=>client.close());await client.connect(new StdioClientTransport({command:process.execPath,args:['dist/mcp-stdio.js'],cwd:fileURLToPath(new URL('..',import.meta.url)),env:a.env,stderr:'pipe'}));const tools=await client.listTools();assert.equal(tools.tools.find(x=>x.name==='browser_semantic_assert_batch')?.annotations?.readOnlyHint,true);await client.callTool({name:'browser_goto',arguments:{url:a.url}});const r=await client.callTool({name:'browser_semantic_assert_batch',arguments:{requests}});assert.equal(r.isError,true);const e=JSON.parse(r.content.find(x=>x.type==='text').text).error;assert.equal(e.code,'SEMANTIC_ASSERTION_FAILED');assert.deepEqual(e.semantic.results.map(x=>x.status),['passed','failed']);assert.deepEqual(e.semantic.expected,requests.map(x=>x.expected));assert.ok(e.semantic.results.every(x=>x.freshness==='verified'));});

test('semantic batch named session: structured failure survives the process boundary',async t=>{const a=await app(t,{fail:true});const dir=await mkdtemp(join(tmpdir(),'jev-semantic-batch-'));const env={...a.env,JEV_SESSION_DIR:dir},session='batch';t.after(async()=>{await cli(env,['close','--session',session]);await rm(dir,{recursive:true,force:true,maxRetries:5});});const opened=await cli(env,['open',a.url,'--session',session]);assert.equal(opened.code,0,opened.out+opened.err);const r=await cli(env,['semantic_assert_batch','--session',session,'--args',JSON.stringify({requests})]);assert.equal(r.code,1);const e=JSON.parse(r.out).error;assert.equal(e.code,'SEMANTIC_ASSERTION_FAILED');assert.equal(e.semantic.results[1].evidence.text,'Settled');assert.equal(e.semantic.results[0].usage.requests,2);});
