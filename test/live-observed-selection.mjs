// Opt-in real-provider regressions, not an unseen-site benchmark.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {JevBrowser,JevDecisionEngine} from '../dist/index.js';
import {fixtureBrowser,httpServer} from './helpers.mjs';
import {selectionFixture} from './selection-fixture.mjs';
let browser;
before(async()=>{browser=await fixtureBrowser();});after(async()=>{await browser?.close();});
for(const tag of ['p','span','output','dd'])test('LIVE observed progress: delayed '+tag,async t=>{
  let submissions=0;
  const service=await httpServer(async(req,res)=>{
    if(req.url==='/save'){submissions++;res.end('ok');return;}
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<button onclick="fetch('/save',{method:'POST'}).then(()=>setTimeout(()=>document.querySelector('#result').textContent='Saved',180))">Save</button><${tag} id="result">Pending</${tag}>`);
  });
  const core=await JevBrowser.launch();t.after(async()=>{await core.close();await service.close();});await core.goto(service.url);
  const start=performance.now();const r=await core.run('Click Save once and confirm it is saved.',{until:async page=>(await page.locator('#result').textContent())==='Saved'});
  console.log(JSON.stringify({case:'progress-'+tag,status:r.status,reason:r.reason,ms:Math.round(performance.now()-start),submissions,usage:r.usage}));
  assert.equal(r.status,'complete',JSON.stringify(r));assert.equal(submissions,1);
});
for(const [value,options,country] of [
 ['Japan',[{label:'Choose',value:''},{label:'日本',value:'JP'},{label:'ドイツ',value:'DE'}],'JP'],
 ['Deutschland',[{label:'Choose',value:''},{label:'Japan',value:'JP'},{label:'Germany',value:'DE'}],'DE'],
])test('LIVE semantic selection: '+value,async t=>{
  const engine=new JevDecisionEngine(),requests=[];const wrapped={decide(r,o){requests.push(structuredClone(r));return engine.decide(r,o);}};
  const app=await selectionFixture(t,browser,{engine:wrapped,options,resultCountry:country});
  const start=performance.now();const r=await app.core.run('Set the supplied country and private note, then Save once and verify the address.',{values:{country:value,note:'synthetic-private-note'},semanticInputs:{'/country':0.8}});
  console.log(JSON.stringify({case:value,status:r.status,reason:r.reason,ms:Math.round(performance.now()-start),submissions:app.submissions.length,usage:r.usage,resolution:r.inputs?.find(i=>i.path==='/country')?.resolution,blockers:r.blockers}));
  assert.equal(r.status,'complete',JSON.stringify(r));assert.equal(app.submissions.length,1);assert.equal(app.submissions[0].a9,country);
  assert.ok(requests.some(r=>r.state.suppliedSelections?.['/country']===value));
  assert.ok(requests.every(r=>!JSON.stringify(r).includes('synthetic-private-note')));
});

test('LIVE semantic selection: distant option in a thousand-option list',async t=>{
  const options=[{label:'Choose',value:''},...Array.from({length:998},(_,i)=>({label:`Synthetic destination ${i}`,value:`d${i}`})),{label:'日本',value:'JP'}];
  const engine=new JevDecisionEngine(),requests=[];const wrapped={decide(r,o){requests.push(structuredClone(r));return engine.decide(r,o);}};
  const app=await selectionFixture(t,browser,{engine:wrapped,options});
  const start=performance.now();const r=await app.core.run('Set the country and private note, Save once, and verify the address.',{values:{country:'Japan',note:'synthetic-large-list-note'},semanticInputs:{'/country':0.8}});
  const optionCalls=requests.filter(r=>Object.keys(r.questions).some(id=>id.startsWith('selection_')));
  console.log(JSON.stringify({case:'semantic-1000-options',status:r.status,reason:r.reason,ms:Math.round(performance.now()-start),submissions:app.submissions.length,usage:r.usage,optionRequests:optionCalls.length,optionQuestions:optionCalls.reduce((n,r)=>n+Object.keys(r.questions).length,0)}));
  assert.equal(r.status,'complete',JSON.stringify(r));assert.equal(app.submissions.length,1);assert.equal(app.submissions[0].a9,'JP');
  assert.ok(optionCalls.some(r=>Object.values(r.questions).some(q=>Object.hasOwn(q.criteria,'option_999'))));
});
