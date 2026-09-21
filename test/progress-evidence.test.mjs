import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {JevBrowser} from '../dist/index.js';
import {capture} from '../dist/observation.js';
import {waitForRelevantChange} from '../dist/completion.js';
import {fixtureBrowser,engine} from './helpers.mjs';
let browser;
before(async()=>{browser=await fixtureBrowser();});
after(async()=>{await browser?.close();});
const limits={maxElements:250,maxTexts:1000};

for(const markup of ['<p id="status">Pending</p>','<span id="status">Pending</span>','<dl><dt>State</dt><dd id="status">Pending</dd></dl>','<output id="status">Pending</output>']){
  test('progress observes the same visible evidence: '+markup,async t=>{
    const page=await browser.newPage();t.after(()=>page.close());await page.setContent(markup);
    const observed=await capture(page,limits);t.after(()=>observed.dispose());
    assert.ok(observed.data.texts.some(source=>source.text==='Pending'));
    await page.locator('#status').evaluate(node=>node.textContent='Saved');
    assert.equal(await waitForRelevantChange(page,observed,250,new AbortController().signal),true);
  });
}
test('progress includes observed open-shadow text',async t=>{
  const page=await browser.newPage();t.after(()=>page.close());await page.setContent('<div id="host"></div>');
  await page.locator('#host').evaluate(node=>node.attachShadow({mode:'open'}).innerHTML='<p id="state">Pending</p>');
  const observed=await capture(page,limits);t.after(()=>observed.dispose());
  assert.ok(observed.data.texts.some(source=>source.text==='Pending'));
  await page.locator('#state').evaluate(node=>node.textContent='Saved');
  assert.equal(await waitForRelevantChange(page,observed,250,new AbortController().signal),true);
});
test('progress excludes hidden text changes just like observation',async t=>{
  const page=await browser.newPage();t.after(()=>page.close());await page.setContent('<p hidden id="hidden">Pending</p><p>Visible</p>');
  const observed=await capture(page,limits);t.after(()=>observed.dispose());
  await page.locator('#hidden').evaluate(node=>node.textContent='Saved');
  assert.equal(await waitForRelevantChange(page,observed,120,new AbortController().signal),false);
});
const saveEngine=()=>engine((_q,_request,name)=>name.startsWith('effect_')?'commit':name==='action'?candidate=>candidate?.kind==='click'&&candidate.target?.name==='Save':'__none__');
for(const role of ['', ' role="status"'])test('goal waits for caller evidence regardless of status role: '+(role||'plain'),async t=>{
  const page=await browser.newPage();await page.setContent(`<button onclick="window.saves=(window.saves||0)+1;setTimeout(()=>document.querySelector('p').textContent='Saved',180)">Save</button><p id="result"${role}>Pending</p>`);
  const decider=saveEngine(),core=new JevBrowser({page,engine:decider});t.after(async()=>{await core.close();await page.close();});
  const result=await core.run('Save once, then verify the status.',{settleTimeoutMs:650,timeoutMs:6000,until:async page=>(await page.locator('#result').textContent())==='Saved'});
  assert.equal(result.status,'complete',JSON.stringify(result));assert.equal(result.verification.source,'caller');
  assert.equal(await page.evaluate(()=>window.saves),1);assert.equal(decider.requests.length,1);
});
test('caller oracle is rechecked after a quiet wait before condition-unmet',async t=>{
  const page=await browser.newPage();await page.setContent('<button onclick="window.saves=(window.saves||0)+1;setTimeout(()=>window.saved=true,180)">Save</button>');
  const core=new JevBrowser({page,engine:saveEngine()});t.after(async()=>{await core.close();await page.close();});
  const result=await core.run('Save once.',{settleTimeoutMs:650,timeoutMs:6000,until:page=>page.evaluate(()=>window.saved===true)});
  assert.equal(result.status,'complete',JSON.stringify(result));assert.equal(await page.evaluate(()=>window.saves),1);
});

test('progress includes observed native checked state',async t=>{
  const page=await browser.newPage();t.after(()=>page.close());await page.setContent('<label>Enabled<input type="checkbox"></label>');
  const observed=await capture(page,limits);t.after(()=>observed.dispose());
  await page.locator('input').evaluate(node=>node.checked=true);
  assert.equal(await waitForRelevantChange(page,observed,250,new AbortController().signal),true);
});
test('progress includes observed link destinations',async t=>{
  const page=await browser.newPage();t.after(()=>page.close());await page.setContent('<a href="https://example.invalid/pending">Result</a>');
  const observed=await capture(page,limits);t.after(()=>observed.dispose());
  await page.locator('a').evaluate(node=>node.href='https://example.invalid/saved');
  assert.equal(await waitForRelevantChange(page,observed,250,new AbortController().signal),true);
});
