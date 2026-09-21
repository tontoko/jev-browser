import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {JevBrowser} from '../dist/index.js';
import {extractGrounded} from '../dist/extract.js';
import {fixtureBrowser} from './helpers.mjs';
let browser;
before(async()=>{browser=await fixtureBrowser();});
after(async()=>{await browser?.close();});

for(const [actual,expected,choice] of [
  ['10²','102','different'],
  ['10²','one hundred','equivalent'],
  ['H₂O','H2O','equivalent'],
  ['Ⅳ','IV','equivalent'],
  ['ＡＢ','AB','equivalent'],
  ['line  one','line one','different'],
]) test(`semantic meaning: ${actual} / ${expected} is judged from unmodified evidence`,async t=>{
  const page=await browser.newPage();await page.setContent('<pre id="value"></pre>');
  await page.locator('#value').evaluate((node,text)=>{node.textContent=text;},actual);
  const calls=[];
  const engine={async decide(request){
    calls.push(request);
    assert.ok(request.questions.compare_0.instructions.includes(JSON.stringify(actual)));
    assert.ok(request.questions.compare_0.instructions.includes(JSON.stringify(expected)));
    return {answers:{compare_0:{choice,confidence:0.93}},model:'meaning-fixture'};
  }};
  const core=new JevBrowser({page,engine});t.after(async()=>{await core.close();await page.close();});
  const result=await core.compareSemantic({actual:{locator:page.locator('#value')},expected,minConfidence:0.8});
  assert.equal(calls.length,1,'do not turn compatibility folding into semantic truth');
  assert.equal(result.source,'semantic');assert.equal(result.confidence,0.93);
  assert.equal(result.status,choice==='equivalent'?'passed':'failed');
  assert.equal(result.evidence.text,actual);
});

test('semantic meaning: actual literal equality still needs no comparison model',async t=>{
  const page=await browser.newPage();await page.setContent('<p>10²</p>');
  const core=new JevBrowser({page,engine:{async decide(){assert.fail('literal comparison does not need inference');}}});
  t.after(async()=>{await core.close();await page.close();});
  const result=await core.assertSemantic({actual:{locator:page.locator('p')},expected:'10²'});
  assert.equal(result.source,'deterministic');assert.equal(result.freshness,'verified');
  assert.equal(result.usage.requests,0);
});

for(const text of ['10²','2₃','Ⅳ','①']) test(`numeric copy: ${text} cannot invent a normalized number`,async()=>{
  const snapshot={id:'fixture',url:'https://example.invalid/',title:'',elements:[],texts:[{id:'source',frame:0,role:'paragraph',text,context:text}],truncatedTexts:false};
  let calls=0;
  const engine={async decide(){calls++;return {answers:{f0:{choice:'s0',confidence:1}}};}};
  await assert.rejects(extractGrounded(snapshot,'Copy the displayed numeric value',z.object({value:z.number()}),()=>engine,new AbortController().signal,250),{code:'EXTRACTION_MISSING'});
  assert.equal(calls,0,'no compatible numeric copy exists; an equation solver is not an extraction primitive');
  const raw=await extractGrounded(snapshot,'Copy the displayed notation',z.object({value:z.string()}),()=>engine,new AbortController().signal,250);
  assert.equal(raw.data.value,text);
});
