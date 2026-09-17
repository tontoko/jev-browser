import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import * as sdk from '../dist/index.js';
import { fixtureBrowser, engine, select } from './helpers.mjs';
let browser;
before(async()=>{browser=await fixtureBrowser();});
after(async()=>{await browser?.close();});
async function fixture(t, html, decider=engine(()=> '__none__'), options={}) {
  const context=await browser.newContext();const page=await context.newPage();await page.setContent(html);
  const core=new sdk.JevBrowser({page,engine:decider,...options});
  t.after(async()=>{await core.close();await context.close();});return {page,core,decider};
}

test('observations use real accessible names and hide hidden nodes and input values',async t=>{
  const {core}=await fixture(t,'<label for="a">メール</label><input id="a" value="private@example.com"><button style="display:none">Hidden</button><button aria-labelledby="label"><span id="label">保存</span></button>');
  const snap=await core.snapshot();
  assert.ok(snap.elements.some(e=>e.name==='メール'));assert.ok(snap.elements.some(e=>e.name==='保存'));
  assert.ok(!snap.elements.some(e=>e.name==='Hidden'));assert.ok(!JSON.stringify(snap).includes('private@example.com'));
});
test('duplicate button names are distinguished by row context',async t=>{
  const decider=select(c=>c.kind==='click'&&c.target?.name==='変更'&&c.target.context.includes('田中'));
  const {core,page}=await fixture(t,'<table><tr><td>鈴木</td><td><button onclick="document.body.dataset.hit=\'suzuki\'">変更</button></td></tr><tr><td>田中</td><td><button onclick="document.body.dataset.hit=\'tanaka\'">変更</button></td></tr></table>',decider);
  const result=await core.act('田中さんの変更を開く');
  assert.equal(result.status,'executed');assert.equal(await page.locator('body').getAttribute('data-hit'),'tanaka');
});
test('named input bindings are executed locally, never sent to Jev',async t=>{
  const decider=select(c=>c.kind==='fill'&&c.valueKey==='password');
  const {core,page}=await fixture(t,'<label>パスワード<input type="password"></label>',decider);
  const result=await core.act('パスワードを入力',{values:{password:'TEST-SECRET-123'}});
  assert.equal(await page.locator('input').inputValue(),'TEST-SECRET-123');
  assert.ok(!JSON.stringify(decider.requests).includes('TEST-SECRET-123'));assert.ok(!JSON.stringify(result).includes('TEST-SECRET-123'));
});
test('observing does not mutate; the returned plan can be executed once',async t=>{
  const {core,page}=await fixture(t,'<button onclick="this.dataset.hit=Number(this.dataset.hit||0)+1">保存</button>',select(c=>c.kind==='click'));
  const plan=await core.observe('保存をクリック');assert.ok(plan);assert.equal(await page.locator('button').getAttribute('data-hit'),null);
  await core.act(plan);assert.equal(await page.locator('button').getAttribute('data-hit'),'1');
  await assert.rejects(core.act(plan),{code:'STALE_PLAN'});assert.equal(await page.locator('button').getAttribute('data-hit'),'1');
});
test('a serialized plan cannot smuggle a different operation',async t=>{
  const {core,page}=await fixture(t,'<button onclick="this.dataset.hit=\'yes\'">保存</button>',select(c=>c.kind==='click'));
  const plan=await core.observe('保存をクリック');
  await core.act({...plan,action:{kind:'fill',value:'injected'}});
  assert.equal(await page.locator('button').getAttribute('data-hit'),'yes');
});
test('changing a reused row makes its old action stale',async t=>{
  const {core,page}=await fixture(t,'<div role="row"><span id="name">田中</span><button onclick="this.dataset.hit=\'yes\'">削除</button></div>',select(c=>c.kind==='click'));
  const plan=await core.observe('田中さんの行を削除');await page.locator('#name').evaluate(e=>{e.textContent='鈴木';});
  await assert.rejects(core.act(plan),{code:'STALE_TARGET'});assert.equal(await page.locator('button').getAttribute('data-hit'),null);
});
test('a replaced node never retargets a stale plan to its replacement',async t=>{
  const {core,page}=await fixture(t,'<button>保存</button>',select(c=>c.kind==='click'));
  const plan=await core.observe('保存を押す');await page.locator('button').evaluate(e=>{e.outerHTML='<button>保存</button>';});
  await assert.rejects(core.act(plan),{code:'STALE_TARGET'});
});
test('no-match is explicit and executes nothing',async t=>{
  const {core,page}=await fixture(t,'<button onclick="this.dataset.hit=\'yes\'">保存</button>');
  assert.equal(await core.observe('存在しない削除ボタン'),null);
  await assert.rejects(core.act('存在しない削除ボタン'),{code:'NO_MATCH'});assert.equal(await page.locator('button').getAttribute('data-hit'),null);
});
test('closing a borrowed Page does not close its page or browser',async t=>{
  const {core,page}=await fixture(t,'<p>OK</p>');await core.close();assert.equal(page.isClosed(),false);assert.equal(browser.isConnected(),true);
  await assert.rejects(core.snapshot(),{code:'CLOSED'});
});
test('open shadow roots and iframe controls are observed',async t=>{
  const {core,page}=await fixture(t,'<div id="host"></div><iframe srcdoc="<button>フレーム保存</button>"></iframe>');
  await page.locator('#host').evaluate(e=>{e.attachShadow({mode:'open'}).innerHTML='<button>Shadow save</button>';});
  await page.frameLocator('iframe').getByRole('button').waitFor();
  const snap=await core.snapshot();assert.ok(snap.elements.some(e=>e.name==='Shadow save'));assert.ok(snap.elements.some(e=>e.name==='フレーム保存'));
});
test('policy callback blocks an operation independently of AI confidence',async t=>{
  const {core,page}=await fixture(t,'<button onclick="this.dataset.hit=\'yes\'">購入</button>',select(c=>c.kind==='click'),{allowAction:()=>false});
  await assert.rejects(core.act('購入'),{code:'ACTION_DENIED'});assert.equal(await page.locator('button').getAttribute('data-hit'),null);
});
test('candidate overflow is reported rather than silently dropping targets',async t=>{
  const {core}=await fixture(t,'<button>one</button><button>two</button>',select(c=>c.kind==='click'),{maxElements:1});
  const snap=await core.snapshot();assert.equal(snap.truncated,true);
  await assert.rejects(core.act('two'),{code:'OBSERVATION_LIMIT'});
});
test('a missing named value is not invented from a model response',async t=>{
  const {core,page}=await fixture(t,'<label>メール<input></label>');
  await assert.rejects(core.act('メールを入力'),{code:'NO_MATCH'});assert.equal(await page.locator('input').inputValue(),'');
});
test('select and checkbox use deterministic Playwright operations',async t=>{
  const {core,page,decider}=await fixture(t,'<label>Plan<select><option value="free">無料</option><option value="pro">有料</option></select></label><label>同意<input type="checkbox"></label>',select(c=>c.kind==='select'&&c.option?.label==='有料'));
  await core.act('有料プランを選ぶ');assert.equal(await page.locator('select').inputValue(),'pro');
  decider.decide=select(c=>c.kind==='check').decide;
  await core.act('同意する');assert.equal(await page.locator('input').isChecked(),true);
});
test('schema extraction copies observed values and returns their evidence',async t=>{
  const decider=engine((q,request,name)=>c=>c&&typeof c==='object'&&c.value===(name==='f0'?'Invoice A':12800));
  const {core}=await fixture(t,'<h1>Invoice A</h1><p>¥12,800</p>',decider);
  const result=await core.extract('請求書の名前と合計',z.object({title:z.string(),total:z.number()}));
  assert.deepEqual(result.data,{title:'Invoice A',total:12800});assert.equal(result.evidence.total.text,'¥12,800');assert.equal(result.evidence.title.text,'Invoice A');
});
test('missing required extraction fields fail, nullable fields become null',async t=>{
  const {core}=await fixture(t,'<h1>Invoice A</h1>');
  await assert.rejects(core.extract('値',z.object({amount:z.number()})),{code:'EXTRACTION_MISSING'});
  const result=await core.extract('値',z.object({amount:z.number().nullable()}));assert.equal(result.data.amount,null);
});
test('unsupported date extraction schemas are refused explicitly',async t=>{
  const {core}=await fixture(t,'<p>A</p>');
  await assert.rejects(core.extract('値',z.object({date:z.date()})),{code:'UNSUPPORTED_SCHEMA'});
});
test('an invented extraction source cannot return fabricated data',async t=>{
  const {core}=await fixture(t,'<p>A</p>',engine(()=> 'invented'));
  await assert.rejects(core.extract('値',z.object({name:z.string()})),{code:'INVALID_DECISION'});
});
test('bounded run completes only when the deterministic check succeeds',async t=>{
  const {core,page}=await fixture(t,'<button onclick="document.body.dataset.done=\'yes\'">保存</button>',engine((q,r,n)=>n.startsWith('effect_')?'commit':c=>c?.kind==='click'));
  const result=await core.run('保存する',{maxSteps:3,until:async page=>(await page.locator('body').getAttribute('data-done'))==='yes'});
  assert.equal(result.status,'complete');assert.equal(result.reason,'verified');assert.equal(result.steps.length,1);assert.equal(await page.locator('body').getAttribute('data-done'),'yes');
});
test('model-complete without a deterministic oracle remains unverified',async t=>{
  const {core}=await fixture(t,'<p>Maybe done</p>',engine(()=> '__done__'));
  const result=await core.run('完了まで進める',{maxSteps:2});assert.equal(result.status,'unverified');assert.equal(result.reason,'model-complete');
});
test('step budget bounds repeated actions without a custom retry scheduler',async t=>{
  const {core,page}=await fixture(t,'<button onclick="this.dataset.n=Number(this.dataset.n||0)+1">次へ</button>',engine((q,r,n)=>n.startsWith('effect_')?'advance':c=>c?.kind==='click'));
  const result=await core.run('進める',{maxSteps:2});assert.equal(result.status,'stopped');assert.equal(result.reason,'step-limit');assert.equal(await page.locator('button').getAttribute('data-n'),'2');
});
test('concurrent operations on one core are rejected, not interleaved',async t=>{
  let release;const blocker=new Promise(r=>{release=r;});let started;const start=new Promise(r=>{started=r;});
  const decider=engine(async()=>{started();await blocker;return '__none__';});
  const {core}=await fixture(t,'<button>保存</button>',decider);
  const first=core.observe('保存');await start;await assert.rejects(core.snapshot(),{code:'BUSY'});release();await first;
});

test('decision state contains the observed controls and explicitly available bindings',async t=>{
  const decider=select(c=>c.kind==='fill');
  const {core}=await fixture(t,'<label>メールアドレス<input type="email"></label>',decider);
  await core.observe('emailの値を入力',{values:{email:'kept-local@example.invalid'}});
  const state=decider.requests[0].state;
  assert.ok(state.page.elements.some(e=>e.name==='メールアドレス'));
  assert.deepEqual(state.inputs,[{key:'email',available:true}]);
  assert.ok(!JSON.stringify(state).includes('kept-local@example.invalid'));
});
test('definition lists retain local label/value context and heading roles',async t=>{
  const {core}=await fixture(t,'<h1>請求書</h1><dl><dt>小計</dt><dd>¥10,000</dd><dt>合計</dt><dd>¥11,000</dd></dl>');
  const snap=await core.snapshot();
  assert.equal(snap.texts.find(s=>s.text==='請求書').role,'heading');
  assert.equal(snap.texts.find(s=>s.text==='¥10,000').context,'小計 ¥10,000');
  assert.equal(snap.texts.find(s=>s.text==='¥11,000').context,'合計 ¥11,000');
});
test('extraction presents observed sources in state, not only hypothetical answer criteria',async t=>{
  const decider=engine(()=>c=>c&&typeof c==='object'&&c.value==='Invoice A');
  const {core}=await fixture(t,'<h1>Invoice A</h1>',decider);
  await core.extract('title',z.object({title:z.string()}));
  assert.ok(decider.requests[0].state.sources.some(s=>s.text==='Invoice A'&&s.role==='heading'));
});

test('native Playwright expect asserts outcomes on the same borrowed Page',async t=>{
  const {expect}=await import('@playwright/test');
  const {core,page}=await fixture(t,'<button onclick="document.querySelector(\'h1\').textContent=\'保存済み\'">保存</button><h1>未保存</h1>',select(c=>c.kind==='click'));
  await core.act('保存する');
  await expect(page.getByRole('heading')).toHaveText('保存済み');
});
test('cancellation after a pending decision prevents all execution',async t=>{
  const abort=new AbortController();let started;const ready=new Promise(r=>{started=r;});
  const decider=engine(async()=>{started();await new Promise(resolve=>abort.signal.addEventListener('abort',resolve,{once:true}));return c=>c&&c.kind==='click';});
  const {core,page}=await fixture(t,'<button onclick="this.dataset.hit=\'yes\'">保存</button>',decider);
  const request=core.act('保存',{signal:abort.signal});await ready;abort.abort();
  await assert.rejects(request);assert.equal(await page.locator('button').getAttribute('data-hit'),null);
});
test('failed Playwright action consumes its plan and is never automatically retried',async t=>{
  const {core,page}=await fixture(t,'<button>保存</button>',select(c=>c.kind==='click'),{timeoutMs:250});
  const plan=await core.observe('保存');await page.locator('button').evaluate(el=>{el.disabled=true;});
  await assert.rejects(core.act(plan),{code:'STALE_TARGET'});
  await page.locator('button').evaluate(el=>{el.disabled=false;});
  await assert.rejects(core.act(plan),{code:'STALE_PLAN'});
});
test('grounded actions execute in shadow roots and child frames',async t=>{
  const decider=select(c=>c.kind==='click'&&c.target.name==='Shadow save');
  const {core,page}=await fixture(t,'<div id="host"></div><iframe srcdoc="<button>Frame save</button>"></iframe>',decider);
  await page.frameLocator('iframe').getByRole('button').evaluate(el=>el.addEventListener('click',()=>{el.textContent='Frame saved';}));
  await page.locator('#host').evaluate(el=>{el.attachShadow({mode:'open'}).innerHTML='<button onclick="this.textContent=\'Shadow saved\'">Shadow save</button>';});
  await page.frameLocator('iframe').getByRole('button').waitFor();
  await core.act('Shadow save');assert.equal(await page.locator('#host').getByRole('button').textContent(),'Shadow saved');
  decider.decide=select(c=>c.kind==='click'&&c.target.name==='Frame save').decide;
  await core.act('Frame save');assert.equal(await page.frameLocator('iframe').getByRole('button').textContent(),'Frame saved');
});
test('readonly textboxes never become fill candidates',async t=>{
  const decider=engine(()=> '__none__');
  const {core}=await fixture(t,'<label>Account<input readonly value="123"></label>',decider);
  const snapshot=await core.snapshot();assert.equal(snapshot.elements[0].readOnly,true);
  await core.observe('accountを入力',{values:{account:'456'}});
  const candidates=Object.values(decider.requests[0]?.questions.action.criteria??{});
  assert.ok(!candidates.some(c=>c&&c.kind==='fill'));
});
test('a current checkbox value is extractable and schema-checked as boolean',async t=>{
  const {core}=await fixture(t,'<label>同意<input type="checkbox" checked></label>',engine(()=>c=>c&&c.value===true));
  const result=await core.extract('同意チェックの状態',z.object({agreed:z.boolean()}));
  assert.equal(result.data.agreed,true);assert.equal(result.evidence.agreed.role,'checkbox');
});

test('select targets the observed option even when multiple options share a value',async t=>{
  const {core,page}=await fixture(t,'<label>Plan<select><option value="same">無料</option><option value="same">有料</option></select></label>',select(c=>c.kind==='select'&&c.option.label==='有料'));
  await core.act('有料を選ぶ');
  assert.equal(await page.locator('select').evaluate(el=>el.selectedIndex),1);
});
test('native number and date fields expose executable fill candidates',async t=>{
  const decider=select(c=>c.kind==='fill'&&c.valueKey==='amount');
  const {core,page}=await fixture(t,'<label>Amount<input type="number"></label><label>Date<input type="date"></label>',decider);
  await core.act('amountをAmountに入力',{values:{amount:'42'}});
  assert.equal(await page.locator('input[type=number]').inputValue(),'42');
  decider.decide=select(c=>c.kind==='fill'&&c.target.name==='Date'&&c.valueKey==='date').decide;
  await core.act('dateをDateに入力',{values:{date:'2027-02-03'}});
  assert.equal(await page.locator('input[type=date]').inputValue(),'2027-02-03');
});
