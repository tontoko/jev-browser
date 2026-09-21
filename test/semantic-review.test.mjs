import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {JevBrowser} from '../dist/index.js';
import {fixtureBrowser} from './helpers.mjs';
let browser;before(async()=>{browser=await fixtureBrowser();});after(async()=>{await browser?.close();});
async function setup(t,html,provider){const page=await browser.newPage();await page.setContent(html);const core=new JevBrowser({page,engine:provider});t.after(async()=>{await core.close();await page.close();});return {core,page};}

for(const batch of [false,true])test('semantic review: target discovery retains scope during '+(batch?'batch':'single')+' inference',async t=>{
 let page;const provider={async decide(r){await page.locator('button').evaluate(el=>document.querySelector('#outside').append(el));return {answers:Object.fromEntries(Object.entries(r.questions).map(([id,q])=>[id,{choice:Object.entries(q.criteria).find(([,v])=>v?.name==='Archive')[0],confidence:1}]))};}};
 const app=await setup(t,'<section id="allowed"><button>Archive</button></section><section id="outside"></section>',provider);page=app.page;
 await assert.rejects(batch?app.core.locateSemanticBatch(['Archive button','Archive action'],{scope:'#allowed'}):app.core.locateSemantic('Archive button',{scope:'#allowed'}),{code:'SEMANTIC_NO_MATCH'});
});

for(const checked of ['true','false','mixed'])test('semantic review: unchanged ARIA label is not confused with '+checked+' state evidence',async t=>{
 const provider={async decide(r){const source=r.state.page.sources.find(x=>x.text==='Notifications'&&x.value===undefined);assert.ok(source);return {answers:{source_0:{choice:source.id,confidence:1}}};}};
 const {core}=await setup(t,'<div role="checkbox" aria-checked="'+checked+'">Notifications</div>',provider);const r=await core.assertSemantic({actual:{description:'Notification control label'},expected:'Notifications'});assert.equal(r.freshness,'verified');assert.equal(r.evidence.value,undefined);
});

test('semantic review: checked-state source still detects a changed state',async t=>{
 let page;const provider={async decide(r){const source=r.state.page.sources.find(x=>x.value===true);assert.ok(source);await page.locator('[role=checkbox]').evaluate(el=>el.setAttribute('aria-checked','false'));return {answers:{source_0:{choice:source.id,confidence:1}}};}};
 const app=await setup(t,'<div role="checkbox" aria-checked="true">Notifications</div>',provider);page=app.page;await assert.rejects(app.core.assertSemantic({actual:{description:'Notifications enabled state'},expected:'true'}),e=>e.semantic.results[0].freshness==='changed'&&e.semantic.results[0].currentEvidence.value===false);
});
