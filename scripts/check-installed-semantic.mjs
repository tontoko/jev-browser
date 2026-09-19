import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {httpServer,apiResult} from '../test/helpers.mjs';

export async function checkInstalledSemantic(pkg,directory,baseEnv){
  const site=await httpServer((_req,res)=>{
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end('<main><h1>Account</h1><dl><dt>Plan</dt><dd>Pro annual</dd></dl><button>Manage plan</button></main>');
  });
  const provider=await httpServer(async(req,res)=>{
    try{
      let raw='';for await(const chunk of req)raw+=chunk;
      const request=JSON.parse(raw);
      const result=apiResult(request,(question,id)=>{
        if(id==='target')return Object.entries(question.criteria).find(([,candidate])=>candidate?.name==='Manage plan')?.[0]??'__none__';
        if(id.startsWith('source_'))return Object.entries(question.criteria).find(([,candidate])=>candidate?.text==='Pro annual')?.[0]??'__none__';
        if(id.startsWith('compare_'))return 'equivalent';
        return '__none__';
      });
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
    }catch{res.statusCode=500;res.end('{"error":"semantic fixture provider error"}');}
  });
  const env={...baseEnv,JEV_API_KEY:'synthetic-semantic-package-fixture',JEV_BASE_URL:provider.url};
  function run(args){return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,args,{cwd:directory,env,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
    const timer=setTimeout(()=>{child.kill('SIGTERM');reject(new Error('Installed semantic process timed out'));},30000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('close',code=>{clearTimeout(timer);try{if(code!==0)throw new Error(`Installed semantic process failed: ${stdout}\n${stderr}`);resolve(JSON.parse(stdout));}catch(error){reject(error);}});
  });}
  const args={actual:{description:'Current plan'},expected:'Professional annual plan',minConfidence:0.8};
  try{
    const sdk=await run(['--input-type=module','-e',`
      import {JevBrowser} from '@tontoko/jev-browser';
      const request=JSON.parse(process.argv[1]);
      const core=await JevBrowser.launch();
      try{await core.goto(request.url);console.log(JSON.stringify(await core.compareSemantic(request.args)));}
      finally{await core.close();}
    `,JSON.stringify({url:site.url,args})]);
    assert.equal(sdk.status,'passed');assert.equal(sdk.evidence.text,'Pro annual');

    const cli=(await run([join(pkg,'dist/cli.js'),'semantic_compare','--url',site.url,'--args',JSON.stringify(args)])).result;
    assert.equal(cli.status,'passed');assert.equal(cli.evidence.text,'Pro annual');

    const client=new Client({name:'installed-semantic-proof',version:'1'});
    try{
      await client.connect(new StdioClientTransport({command:process.execPath,args:[join(pkg,'dist/mcp-stdio.js')],cwd:directory,env,stderr:'pipe'}));
      const tools=await client.listTools();assert.ok(tools.tools.some(tool=>tool.name==='browser_semantic_assert'));
      const navigation=await client.callTool({name:'browser_goto',arguments:{url:site.url}});assert.notEqual(navigation.isError,true);
      const result=await client.callTool({name:'browser_semantic_assert',arguments:args});assert.notEqual(result.isError,true,JSON.stringify(result));
    }finally{await client.close();}
    return {installedSDKSemantic:true,installedCLISemantic:true,installedMCPSemantic:true};
  }finally{await provider.close();await site.close();}
}
