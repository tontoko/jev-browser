// Explicit opt-in live test. Only synthetic local fixture data is sent to Jev.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { z } from 'zod';
import { JevBrowser } from '../dist/index.js';

let browser;
before(async()=>{
  assert.ok(process.env.JEV_API_KEY || process.env.TYPESAFE_API_KEY, 'A Jev API key is required for explicit live tests.');
  browser=await chromium.launch({headless:true});
});
after(async()=>{await browser?.close();});
async function fixture(t,html){
  const page=await browser.newPage();await page.setContent(html);
  const core=new JevBrowser({page,timeoutMs:60000});
  t.after(async()=>{await core.close();await page.close();});
  return {page,core};
}
function report(name,result,start){
  const decision=result.plan?.decision??result.decision;
  console.log(JSON.stringify({case:name,model:decision?.model,usage:decision?.usage,decisionMs:decision?.elapsedMs,totalMs:Math.round(performance.now()-start)}));
}
test('LIVE: Jev distinguishes identical Japanese buttons by their row',async t=>{
  const {core,page}=await fixture(t,'<table><tr><td>鈴木</td><td><button onclick="document.body.dataset.hit=\'suzuki\'">変更</button></td></tr><tr><td>田中</td><td><button onclick="document.body.dataset.hit=\'tanaka\'">変更</button></td></tr></table>');
  const start=performance.now();const result=await core.act('田中さんの行にある「変更」ボタンをクリックしてください。');
  assert.equal(await page.locator('body').getAttribute('data-hit'),'tanaka');report('duplicate-ja',result,start);
});
test('LIVE: explicit email binding is filled without model-generated input',async t=>{
  const {core,page}=await fixture(t,'<label>メールアドレス<input type="email"></label><label>表示名<input></label>');
  const start=performance.now();const result=await core.act('メールアドレス欄にemailの値を入力してください。',{values:{email:'jev-fixture@example.invalid'}});
  assert.equal(await page.locator('input[type=email]').inputValue(),'jev-fixture@example.invalid');report('fill-ja',result,start);
});
test('LIVE: Jev extracts a grounded title and amount, not invented values',async t=>{
  const {core}=await fixture(t,'<h1>請求書 INV-042</h1><dl><dt>小計</dt><dd>¥10,000</dd><dt>合計</dt><dd>¥11,000</dd></dl>');
  const start=performance.now();const result=await core.extract('請求書の見出しと、税込の合計金額を取得してください。',z.object({title:z.string().describe('請求書の見出し全文'),total:z.number().describe('小計ではなく合計金額')}));
  assert.equal(result.data.title,'請求書 INV-042');assert.equal(result.data.total,11000);report('extract-ja',result,start);
});
test('LIVE: absent action produces no-match rather than a guessed click',async t=>{
  const {core,page}=await fixture(t,'<h1>編集</h1><button onclick="document.body.dataset.hit=\'yes\'">保存</button>');
  const start=performance.now();const plan=await core.observe('「アカウントを完全削除」ボタンをクリックしてください。保存ボタンではありません。');
  assert.equal(plan,null);assert.equal(await page.locator('body').getAttribute('data-hit'),null);report('no-match',{},start);
});
test('LIVE: multi-step fill/save run finishes through a deterministic oracle',async t=>{
  const {core,page}=await fixture(t,'<label>メールアドレス<input type="email"></label><button onclick="if(document.querySelector(\'input\').value)document.getElementById(\'status\').textContent=\'保存済み\'">保存</button><p id="status">未保存</p>');
  const start=performance.now();const result=await core.run('emailの値をメールアドレス欄に入力し、保存ボタンを押して保存済みにしてください。',{
    values:{email:'jev-run@example.invalid'},maxSteps:4,until:async page=>(await page.locator('#status').textContent())==='保存済み',
  });
  assert.equal(result.status,'complete');assert.equal(result.reason,'verified');assert.equal(await page.locator('input').inputValue(),'jev-run@example.invalid');
  console.log(JSON.stringify({case:'run-ja',steps:result.steps.length,totalMs:Math.round(performance.now()-start),decisions:result.steps.map(s=>s.plan.decision)}));
});
