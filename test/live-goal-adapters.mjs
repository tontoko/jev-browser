// Explicit opt-in; the provider receives only synthetic fixture data.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {fixtureBrowser} from './helpers.mjs';
import {goalFixture} from './goal-fixture.mjs';
let browser;before(async()=>{assert.ok(process.env.JEV_API_KEY||process.env.TYPESAFE_API_KEY);browser=await fixtureBrowser();});after(async()=>{await browser?.close();});
const values={contact:{name:'Wire Contact',email:'wire-contact@example.invalid'}};
const instruction='Open Add, enter the supplied contact name and email, Save the new contact, and verify the result.';
const env=()=>Object.fromEntries([...['PATH','HOME','USERPROFILE','TEMP','TMP','PLAYWRIGHT_BROWSERS_PATH','JEV_BASE_URL','JEV_MODEL'].flatMap(key=>process.env[key]?[[key,process.env[key]]]:[]),['JEV_API_KEY',process.env.JEV_API_KEY??process.env.TYPESAFE_API_KEY]]);
async function fixture(t){return goalFixture(t,browser,[{path:'/contact/name',label:'Contact name'},{path:'/contact/email',label:'Contact email'}],{live:true});}
function verify(app,result){
 assert.equal(result.status,'complete',JSON.stringify(result));assert.equal(result.reason,'ui-readback');
 assert.equal(app.attempts.length,1);assert.deepEqual(app.records,[{'/contact/name':values.contact.name,'/contact/email':values.contact.email}]);
 assert.ok(!JSON.stringify(result).includes(values.contact.email));
}
test('LIVE goal CLI: one command creates and verifies the supplied contact',async t=>{
 const app=await fixture(t);const args={instruction,values};
 const result=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['dist/cli.js','run','--url',app.page.url(),'--args',JSON.stringify(args)],{cwd:new URL('..',import.meta.url),env:env(),stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  const timer=setTimeout(()=>{child.kill();reject(Error('Live goal CLI timed out'));},75000);
  child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});
 });
 assert.equal(result.code,0,result.stdout+result.stderr);const output=JSON.parse(result.stdout).result;verify(app,output);
 console.log(JSON.stringify({interface:'goal-cli',status:output.status,usage:output.usage,steps:output.steps.length}));
});
test('LIVE goal MCP: one tool call creates and verifies the supplied contact',async t=>{
 const app=await fixture(t);const client=new Client({name:'live-goal-tests',version:'1'});
 const transport=new StdioClientTransport({command:process.execPath,args:['dist/mcp-stdio.js'],cwd:fileURLToPath(new URL('..',import.meta.url)),env:env(),stderr:'pipe'});
 t.after(()=>client.close());await client.connect(transport);
 const navigation=await client.callTool({name:'browser_goto',arguments:{url:app.page.url()}});assert.notEqual(navigation.isError,true);
 const result=await client.callTool({name:'browser_run',arguments:{instruction,values}},undefined,{timeout:75000});assert.notEqual(result.isError,true,JSON.stringify(result));
 const output=result.structuredContent??JSON.parse(result.content.find(c=>c.type==='text').text);verify(app,output);
 console.log(JSON.stringify({interface:'goal-mcp',status:output.status,usage:output.usage,steps:output.steps.length}));
});
