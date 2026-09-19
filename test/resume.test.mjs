import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {JevBrowser} from '../dist/index.js';
import {fixtureBrowser,engine,httpServer} from './helpers.mjs';

let browser;
before(async()=>{browser=await fixtureBrowser();});
after(async()=>{await browser?.close();});

function resumeEngine(){
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

async function resumableFixture(t){
  const submissions=[];
  const service=await httpServer(async(req,res)=>{
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
  const page=await browser.newPage();await page.goto(service.url);const core=new JevBrowser({page,engine:resumeEngine()});
  t.after(async()=>{await core.close();await page.close();await service.close();});
  return {core,page,submissions};
}

test('resume: stopped work exposes only an opaque continuation and resumes from the next stage',async t=>{
  const {core,submissions}=await resumableFixture(t);
  const first=await core.run('Save the account, then save its membership. Do not finish before both exist.',{values:{reference:'secret-reference'},settleTimeoutMs:100});
  assert.equal(first.status,'stopped');assert.equal(first.reason,'missing-input');assert.equal(first.checkpoints.length,1);
  assert.ok(first.continuation?.id);assert.equal(JSON.stringify(first).includes('secret-reference'),false);
  assert.deepEqual(submissions.map(entry=>entry.kind),['account']);
  const second=await core.resume(first.continuation.id,{values:{membershipCode:'MEM-42'}});
  assert.equal(second.status,'complete',JSON.stringify(second));assert.equal(second.checkpoints.length,2);
  assert.deepEqual(submissions.map(entry=>entry.kind),['account','membership']);
  assert.equal(submissions[1].data.membershipCode,'MEM-42');
});

test('resume: changing a checkpointed value is rejected before another mutation',async t=>{
  const {core,submissions}=await resumableFixture(t);
  const first=await core.run('Save the account, then save its membership.',{values:{reference:'fixed-reference'},settleTimeoutMs:100});
  assert.ok(first.continuation?.id);assert.deepEqual(submissions.map(entry=>entry.kind),['account']);
  await assert.rejects(core.resume(first.continuation.id,{values:{reference:'changed-reference',membershipCode:'MEM-99'}}),{code:'CONTINUATION_CONFLICT'});
  assert.deepEqual(submissions.map(entry=>entry.kind),['account']);
});

test('resume: continuation IDs are local to one core and disappear on close',async t=>{
  const {core,page}=await resumableFixture(t);
  const first=await core.run('Save the account, then save its membership.',{values:{reference:'session-local'},settleTimeoutMs:100});
  assert.ok(first.continuation?.id);
  const other=new JevBrowser({page,engine:resumeEngine()});
  t.after(async()=>{await other.close();});
  await assert.rejects(other.resume(first.continuation.id,{values:{membershipCode:'MEM-X'}}),{code:'CONTINUATION_NOT_FOUND'});
  await core.close();
  await assert.rejects(core.resume(first.continuation.id,{values:{membershipCode:'MEM-X'}}),{code:'CONTINUATION_NOT_FOUND'});
});
