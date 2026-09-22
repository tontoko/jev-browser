import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client,InMemoryTransport} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {JevBrowser} from '../dist/index.js';
import {createMcpServer} from '../dist/mcp.js';
import {httpServer} from './helpers.mjs';
const cli=fileURLToPath(new URL('../dist/cli.js',import.meta.url));
async function setup(t){
 const directory=await mkdtemp(join(tmpdir(),'jev-screen-adapter-'));
 const server=await httpServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<title>PRIVATE_TITLE</title><button aria-label="PRIVATE_ARIA" style="position:absolute;left:20px;top:20px;width:160px;height:50px" onclick="this.textContent=\'Saved\'">Save</button><i hidden>PRIVATE_DOM</i>');});
 t.after(async()=>{await server.close();await rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:125});});
 const env={...process.env,JEV_API_KEY:'',TYPESAFE_API_KEY:'',JEV_SESSION_DIR:join(directory,'sessions')};
 const run=args=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[cli,...args],{cwd:directory,env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.once('error',reject);
  child.once('close',code=>{try{resolve({code,value:JSON.parse(stdout),stderr});}catch{reject(new Error('CLI did not return JSON: '+stdout+' '+stderr));}});
 });
 return {directory,server,env,run};
}
test('MCP screen mode publishes only screen and close, returning image content without DOM metadata',async t=>{
 const core=await JevBrowser.launch({screenOnly:true,contextOptions:{viewport:{width:420,height:320}}});
 await core.page.setContent('<title>PRIVATE_TITLE</title><button aria-label="PRIVATE_ARIA" style="position:absolute;left:20px;top:20px;width:160px;height:50px" onclick="this.textContent=\'Saved\'">Save</button><i hidden>PRIVATE_DOM</i>');
 const server=createMcpServer(core),client=new Client({name:'screen-contract',version:'1'});
 const [ct,st]=InMemoryTransport.createLinkedPair();
 t.after(async()=>{await client.close();await server.close();await core.close();});
 await server.connect(st);await client.connect(ct);
 assert.deepEqual((await client.listTools()).tools.map(t=>t.name).sort(),['browser_close','browser_screen']);
 let r=await client.callTool({name:'browser_screen',arguments:{action:'look'}});
 assert.notEqual(r.isError,true);assert.equal(r.content.filter(c=>c.type==='image').length,1);
 assert.equal(JSON.stringify(r).includes('PRIVATE_'),false);
 assert.equal('data' in r.structuredContent.frames[0],false);assert.equal('path' in r.structuredContent.frames[0],false);
 r=await client.callTool({name:'browser_screen',arguments:{action:'click',x:70,y:45,observationId:r.structuredContent.observationId}});
 assert.notEqual(r.isError,true);assert.equal(await core.page.locator('button').textContent(),'Saved');
 const forbidden=await client.callTool({name:'browser_snapshot',arguments:{}}).catch(()=>({isError:true}));
 assert.equal(forbidden.isError,true);assert.equal(JSON.stringify(forbidden).includes('PRIVATE_'),false);
});
test('named CLI screen sessions preserve mode and reject DOM commands or mode replacement',async t=>{
 const {server,run}=await setup(t);
 try{
  const opened=await run(['open',server.url+'/PRIVATE_ROUTE','--session','visual','--screen-only']);
  assert.equal(opened.code,0);assert.equal(opened.value.result.screenOnly,true);assert.equal(JSON.stringify(opened).includes('PRIVATE_ROUTE'),false);
  const look=await run(['screen','--session','visual','--args','{"action":"look"}']);assert.equal(look.code,0);
  assert.equal(JSON.stringify(look.value).includes('PRIVATE_'),false);assert.ok(look.value.result.frames[0].data);
  const blocked=await run(['snapshot','--session','visual']);assert.equal(blocked.code,1);assert.equal(blocked.value.error.code,'SCREEN_ONLY');
  const replaced=await run(['open','--session','visual']);assert.equal(replaced.code,1);assert.equal(replaced.value.error.code,'SESSION_MODE_MISMATCH');
  const ordinary=await run(['open',server.url+'/first','--session','ordinary']);assert.equal(ordinary.code,0);
  const mismatch=await run(['open',server.url+'/second','--session','ordinary','--screen-only']);assert.equal(mismatch.code,1);assert.equal(mismatch.value.error.code,'SESSION_MODE_MISMATCH');
  const state=await run(['snapshot','--session','ordinary']);assert.equal(state.value.result.url,server.url+'/first');
 }finally{await run(['close','--session','visual']);await run(['close','--session','ordinary']);}
});
test('installed-style MCP entrypoint performs trusted initial navigation before exposing only pixel tools',async t=>{
 const {server,directory,env}=await setup(t);
 const transport=new StdioClientTransport({command:process.execPath,args:[cli,'mcp','--screen-only','--url',server.url+'/PRIVATE_ROUTE'],cwd:directory,env,stderr:'pipe'});
 const client=new Client({name:'screen-stdio-contract',version:'1'});
 try{
  await client.connect(transport);
  assert.deepEqual((await client.listTools()).tools.map(t=>t.name).sort(),['browser_close','browser_screen']);
  const r=await client.callTool({name:'browser_screen',arguments:{action:'look'}});assert.notEqual(r.isError,true);
  assert.equal(r.content.filter(c=>c.type==='image').length,1);assert.equal(JSON.stringify(r).includes('PRIVATE_'),false);
 }finally{
  // The subprocess owns cwd; await its exit before setup's after-hook removes it on Windows.
  const closed=transport._process?once(transport._process,'close'):undefined;
  await client.close();await closed;
 }
});
