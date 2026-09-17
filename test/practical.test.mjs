import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { JevBrowser } from '../dist/index.js';
import { fixtureBrowser, engine, select } from './helpers.mjs';
let browser;
before(async()=>{browser=await fixtureBrowser();});
after(async()=>{await browser?.close();});
async function fixture(t,html,options={}){
  const page=await browser.newPage();await page.setContent(html);
  const core=new JevBrowser({page,engine:engine(()=> '__none__'),...options});
  t.after(async()=>{await core.close();await page.close();});return {page,core};
}
test('native details summary can be opened through a grounded action',async t=>{
  const {page,core}=await fixture(t,'<details><summary>詳細設定</summary><button>更新</button></details>',{engine:select(c=>c.kind==='click'&&c.target.name==='詳細設定')});
  await core.act('詳細設定を開く');
  assert.equal(await page.locator('details').evaluate(el=>el.open),true);
});
test('inert background controls are not offered as interactive targets',async t=>{
  const {core}=await fixture(t,'<div inert><button>背景の削除</button></div><button>使用可能</button>');
  const snapshot=await core.snapshot();
  assert.deepEqual(snapshot.elements.map(e=>e.name),['使用可能']);
});
test('inert host excludes controls within its open shadow root',async t=>{
  const {page,core}=await fixture(t,'<div id="host" inert></div><button>使用可能</button>');
  await page.locator('#host').evaluate(el=>{el.attachShadow({mode:'open'}).innerHTML='<button>無効な内部ボタン</button>';});
  assert.deepEqual((await core.snapshot()).elements.map(e=>e.name),['使用可能']);
});
test('rich text descendants do not become duplicate fill targets',async t=>{
  const {core}=await fixture(t,'<div role="textbox" aria-label="メモ" contenteditable="true"><p><span>既存の</span><b>メモ</b></p></div>');
  const snapshot=await core.snapshot();
  assert.equal(snapshot.elements.filter(e=>e.fillable).length,1);
  assert.equal(snapshot.elements.find(e=>e.fillable).name,'メモ');
});
test('CSS scope finds an editor inside an open shadow root',async t=>{
  const {page,core}=await fixture(t,'<div id="host"></div>',{engine:select(c=>c.kind==='fill')});
  await page.locator('#host').evaluate(el=>{el.attachShadow({mode:'open'}).innerHTML='<label id="editor">メモ<input></label>';});
  await core.act('メモにnoteを入力',{scope:'#editor',values:{note:'scoped value'}});
  assert.equal(await page.locator('#editor input').inputValue(),'scoped value');
});
test('until receives the shared cancellation signal and remaining budget',async t=>{
  const {core}=await fixture(t,'<p>Done</p>',{timeoutMs:1200});
  let seen;
  const result=await core.run('Verify',{until:async(page,operation)=>{seen=operation;return true;}});
  assert.equal(result.status,'complete');
  assert.ok(seen?.signal instanceof AbortSignal);
  assert.ok(seen.timeoutMs>0&&seen.timeoutMs<=1200);
});
test('allowAction receives the same bounded operation context',async t=>{
  let seen;
  const {page,core}=await fixture(t,'<button onclick="this.dataset.hit=1">Save</button>',{
    engine:select(c=>c.kind==='click'),timeoutMs:1200,
    allowAction:async(plan,operation)=>{seen=operation;return true;},
  });
  await core.act('Save');
  assert.equal(await page.locator('button').getAttribute('data-hit'),'1');
  assert.ok(seen?.signal instanceof AbortSignal);
  assert.ok(seen.timeoutMs>0&&seen.timeoutMs<=1200);
});
test('an SDK completion wait can honor the core timeout without a separate timer',async t=>{
  const {core}=await fixture(t,'<p>Pending</p>',{timeoutMs:100});
  let seen;
  await assert.rejects(core.run('Verify',{until:async(page,operation)=>{
    seen=operation;
    assert.ok(operation?.signal instanceof AbortSignal);
    await delay(10000,undefined,{signal:operation.signal});
    return true;
  }}));
  assert.equal(seen?.signal.aborted,true);
});
