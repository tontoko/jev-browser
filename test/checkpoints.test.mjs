import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JevBrowser } from '../dist/index.js';
import { fixtureBrowser, engine, httpServer } from './helpers.mjs';

let browser;
before(async()=>{browser=await fixtureBrowser();});
after(async()=>{await browser?.close();});

function stagedEngine(){
  let completions=0;
  return engine((question,request,name)=>{
    if(name.startsWith('bind_')){
      const input=request.state.inputs.find(input=>question.instructions.includes(JSON.stringify(input.path)));
      return request.state.page.elements.find(element=>element.fieldName===input?.path)?.id ?? '__none__';
    }
    if(name.startsWith('effect_')) return request.state.actions?.[name.slice('effect_'.length)]?.target?.name?.startsWith('Save ') ? 'commit' : 'advance';
    if(name==='action'){
      const wanted=request.state.history?.some(action=>action.target?.name==='Save account')?'Save membership':'Save account';
      return candidate=>candidate?.kind==='click'&&candidate.target?.name===wanted;
    }
    if(name==='completion') return ++completions===1?'incomplete':'complete';
    if(name.startsWith('read_')) return request.state.sources.find(source=>source.text==='[input:/reference]')?.id ?? '__none__';
    return '__none__';
  });
}

async function twoCommitFixture(t){
  const submissions=[];
  const service=await httpServer(async(req,res)=>{
    if(req.url==='/account'||req.url==='/membership'){
      let raw=''; for await(const chunk of req)raw+=chunk;
      const data=JSON.parse(raw); submissions.push({kind:req.url.slice(1),data});
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return;
    }
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`<h1>Account setup</h1>
      <form aria-label="Account setup">
        <label>Reference<input name="/reference" required></label>
        <button type="button" id="account">Save account</button>
        <button type="button" id="membership" hidden>Save membership</button>
      </form>
      <section id="results"></section>
      <script>
        const input=document.querySelector('input');
        function result(title,value){
          const article=document.createElement('article');
          article.innerHTML='<h2>'+title+'</h2><dl><dt>Reference</dt><dd></dd></dl>';
          article.querySelector('dd').textContent=value;document.querySelector('#results').append(article);
        }
        document.querySelector('#account').onclick=async()=>{
          const value=input.value;const response=await fetch('/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reference:value})});
          const saved=await response.json();result('Account created',saved.reference);
          document.querySelector('#account').hidden=true;document.querySelector('#membership').hidden=false;
        };
        document.querySelector('#membership').onclick=async()=>{
          const value=input.value;const response=await fetch('/membership',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reference:value})});
          const saved=await response.json();result('Membership created',saved.reference);
          document.querySelector('#membership').hidden=true;
        };
      </script>`);
  });
  const page=await browser.newPage();await page.goto(service.url);
  const decider=stagedEngine();const core=new JevBrowser({page,engine:decider});
  t.after(async()=>{await core.close();await page.close();await service.close();});
  return {core,page,submissions,decider};
}

test('checkpoints: a verified intermediate commit continues to a second commit',async t=>{
  const {core,submissions}=await twoCommitFixture(t);
  const result=await core.run('Save the account, then save its membership, and finish only after both are created.',{
    values:{reference:'acct-042'},
  });
  assert.equal(result.status,'complete',JSON.stringify(result));
  assert.deepEqual(submissions.map(entry=>entry.kind),['account','membership']);
  assert.equal(result.checkpoints.length,2);
  assert.equal(result.checkpoints[0].verification.basis,'ui-readback');
  assert.equal(result.checkpoints[1].verification.basis,'ui-readback');
  assert.notEqual(result.checkpoints[0].effectId,result.checkpoints[1].effectId);
});

test('checkpoints: prior input stays satisfied after its form disappears',async t=>{
  const submissions=[];
  const service=await httpServer(async(req,res)=>{
    if(req.url==='/account'||req.url==='/membership'){
      let raw='';for await(const chunk of req)raw+=chunk;const data=JSON.parse(raw);submissions.push(req.url.slice(1));
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return;
    }
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<main><form id="first"><label>Reference<input name="/reference" required></label><button type="button">Save account</button></form><section id="results"></section></main><script>
      let reference='';const results=document.querySelector('#results');
      function add(title,value){const a=document.createElement('article');a.innerHTML='<h2>'+title+'</h2><dl><dt>Reference</dt><dd></dd></dl>';a.querySelector('dd').textContent=value;results.append(a);}
      document.querySelector('button').onclick=async()=>{reference=document.querySelector('input').value;await fetch('/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reference})});add('Account created',reference);document.querySelector('#first').remove();const f=document.createElement('form');f.innerHTML='<button type="button">Save membership</button>';document.querySelector('main').prepend(f);f.querySelector('button').onclick=async()=>{await fetch('/membership',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reference})});add('Membership created',reference);f.remove();};};
    </script>`);
  });
  const page=await browser.newPage();await page.goto(service.url);const core=new JevBrowser({page,engine:stagedEngine()});
  t.after(async()=>{await core.close();await page.close();await service.close();});
  const result=await core.run('Save the account, then save its membership.',{values:{reference:'detached-042'}});
  assert.equal(result.status,'complete',JSON.stringify(result));assert.deepEqual(submissions,['account','membership']);assert.equal(result.checkpoints.length,2);
});

test('checkpoints: failure after checkpoint one never recreates checkpoint one',async t=>{
  const submissions=[];let completions=0;
  const service=await httpServer(async(req,res)=>{
    if(req.url==='/account'){let raw='';for await(const chunk of req)raw+=chunk;const data=JSON.parse(raw);submissions.push('account');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return;}
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<form><label>Reference<input name="/reference" required></label><button type="button">Save account</button></form><section></section><script>document.querySelector('button').onclick=async()=>{const value=document.querySelector('input').value;await fetch('/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reference:value})});const a=document.createElement('article');a.innerHTML='<h2>Account created</h2><dl><dt>Reference</dt><dd></dd></dl>';a.querySelector('dd').textContent=value;document.querySelector('section').append(a);document.querySelector('form').remove();};</script>`);
  });
  const decider=engine((question,request,name)=>{
    if(name.startsWith('bind_'))return request.state.page.elements.find(e=>e.fieldName==='/reference')?.id??'__none__';
    if(name.startsWith('effect_'))return 'commit';
    if(name==='completion')return ++completions===1?'incomplete':'complete';
    if(name.startsWith('read_'))return request.state.sources.find(s=>s.text==='[input:/reference]')?.id??'__none__';
    if(name==='action')return candidate=>candidate?.target?.name==='Save account';return '__none__';
  });
  const page=await browser.newPage();await page.goto(service.url);const core=new JevBrowser({page,engine:decider});t.after(async()=>{await core.close();await page.close();await service.close();});
  const result=await core.run('Save the account, then continue to the unavailable next stage.',{values:{reference:'once-042'},settleTimeoutMs:100});
  assert.equal(result.status,'stopped');assert.deepEqual(submissions,['account']);assert.equal(result.checkpoints.length,1);
});

test('checkpoints: the same verified commit cannot be submitted twice without progress',async t=>{
  const submissions=[];let completions=0;
  const service=await httpServer(async(req,res)=>{
    if(req.url==='/save'){let raw='';for await(const chunk of req)raw+=chunk;const data=JSON.parse(raw);submissions.push(data);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return;}
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<form><label>Reference<input name="/reference" required></label><button type="button">Save account</button></form><section></section><script>document.querySelector('button').onclick=async()=>{const value=document.querySelector('input').value;await fetch('/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reference:value})});const a=document.createElement('article');a.innerHTML='<h2>Account created</h2><dl><dt>Reference</dt><dd></dd></dl>';a.querySelector('dd').textContent=value;document.querySelector('section').append(a);};</script>`);
  });
  const decider=engine((question,request,name)=>{
    if(name.startsWith('bind_'))return request.state.page.elements.find(e=>e.fieldName==='/reference')?.id??'__none__';
    if(name.startsWith('effect_'))return 'commit';
    if(name==='completion')return ++completions===1?'incomplete':'complete';
    if(name.startsWith('read_'))return request.state.sources.find(s=>s.text==='[input:/reference]')?.id??'__none__';
    if(name==='action')return candidate=>candidate?.target?.name==='Save account';return '__none__';
  });
  const page=await browser.newPage();await page.goto(service.url);const core=new JevBrowser({page,engine:decider});t.after(async()=>{await core.close();await page.close();await service.close();});
  const result=await core.run('Save this account once. Do not submit the same save twice.',{values:{reference:'duplicate-guard'},settleTimeoutMs:100});
  assert.equal(result.status,'stopped');assert.equal(submissions.length,1);assert.equal(result.checkpoints.length,1);
});
