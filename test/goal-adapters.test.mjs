import {fileURLToPath} from 'node:url';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {fixtureBrowser,httpServer,apiResult} from './helpers.mjs';
import {goalFixture,formEngine} from './goal-fixture.mjs';
let browser;before(async()=>{browser=await fixtureBrowser();});after(async()=>{await browser?.close();});
const values={student:{name:'Adapter Student',email:'adapter@example.invalid'}};
async function setup(t,{fail=false}={}){
 const app=await goalFixture(t,browser,[{path:'/student/name',label:'Student name'},{path:'/student/email',label:'Student email'}]);
 const semantic=formEngine();let calls=0;
 const provider=await httpServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const request=JSON.parse(raw);calls++;
  if(fail&&calls===2){res.statusCode=401;res.end('{"message":"test provider refusal"}');return;}
  const result=await semantic.decide(request);
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(apiResult(request,(_q,id)=>result.answers[id].choice)));
 });
 t.after(()=>provider.close());
 return {...app,url:app.page.url(),env:{...process.env,JEV_API_KEY:'test-only',JEV_BASE_URL:provider.url}};
}
async function cli(env,args){
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['dist/cli.js',...args],{cwd:new URL('..',import.meta.url),env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  const timer=setTimeout(()=>{child.kill('SIGTERM');reject(Error('CLI exceeded its test budget'));},20000);
  child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
  child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});
 });
}
for(const explicit of [false,true])test(`goal CLI: one invocation completes nested input and ${explicit?'explicit assertion':'automatic readback'}`,async t=>{
 const app=await setup(t);const args={instruction:'Open Add, fill student details and Save',values,...(explicit?{expect:{target:'#results article',property:'count',expected:1}}:{})};
 const result=await cli(app.env,['run','--url',app.url,'--args',JSON.stringify(args)]);
 assert.equal(result.code,0,result.stdout+result.stderr);const output=JSON.parse(result.stdout);
 assert.equal(output.result.status,'complete');assert.equal(output.result.verification.source,explicit?'caller':'inferred');assert.equal(app.attempts.length,1);
 assert.deepEqual(app.records[0],{'/student/name':values.student.name,'/student/email':values.student.email});
 assert.ok(!result.stdout.includes(values.student.email));
});
for(const fail of [false,true])test(`goal MCP: real stdio ${fail?'preserves partial progress on errors':'completes a nested goal and verifies readback'}`,async t=>{
 const app=await setup(t,{fail});const client=new Client({name:'goal-adapter-tests',version:'1'});
 const transport=new StdioClientTransport({command:process.execPath,args:['dist/mcp-stdio.js'],cwd:fileURLToPath(new URL('..',import.meta.url)),env:app.env,stderr:'pipe'});
 t.after(()=>client.close());await client.connect(transport);
 const navigation=await client.callTool({name:'browser_goto',arguments:{url:app.url}});assert.notEqual(navigation.isError,true);
 const result=await client.callTool({name:'browser_run',arguments:{instruction:'Open Add, fill student details and Save',values}});
 if(fail){assert.equal(result.isError,true);const error=JSON.parse(result.content.find(c=>c.type==='text').text).error;assert.equal(error.code,'PROVIDER_ERROR');assert.equal(error.partial.steps.length,1);assert.equal(app.attempts.length,0);}
 else{assert.notEqual(result.isError,true);const output=result.structuredContent??JSON.parse(result.content.find(c=>c.type==='text').text);assert.equal(output.status,'complete');assert.equal(app.attempts.length,1);assert.equal(app.records[0]['/student/email'],values.student.email);}
});
