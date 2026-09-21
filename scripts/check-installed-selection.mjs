import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {httpServer,fixtureBrowser,apiResult} from '../test/helpers.mjs';
import {selectionFixture} from '../test/selection-fixture.mjs';

export async function checkInstalledSelection(pkg,directory,baseEnv){
  const cleanup=[],browser=await fixtureBrowser();
  try{
    const app=await selectionFixture({after(fn){cleanup.push(fn);}},browser);
    const endpoint=await httpServer(async(req,res)=>{
      let body='';for await(const chunk of req)body+=chunk;
      const request=JSON.parse(body),decision=await app.decider.decide(request);
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(apiResult(request,(_q,id)=>decision.answers[id].choice)));
    });
    cleanup.push(()=>endpoint.close());
    const env={...baseEnv,JEV_API_KEY:'synthetic-selection-fixture',JEV_BASE_URL:endpoint.url};
    const request={instruction:'Set country and private note, Save once and verify the address.',values:{country:'Japan',note:'installed-private-note'},semanticInputs:{'/country':0.8}};
    function run(args){return new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,args,{cwd:directory,env,stdio:['ignore','pipe','pipe']});
      let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
      const timer=setTimeout(()=>{child.kill('SIGTERM');reject(new Error('Installed selection check timed out'));},30000);
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('close',code=>{clearTimeout(timer);try{assert.equal(code,0,stdout+stderr);resolve(JSON.parse(stdout));}catch(e){reject(e);}});
    });}
    const sdk=await run(['--input-type=module','-e',`
      import {JevBrowser} from '@tontoko/jev-browser';
      const {url,instruction,...options}=JSON.parse(process.argv[1]);
      const core=await JevBrowser.launch();
      try{await core.goto(url);console.log(JSON.stringify(await core.run(instruction,options)));}finally{await core.close();}
    `,JSON.stringify({url:app.page.url(),...request})]);
    assert.equal(sdk.status,'complete');assert.deepEqual(sdk.verification.semanticInputs,['/country']);
    const cli=await run([join(pkg,'dist/cli.js'),'run','--url',app.page.url(),'--args',JSON.stringify(request)]);
    assert.equal(cli.result.status,'complete');assert.deepEqual(cli.result.verification.semanticInputs,['/country']);
    const client=new Client({name:'installed-selection-proof',version:'1'});
    try{
      await client.connect(new StdioClientTransport({command:process.execPath,args:[join(pkg,'dist/mcp-stdio.js')],cwd:directory,env,stderr:'pipe'}));
      assert.notEqual((await client.callTool({name:'browser_goto',arguments:{url:app.page.url()}})).isError,true);
      const response=await client.callTool({name:'browser_run',arguments:request});
      assert.notEqual(response.isError,true,JSON.stringify(response));
      const result=response.structuredContent??JSON.parse(response.content.find(c=>c.type==='text').text);
      assert.equal(result.status,'complete');assert.deepEqual(result.verification.semanticInputs,['/country']);
    }finally{await client.close();}
    assert.equal(app.submissions.length,3);
    for(const saved of app.submissions)assert.deepEqual(saved,{a9:'JP',b4:'installed-private-note'});
    assert.ok(!app.decider.requests.some(r=>JSON.stringify(r).includes('installed-private-note')));
    return {installedSDKSelection:true,installedCLISelection:true,installedMCPSelection:true};
  }finally{for(const close of cleanup.reverse())await close();await browser.close();}
}
