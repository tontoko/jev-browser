import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {JevBrowser} from '../dist/index.js';
import {fixtureBrowser} from './helpers.mjs';
let browser;before(async()=>{browser=await fixtureBrowser();});after(async()=>{await browser?.close();});
async function setup(t,html,engine){const page=await browser.newPage();await page.setContent(html);const core=new JevBrowser({page,engine});t.after(async()=>{await core.close();await page.close();});return {core,page};}

test('semantic optimization: complete source metadata is sent once per ready frontier',async t=>{
 const trace=[];const provider={async decide(r){trace.push(r);const answers={};for(const id of Object.keys(r.questions)){if(id.startsWith('source_')){const i=Number(id.slice(7));answers[id]={choice:r.state.page.sources.find(x=>x.text==='Actual '+i).id,confidence:0.99};}else answers[id]={choice:'equivalent',confidence:0.99};}return {answers,model:'fixture'};}};
 const {core}=await setup(t,'<dl>'+Array.from({length:12},(_,i)=>'<dt>Property '+i+'</dt><dd>Actual '+i+'</dd>').join('')+'</dl>',provider);
 const results=await core.compareSemanticBatch(Array.from({length:12},(_,i)=>({actual:{description:'Property '+i},expected:'Expected '+i})));
 assert.equal(trace.length,2);assert.equal(results[0].usage.serialDecisionDepth,2);
 const request=trace[0];const source=request.state.page.sources.find(x=>x.text==='Actual 0');
 assert.equal(JSON.stringify(request).split(source.context).length-1,1,'do not repeat full source context in every question');
 for(const q of Object.values(request.questions))for(const [id,c]of Object.entries(q.criteria))if(!id.startsWith('__'))assert.deepEqual(c,{sourceId:id});
});

test('semantic optimization: batch target discovery keeps multiple refs usable without another model call',async t=>{
 let calls=0;const provider={async decide(r){calls++;return {answers:Object.fromEntries(Object.entries(r.questions).map(([id,q])=>[id,{choice:Object.entries(q.criteria).find(([,v])=>v?.name===(id==='target_0'?'Archive':'Refund'))[0],confidence:0.99}])),model:'fixture'};}};
 const {core,page}=await setup(t,'<button onclick="document.body.dataset.archive=1">Archive</button><button onclick="document.body.dataset.refund=1">Refund</button>',provider);
 const targets=await core.locateSemanticBatch(['Archive control','Refund control']);assert.equal(targets.length,2);assert.equal(targets[0].snapshotId,targets[1].snapshotId);
 await core.native({command:'click',ref:targets[0].ref});await core.native({command:'click',ref:targets[1].ref});assert.equal(calls,1);assert.equal(await page.locator('body').getAttribute('data-refund'),'1');
});

test('semantic optimization: source and comparison model provenance both survive',async t=>{
 const provider={async decide(r){if(r.questions.source_0)return {answers:{source_0:{choice:r.state.page.sources.find(x=>x.text==='Pro annual').id,confidence:0.99}},model:'source-model'};return {answers:{compare_0:{choice:'equivalent',confidence:0.99}},model:'comparison-model'};}};
 const {core}=await setup(t,'<dl><dt>Plan</dt><dd>Pro annual</dd></dl>',provider);const result=await core.compareSemantic({actual:{description:'Current plan'},expected:'Professional annual subscription'});assert.deepEqual(result.models,['source-model','comparison-model']);assert.equal(result.model,undefined);
});
