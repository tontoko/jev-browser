import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {z} from 'zod';
import {JevBrowser,JevDecisionEngine} from '../dist/index.js';
import {BrowserError,publicError} from '../dist/errors.js';
import {capture} from '../dist/observation.js';
import {waitForRelevantChange} from '../dist/completion.js';
import {fixtureBrowser,engine,apiResult} from './helpers.mjs';
import {selectionFixture} from './selection-fixture.mjs';
let browser;
before(async()=>{browser=await fixtureBrowser();});after(async()=>{await browser?.close();});
const limits={maxElements:120,maxTexts:160};
const simpleEngine=()=>engine((q,r,id)=>id.startsWith('effect_')?'commit':id==='action'?c=>c?.kind==='click'&&c.target?.name==='Save':'__none__');
async function scopeApp(t,{moveAt,entry}={}){
 const context=await browser.newContext(),page=await context.newPage();
 await page.setContent('<main id="allowed"><section id="inner"><form aria-label="Record"><button type="button" onclick="window.saves=(window.saves||0)+1">Save</button></form></section><section id="another"></section></main><aside id="outside"></aside>');
 const move=()=>page.evaluate(()=>document.querySelector('#outside').append(document.querySelector('form')));
 const decider=simpleEngine(),original=decider.decide.bind(decider);let moved=false;
 decider.decide=async(r,o)=>{const result=await original(r,o);if(moveAt==='model'&&!moved){moved=true;await move();}return result;};
 const policy=kind=>async()=>{if(moveAt===kind&&!moved){moved=true;await move();}return true;};
 const core=new JevBrowser({page,engine:decider,allowAction:policy('allowAction'),allowCommand:policy('allowCommand')});
 t.after(async()=>{await core.close();await context.close();});
 const invoke=()=>entry==='run'?core.run('Save the record once.',{scope:'#allowed',settleTimeoutMs:80,maxSteps:4,until:p=>p.evaluate(()=>window.saves===1)}):core.act('Click Save.',{scope:'#allowed'});
 return {core,page,move,invoke};
}
for(const entry of ['act','run'])for(const moveAt of ['model','allowAction','allowCommand'])test(`boundary scope: ${entry} cannot execute after ${moveAt} moves target outside`,async t=>{
 const a=await scopeApp(t,{entry,moveAt});let result,error;try{result=await a.invoke();}catch(e){error=e;}
 assert.equal(await a.page.evaluate(()=>window.saves||0),0);assert.notEqual(result?.status,'complete');assert.notEqual(result?.status,'executed');
 if(error)assert.ok(['STALE_TARGET','SCOPE_CHANGED','SEMANTIC_NO_MATCH'].includes(error.code),error.code);
});
for(const entry of ['act','run'])test(`boundary scope: stable ${entry} remains executable`,async t=>{const a=await scopeApp(t,{entry});const r=await a.invoke();assert.equal(r.status,entry==='run'?'complete':'executed');assert.equal(await a.page.evaluate(()=>window.saves),1);});
for(const entry of ['plan','native-ref'])test(`boundary scope: captured scope survives ${entry} handoff`,async t=>{
 const a=await scopeApp(t);const h=entry==='plan'?await a.core.observe('Click Save.',{scope:'#allowed'}):(await a.core.snapshot({scope:'#allowed'})).elements.find(e=>e.name==='Save');await a.move();
 await assert.rejects(entry==='plan'?a.core.act({id:h.id}):a.core.native({command:'click',ref:h.id}),{code:'STALE_TARGET'});assert.equal(await a.page.evaluate(()=>window.saves||0),0);
});
test('boundary scope: moving within allowed scope is not a false refusal',async t=>{const a=await scopeApp(t);const plan=await a.core.observe('Click Save.',{scope:'#allowed'});await a.page.evaluate(()=>document.querySelector('#another').append(document.querySelector('form')));assert.equal((await a.core.act({id:plan.id})).status,'executed');});
for(const mode of ['scope','selection'])for(const changed of ['none','outside','inside'])test(`boundary progress: ${mode} / ${changed} excludes unrelated frame/region`,async t=>{
 const context=await browser.newContext(),page=await context.newPage();t.after(()=>context.close());
 await page.setContent('<main id="task"><p id="inside">Pending</p></main><aside id="ticker">zero</aside><iframe srcdoc="<p>Unrelated</p>"></iframe>');await page.frameLocator('iframe').locator('p').waitFor();
 const handle=mode==='selection'?await page.locator('#task').elementHandle():undefined;
 const snapshot=await capture(page,{...limits,...(handle?{selection:{frame:page.mainFrame(),roots:[handle]}}:{scope:'#task'})});t.after(async()=>{await snapshot.dispose();await handle?.dispose();});
 if(changed==='outside')await page.locator('#ticker').evaluate(el=>el.textContent='one');if(changed==='inside')await page.locator('#inside').evaluate(el=>el.textContent='Saved');
 const start=performance.now(),actual=await waitForRelevantChange(page,snapshot,180,new AbortController().signal);assert.equal(actual,changed==='inside');if(changed!=='inside')assert.ok(performance.now()-start>=100);
});
test('boundary progress: replacement of a captured root is genuine change',async t=>{
 const page=await browser.newPage();t.after(()=>page.close());await page.setContent('<main id="task"><p>Pending</p></main>');const observed=await capture(page,{...limits,scope:'#task'});t.after(()=>observed.dispose());
 await page.locator('#task').evaluate(el=>el.outerHTML='<main id="task"><p>Pending</p></main>');assert.equal(await waitForRelevantChange(page,observed,180,new AbortController().signal),true);
});
for(const mode of ['stable','changed','removed','replaced','rejected'])test(`boundary checkpoint: ${mode} readback must be current before adoption`,async t=>{
 const f=await selectionFixture(t,browser),original=f.decider.decide.bind(f.decider);let reads=0;
 f.decider.decide=async(r,o)=>{const result=await original(r,o);if(r.questions.completion){reads++;
  if(mode==='rejected'&&r.state.page.texts.some(s=>s.role==='alert'))result.answers.completion.choice='rejected';
  if(reads===1){if(mode==='changed')await f.page.locator('#result dd').first().evaluate(el=>el.textContent='DE');if(mode==='removed')await f.page.locator('#result article').evaluate(el=>el.remove());if(mode==='replaced')await f.page.locator('#result article').evaluate(el=>el.outerHTML=el.outerHTML);if(mode==='rejected')await f.page.evaluate(()=>{const p=document.createElement('p');p.setAttribute('role','alert');p.textContent='Address rejected';document.body.append(p);});}}
  return result;};
 const r=await f.core.run('Save address once and verify the saved fields.',{values:{country:'JP',note:'synthetic-checkpoint'},settleTimeoutMs:120,timeoutMs:7000});assert.equal(f.submissions.length,1);
 if(mode==='stable'){assert.equal(r.status,'complete');assert.equal(reads,1);}else if(mode==='replaced'){assert.equal(r.status,'complete');assert.ok(reads>=2);}else{assert.notEqual(r.status,'complete');assert.equal(r.checkpoints?.length??0,0);}
});
test('boundary fixture: injected provider confidence and answer object are not rewritten',async t=>{
 const base=engine((q,r,id)=>id.startsWith('bind_')?r.state.page.elements.find(e=>e.name===(q.instructions.includes('"/country"')?'Country':'Private note'))?.id??'__none__':id.startsWith('effect_')?'commit':id==='action'?c=>c?.kind==='click'&&c.target?.name==='Save':id.startsWith('selection_')?'option_1':id==='completion'?'complete':id.startsWith('read_')?r.state.sources.find(s=>s.context.startsWith(q.instructions.includes('"/country"')?'Country ':'Private note '))?.id??'__none__':'__none__');
 let answer;const injected={async decide(r,o){const result=await base.decide(r,o);if(Object.keys(r.questions).some(id=>id.startsWith('selection_'))){for(const a of Object.values(result.answers))a.confidence=0.2;answer=result;}return result;}};const raw=injected.decide;
 const app=await selectionFixture(t,browser,{engine:injected});const r=await app.core.run('Set country and private note then Save once.',{values:{country:'Japan',note:'private-fixture'},semanticInputs:{'/country':0.8}});
 assert.equal(r.reason,'unresolved-input');assert.equal(app.submissions.length,0);assert.ok(Object.values(answer.answers).every(a=>a.confidence===0.2));assert.equal(injected.decide,raw);
});
async function envCase(values,body){const keys=['JEV_API_KEY','TYPESAFE_API_KEY','JEV_BASE_URL','TYPESAFE_BASE_URL','JEV_ENDPOINT_API_KEY'],prev=Object.fromEntries(keys.map(k=>[k,process.env[k]]));try{for(const k of keys)delete process.env[k];Object.assign(process.env,values);return await body();}finally{for(const k of keys)prev[k]===undefined?delete process.env[k]:process.env[k]=prev[k];}}
const q={state:{synthetic:true},questions:{action:{type:'choice',instructions:'Choose',criteria:{a:'Observed A'}}}};
for(const c of [
 {name:'hosted default',env:{JEV_API_KEY:'SYNTHETIC-CLOUD'},key:'SYNTHETIC-CLOUD',url:'https://api.typesafe.ai/v1/systemone'},
 {name:'explicit hosted origin',env:{JEV_API_KEY:'SYNTHETIC-CLOUD'},baseURL:'https://api.typesafe.ai',key:'SYNTHETIC-CLOUD',url:'https://api.typesafe.ai/v1/systemone'},
 {name:'custom default',env:{JEV_API_KEY:'SYNTHETIC-CLOUD'},baseURL:'http://127.0.0.1:18765',key:'local',url:'http://127.0.0.1:18765/v1/systemone'},
 {name:'custom explicit',env:{JEV_API_KEY:'SYNTHETIC-CLOUD'},baseURL:'http://127.0.0.1:18765',apiKey:'SYNTHETIC-PROXY',key:'SYNTHETIC-PROXY',url:'http://127.0.0.1:18765/v1/systemone'},
 {name:'custom environment credential',env:{JEV_API_KEY:'SYNTHETIC-CLOUD',JEV_BASE_URL:'http://127.0.0.1:18765',JEV_ENDPOINT_API_KEY:'SYNTHETIC-ENDPOINT'},key:'SYNTHETIC-ENDPOINT',url:'http://127.0.0.1:18765/v1/systemone'},
 {name:'SDK endpoint environment cannot redirect implicit cloud',env:{JEV_API_KEY:'SYNTHETIC-CLOUD',TYPESAFE_BASE_URL:'http://127.0.0.1:18765'},key:'SYNTHETIC-CLOUD',url:'https://api.typesafe.ai/v1/systemone'}
])test(`boundary credential: ${c.name}`,()=>envCase(c.env,async()=>{let seen;const e=new JevDecisionEngine({...('baseURL'in c?{baseURL:c.baseURL}:{}),...('apiKey'in c?{apiKey:c.apiKey}:{}),fetch:async(url,init)=>{seen={url:String(url),key:new Headers(init.headers).get('authorization')};return Response.json(apiResult(q));}});await e.decide(q);assert.equal(seen.url,c.url);assert.equal(seen.key,`Bearer ${c.key}`);}));
async function pair(t,same=false){const context=await browser.newContext(),a=await context.newPage(),b=same?a:await context.newPage();await a.setContent('<button onclick="window.accepted=confirm(\'Confirm save\')">Save</button>');if(!same)await b.setContent('<p>Other page</p><input type="file">');const coreA=new JevBrowser({page:a}),coreB=new JevBrowser({page:b});t.after(async()=>{await coreB.close();await coreA.close();await context.close();});return {context,a,b,coreA,coreB};}
for(const same of [false,true])test(`boundary dialog: closing another core (${same?'same':'different'} Page) cannot dismiss owner dialog`,async t=>{const f=await pair(t,same);assert.equal((await f.coreA.native({command:'click',target:'button'})).status,'dialog');if(!same)assert.ok((await f.coreB.snapshot()).texts.some(x=>x.text==='Other page'));await f.coreB.close();await f.coreA.native({command:'handle_dialog',accept:true});assert.equal(await f.a.evaluate(()=>window.accepted),true);});
test('boundary dialog: a foreign core cannot explicitly answer another Page dialog',async t=>{const f=await pair(t);await f.coreA.native({command:'click',target:'button'});await assert.rejects(f.coreB.native({command:'handle_dialog',accept:true}),{code:'NO_DIALOG'});await f.coreA.native({command:'handle_dialog',accept:true});assert.equal(await f.a.evaluate(()=>window.accepted),true);});
test('boundary dialog: independent Page ownership survives browser-specific modal scheduling',async t=>{
 const f=await pair(t);await f.b.setContent('<button onclick="window.accepted=confirm(\'Other save\')">Save</button>');
 const entries=[{core:f.coreA,page:f.a},{core:f.coreB,page:f.b}];
 const pending=entries.map(async(entry,index)=>({index,result:await entry.core.native({command:'click',target:'button'})}));
 const first=await Promise.race(pending);assert.equal(first.result.status,'dialog');
 // Firefox presents tab dialogs sequentially; ownership must not depend on simultaneous presentation.
 await entries[first.index].core.close();const second=await pending[1-first.index];assert.equal(second.result.status,'dialog');
 await entries[second.index].core.native({command:'handle_dialog',accept:true});assert.equal(await entries[second.index].page.evaluate(()=>window.accepted),true);
});
for(const mode of ['other-page','same-page-other-core','tab-switch'])test(`boundary chooser: ${mode} cannot upload to a foreign chooser`,async t=>{
 const f=await pair(t,mode==='same-page-other-core');await f.a.setContent('<input type="file" id="attachment" style="display:none"><button onclick="document.querySelector(\'input\').click()">Attach</button>');
 const notice=f.a.waitForEvent('filechooser');await f.coreA.native({command:'click',target:'button'});await notice;
 if(mode==='tab-switch')await f.coreA.native({command:'tabs',action:'select',index:1});
 const foreign=mode==='tab-switch'?f.coreA:f.coreB;await assert.rejects(foreign.native({command:'file_upload',paths:[]}),{code:'NO_FILE_CHOOSER'});assert.equal(await f.a.locator('input').evaluate(e=>e.files.length),0);
});
test('boundary chooser: correct owner can still upload an allowed synthetic file',async t=>{
 const context=await browser.newContext(),page=await context.newPage(),dir=await mkdtemp(join(tmpdir(),'jev-boundary-own-'));const file=join(dir,'synthetic.txt');await writeFile(file,'test');await page.setContent('<input type="file"><button onclick="document.querySelector(\'input\').click()">Attach</button>');
 const core=new JevBrowser({page,fileRoots:[dir]});t.after(async()=>{await core.close();await context.close();await rm(dir,{recursive:true,force:true});});
 const notice=page.waitForEvent('filechooser');await core.native({command:'click',target:'button'});await notice;assert.equal((await core.native({command:'file_upload',paths:[file]})).count,1);assert.equal(await page.locator('input').evaluate(e=>e.files[0].name),'synthetic.txt');
});
for(const closed of [false,true])test(`boundary partial: diagnostic failure preserves executed facts (${closed?'closed':'open'})`,async t=>{
 const page=await browser.newPage();let nexts=0;await page.exposeFunction('recordNext',()=>{nexts++;});
 await page.setContent('<form><label>Email<input></label><button type="button" onclick="window.recordNext();document.querySelector(\'input\').type=\'hidden\';this.textContent=\'Continue\'">Next</button></form>');
 const decider=engine((q,r,id)=>id.startsWith('bind_')?r.state.page.elements.find(e=>e.name==='Email')?.id??'__none__':id.startsWith('effect_')?'advance':id==='action'?c=>c?.kind==='click'&&c.target?.name==='Next':'__none__');const decide=decider.decide.bind(decider);let calls=0;
 decider.decide=async(r,o)=>{calls++;if(calls>1){if(closed)await page.close();throw new BrowserError('PROVIDER_ERROR','Synthetic primary failure');}return decide(r,o);};
 const core=new JevBrowser({page,engine:decider});t.after(async()=>{await core.close();await page.close();});let e;try{await core.run('Enter email, click Next, then continue.',{values:{email:'synthetic@example.invalid'},decisionRetries:0});}catch(error){e=error;}
 assert.equal(e?.code,'PROVIDER_ERROR');assert.equal(publicError(e).code,'PROVIDER_ERROR');assert.equal(nexts,1);assert.ok(e.partial.steps.some(s=>s.plan.action.kind==='fill'));assert.ok(e.partial.steps.some(s=>s.plan.action.kind==='click'));if(closed)assert.equal(e.partial.continuation,undefined);
});
test('boundary evidence: literal dotted and nested keys retain distinct sources',async t=>{
 const page=await browser.newPage();await page.setContent('<dl><dt>Literal</dt><dd>flat-value</dd><dt>Nested</dt><dd>nested-value</dd></dl>');const core=new JevBrowser({page,engine:engine(q=>c=>c?.value===(q.instructions.includes('LITERAL_FIELD')?'flat-value':'nested-value'))});t.after(async()=>{await core.close();await page.close();});
 const r=await core.extract('Extract each labeled field.',z.object({'a.b':z.string().describe('LITERAL_FIELD'),a:z.object({b:z.string().describe('NESTED_FIELD')})}));assert.deepEqual(r.data,{'a.b':'flat-value',a:{b:'nested-value'}});assert.equal(Object.keys(r.evidence).length,2);assert.equal(r.evidence['a\\.b'].copiedValue,'flat-value');assert.equal(r.evidence['a.b'].copiedValue,'nested-value');
});
test('boundary evidence: empty and backslash keys have reversible distinct identifiers',async t=>{
 const page=await browser.newPage();await page.setContent('<p>empty-value</p><p>slash-value</p>');const core=new JevBrowser({page,engine:engine(q=>c=>c?.value===(q.instructions.includes('EMPTY_FIELD')?'empty-value':'slash-value'))});t.after(async()=>{await core.close();await page.close();});
 const r=await core.extract('Extract both values.',z.object({'':z.string().describe('EMPTY_FIELD'),'\\e':z.string().describe('SLASH_FIELD')}));assert.equal(r.evidence['\\e'].copiedValue,'empty-value');assert.equal(r.evidence['\\\\e'].copiedValue,'slash-value');
});
