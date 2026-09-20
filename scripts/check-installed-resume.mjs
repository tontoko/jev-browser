import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {httpServer,apiResult} from '../test/helpers.mjs';

function processResult(args,{cwd,env,timeout=30000}){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,args,{cwd,env,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
    const timer=setTimeout(()=>{child.kill('SIGTERM');reject(new Error('Installed resume process timed out'));},timeout);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});
  });
}

export async function checkInstalledResume(pkg,directory,baseEnv){
  const submissions=[];
  const site=await httpServer(async(req,res)=>{
    if(req.url==='/account'||req.url==='/membership'){
      let raw='';for await(const chunk of req)raw+=chunk;const data=JSON.parse(raw);
      submissions.push({kind:req.url.slice(1),data});
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return;
    }
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`<main><div id="editor"><form><label>Reference<input name="/reference" required></label><button type="button">Save account</button></form></div><section id="results"></section></main><script>
      const editor=document.querySelector('#editor'),results=document.querySelector('#results');let reference='';
      function add(title,data){const a=document.createElement('article');a.innerHTML='<h2>'+title+'</h2>';for(const [key,value] of Object.entries(data)){const dl=document.createElement('dl'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;dl.append(dt,dd);a.append(dl);}results.append(a);}
      function membership(){editor.innerHTML='<form><label>Membership code<input name="/membershipCode" required></label><button type="button">Save membership</button></form>';editor.querySelector('button').onclick=async()=>{const membershipCode=editor.querySelector('input').value;const data={reference,membershipCode};await fetch('/membership',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});add('Membership created',data);editor.innerHTML='';};}
      editor.querySelector('button').onclick=async()=>{reference=editor.querySelector('input').value;const data={reference};await fetch('/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});add('Account created',data);membership();};
    </script>`);
  });
  const provider=await httpServer(async(req,res)=>{
    try{
      let raw='';for await(const chunk of req)raw+=chunk;const request=JSON.parse(raw);
      const result=apiResult(request,(question,id)=>{
        if(id.startsWith('bind_')){
          const path=['/reference','/membershipCode'].find(value=>question.instructions.includes(JSON.stringify(value)));
          return request.state.page.elements.find(element=>element.fieldName===path)?.id??'__none__';
        }
        if(id.startsWith('effect_'))return request.state.actions?.[id.slice('effect_'.length)]?.target?.name?.startsWith('Save ')?'commit':'advance';
        if(id==='completion')return request.state.record?.context?.includes('Membership created')?'complete':'incomplete';
        if(id.startsWith('read_')){
          const path=['/reference','/membershipCode'].find(value=>question.instructions.includes(JSON.stringify(value)));
          return request.state.sources.find(source=>source.text===`[input:${path}]`)?.id??'__none__';
        }
        if(id.startsWith('reuse_'))return '__none__';
        if(id==='action')return Object.entries(question.criteria).find(([,candidate])=>candidate?.kind==='click'&&candidate.target?.name?.startsWith('Save '))?.[0]??'__none__';
        return '__none__';
      });
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
    }catch{res.statusCode=500;res.end('{"error":"resume fixture provider error"}');}
  });
  const env={...baseEnv,JEV_API_KEY:'synthetic-resume-package-fixture',JEV_BASE_URL:provider.url};
  const runOptions=(label)=>({instruction:'Save the account, then save its membership.',values:{reference:`package-${label}`},settleTimeoutMs:100});
  function verifyPair(offset,label){
    assert.equal(submissions[offset].kind,'account');assert.equal(submissions[offset].data.reference,`package-${label}`);
    assert.equal(submissions[offset+1].kind,'membership');assert.equal(submissions[offset+1].data.reference,`package-${label}`);
  }
  try{
    const sdkProcess=await processResult(['--input-type=module','-e',`
      import assert from 'node:assert/strict';
      import {JevBrowser} from '@tontoko/jev-browser';
      const request=JSON.parse(process.argv[1]);
      const core=await JevBrowser.launch();
      try{
        await core.goto(request.url);
        const first=await core.run(request.run.instruction,{values:request.run.values,settleTimeoutMs:request.run.settleTimeoutMs});
        assert.equal(first.reason,'missing-input');assert.ok(first.continuation?.id);
        const second=await core.resume(first.continuation.id,{values:{membershipCode:'SDK-42'}});
        console.log(JSON.stringify({first:{reason:first.reason,continuation:!!first.continuation},second:{status:second.status,checkpoints:second.checkpoints?.length}}));
      }finally{await core.close();}
    `,JSON.stringify({url:site.url,run:runOptions('sdk')})],{cwd:directory,env});
    assert.equal(sdkProcess.code,0,sdkProcess.stdout+sdkProcess.stderr);
    const sdk=JSON.parse(sdkProcess.stdout);assert.equal(sdk.second.status,'complete');assert.equal(sdk.second.checkpoints,2);verifyPair(0,'sdk');

    const session=`package-resume-${process.pid}`;
    const cli=(args)=>processResult([join(pkg,'dist/cli.js'),...args],{cwd:directory,env});
    const opened=await cli(['open',site.url,'--session',session]);assert.equal(opened.code,0,opened.stdout+opened.stderr);
    try{
      const first=await cli(['run','--session',session,'--args',JSON.stringify(runOptions('cli'))]);
      assert.equal(first.code,2,first.stdout+first.stderr);const firstResult=JSON.parse(first.stdout).result;assert.ok(firstResult.continuation?.id);
      const second=await cli(['resume',firstResult.continuation.id,'--session',session,'--values',JSON.stringify({membershipCode:'CLI-42'})]);
      assert.equal(second.code,0,second.stdout+second.stderr);assert.equal(JSON.parse(second.stdout).result.status,'complete');
    }finally{await cli(['close','--session',session]);}
    verifyPair(2,'cli');

    const client=new Client({name:'installed-resume-proof',version:'1'});
    try{
      await client.connect(new StdioClientTransport({command:process.execPath,args:[join(pkg,'dist/mcp-stdio.js')],cwd:directory,env,stderr:'pipe'}));
      const tools=await client.listTools();assert.ok(tools.tools.some(tool=>tool.name==='browser_resume'));
      const navigation=await client.callTool({name:'browser_goto',arguments:{url:site.url}});assert.notEqual(navigation.isError,true);
      const first=await client.callTool({name:'browser_run',arguments:runOptions('mcp')});assert.notEqual(first.isError,true,JSON.stringify(first));
      const firstResult=first.structuredContent??JSON.parse(first.content.find(item=>item.type==='text').text);assert.ok(firstResult.continuation?.id);
      const second=await client.callTool({name:'browser_resume',arguments:{continuationId:firstResult.continuation.id,values:{membershipCode:'MCP-42'}}});assert.notEqual(second.isError,true,JSON.stringify(second));
      const secondResult=second.structuredContent??JSON.parse(second.content.find(item=>item.type==='text').text);assert.equal(secondResult.status,'complete');
    }finally{await client.close();}
    verifyPair(4,'mcp');
    assert.equal(submissions.length,6);
    return {installedSDKResume:true,installedCLIResume:true,installedMCPResume:true};
  }finally{await provider.close();await site.close();}
}
