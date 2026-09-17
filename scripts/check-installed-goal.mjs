// The consumer imports the installed tarball. The oracle is an independent local HTTP app.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {fixtureBrowser,httpServer,apiResult} from '../test/helpers.mjs';
import {goalFixture,formEngine} from '../test/goal-fixture.mjs';

export async function checkInstalledGoal(pkg,directory,baseEnv){
  const cleanup=[];
  const browser=await fixtureBrowser();
  try{
    const app=await goalFixture({after(fn){cleanup.push(fn);}},browser,[{path:'/student/name',label:'Student name'},{path:'/student/email',label:'Student email',type:'email'}]);
    const semantic=formEngine();
    const provider=await httpServer(async(req,res)=>{
      try{
        let raw='';for await(const chunk of req)raw+=chunk;
        const request=JSON.parse(raw),decision=await semantic.decide(request);
        res.setHeader('Content-Type','application/json');
        res.end(JSON.stringify(apiResult(request,(_question,id)=>decision.answers[id].choice)));
      }catch{res.statusCode=500;res.end('{"error":"fixture provider error"}');}
    });
    cleanup.push(()=>provider.close());
    const env={...baseEnv,JEV_API_KEY:'synthetic-package-fixture',JEV_BASE_URL:provider.url};
    const {JevBrowser}=await import(pathToFileURL(join(pkg,'dist/index.js')).href);
    function argumentsFor(label){return {instruction:'Open Add, fill all student information and Save one new record.',values:{student:{name:`Package ${label}`,email:`package-${label}@example.invalid`}}};}
    function verify(result,label,index){
      assert.equal(result.status,'complete');assert.equal(result.verification.basis,'ui-readback');
      assert.equal(app.attempts.length,index+1);assert.equal(app.records.length,index+1);
      assert.deepEqual(app.records[index],{'/student/name':`Package ${label}`,'/student/email':`package-${label}@example.invalid`});
      assert.ok(result.inputs.every(input=>input.applied&&input.readback));
    }
    const core=new JevBrowser({page:app.page,apiKey:env.JEV_API_KEY,baseURL:provider.url});
    try{const {instruction,...options}=argumentsFor('sdk');verify(await core.run(instruction,options),'sdk',0);}
    finally{await core.close();}
    const cli=await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[join(pkg,'dist/cli.js'),'run','--url',app.page.url(),'--args',JSON.stringify(argumentsFor('cli'))],{cwd:directory,env,stdio:['ignore','pipe','pipe']});
      let stdout='',stderr='';child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
      const timer=setTimeout(()=>{child.kill('SIGTERM');reject(new Error('Installed goal CLI timed out'));},30000);
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('close',code=>{clearTimeout(timer);code===0?resolve(JSON.parse(stdout).result):reject(new Error(`Installed goal CLI failed: ${stdout}\n${stderr}`));});
    });
    verify(cli,'cli',1);
    const client=new Client({name:'installed-goal-proof',version:'1'});
    try{
      await client.connect(new StdioClientTransport({command:process.execPath,args:[join(pkg,'dist/mcp-stdio.js')],cwd:directory,env,stderr:'pipe'}));
      const navigation=await client.callTool({name:'browser_goto',arguments:{url:app.page.url()}});assert.notEqual(navigation.isError,true);
      const response=await client.callTool({name:'browser_run',arguments:argumentsFor('mcp')});assert.notEqual(response.isError,true,JSON.stringify(response));
      verify(response.structuredContent??JSON.parse(response.content.find(item=>item.type==='text').text),'mcp',2);
    }finally{await client.close();}
    return {installedSDKGoal:true,installedCLIGoal:true,installedMCPGoal:true};
  }finally{for(const close of cleanup.reverse())await close();await browser.close();}
}
