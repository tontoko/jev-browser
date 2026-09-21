import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {JevBrowser} from '../dist/index.js';
import {fixtureBrowser} from './helpers.mjs';
let browser;
before(async()=>{browser=await fixtureBrowser();});after(async()=>{await browser?.close();});
async function setup(t,html,engine){const page=await browser.newPage();await page.setContent(html);const core=new JevBrowser({page,engine});t.after(async()=>{await core.close();await page.close();});return {core,page};}
const forbidden={async decide(){throw new Error('Exact caller Locator must not use the provider');}};

test('semantic Locator: explicit text is exact, local and revalidated',async t=>{const {core,page}=await setup(t,'<p id="plan">Pro annual</p>',forbidden);const r=await core.assertSemantic({actual:{locator:page.locator('#plan'),property:'text'},expected:'Pro annual'});assert.equal(r.status,'passed');assert.equal(r.freshness,'verified');assert.equal(r.usage.requests,0);});

test('semantic Locator: value, checked and named attribute are explicit properties',async t=>{
 const {core,page}=await setup(t,'<input id="email" value="local@example.invalid"><input id="opt" type="checkbox" checked><a id="link" href="/invoice">Invoice</a>',forbidden);
 const results=await core.assertSemanticBatch([{actual:{locator:page.locator('#email'),property:'value'},expected:'local@example.invalid'},{actual:{locator:page.locator('#opt'),property:'checked'},expected:'true'},{actual:{locator:page.locator('#link'),property:'attribute',attribute:'href'},expected:'/invoice'}]);
 assert.ok(results.every(r=>r.status==='passed'&&r.usage.requests===0));assert.equal(results[1].evidence.value,true);
});

test('semantic Locator: duplicates are not silently reduced to the first result',async t=>{const {core,page}=await setup(t,'<p>A</p><p>A</p>',forbidden);await assert.rejects(core.assertSemantic({actual:{locator:page.locator('p')},expected:'A'}),{code:'SEMANTIC_AMBIGUOUS'});});

test('semantic Locator: other Page and caller-scope escape fail before inference',async t=>{const {core,page}=await setup(t,'<section id="allowed"><p>A</p></section><p id="outside">A</p>',forbidden);const other=await browser.newPage();t.after(()=>other.close());await other.setContent('<p>A</p>');await assert.rejects(core.assertSemantic({actual:{locator:other.locator('p')},expected:'A'}),{code:'INVALID_ARGUMENT'});await assert.rejects(core.assertSemantic({actual:{locator:page.locator('#outside')},expected:'A'},{scope:'#allowed'}),{code:'SEMANTIC_NO_MATCH'});});

test('semantic Locator: named property is validated and hidden values stay absent',async t=>{const {core,page}=await setup(t,'<p id="visible">A</p><p hidden id="hidden">A</p>',forbidden);for(const actual of [{locator:page.locator('#visible'),property:'attribute'},{locator:page.locator('#visible'),property:'value'},{locator:page.locator('#visible'),property:'script'}])await assert.rejects(core.assertSemantic({actual,expected:'A'}),{code:'INVALID_ARGUMENT'});await assert.rejects(core.assertSemantic({actual:{locator:page.locator('#hidden')},expected:'A'}),{code:'SEMANTIC_NO_MATCH'});});

test('semantic Locator: pending element is resolved by Playwright without a model',async t=>{const {core,page}=await setup(t,'<main></main>',forbidden);await page.evaluate(()=>setTimeout(()=>{const p=document.createElement('p');p.id='late';p.textContent='Ready';document.querySelector('main').append(p);},100));const r=await core.assertSemantic({actual:{locator:page.locator('#late')},expected:'Ready'},{timeoutMs:5000});assert.equal(r.status,'passed');});

test('semantic Locator: iframe and open shadow DOM use native locator resolution',async t=>{const {core,page}=await setup(t,'<iframe id="f"></iframe><div id="host"></div>',forbidden);await page.locator('#f').evaluate(f=>f.contentDocument.body.innerHTML='<p>Frame ready</p>');await page.locator('#host').evaluate(el=>el.attachShadow({mode:'open'}).innerHTML='<p>Shadow ready</p>');const r=await core.assertSemanticBatch([{actual:{locator:page.frameLocator('#f').locator('p')},expected:'Frame ready'},{actual:{locator:page.locator('#host p')},expected:'Shadow ready'}]);assert.ok(r.every(x=>x.freshness==='verified'));});

test('semantic Locator: in-flight property change is inconclusive, not a stale pass',async t=>{let page,calls=0;const provider={async decide(r){calls++;await page.locator('#state').evaluate(el=>el.textContent='Cancelled');return {answers:Object.fromEntries(Object.keys(r.questions).map(id=>[id,{choice:'equivalent',confidence:0.99}])),model:'fixture'};}};const app=await setup(t,'<p id="state">Pro annual</p>',provider);page=app.page;await assert.rejects(app.core.assertSemantic({actual:{locator:page.locator('#state')},expected:'Professional annual plan'}),e=>e.semantic?.results[0].freshness==='changed'&&e.semantic.results[0].currentEvidence?.text==='Cancelled');assert.equal(calls,1);});

test('semantic Locator: caller Locator tolerates identical rerender while a captured ref does not',async t=>{let page;const provider={async decide(r){await page.locator('#state').evaluate(el=>{const next=el.cloneNode(true);el.replaceWith(next);});return {answers:Object.fromEntries(Object.keys(r.questions).map(id=>[id,{choice:'equivalent',confidence:0.99}]))};}};const app=await setup(t,'<p id="state">Pro annual</p>',provider);page=app.page;assert.equal((await app.core.assertSemantic({actual:{locator:page.locator('#state')},expected:'Professional annual plan'})).freshness,'verified');});

test('semantic Locator: cancellation during a wait does not start provider work',async t=>{const {core,page}=await setup(t,'<main></main>',forbidden);const signal=AbortSignal.timeout(50);await assert.rejects(core.assertSemantic({actual:{locator:page.locator('#absent')},expected:'A'},{signal,timeoutMs:5000}),()=>signal.aborted);});

test('semantic Locator: metrics include local Locator observation, not only model discovery',async t=>{const {core,page}=await setup(t,'<p>Ready</p>',forbidden);const result=await core.assertSemantic({actual:{locator:page.locator('p')},expected:'Ready'});assert.ok(result.usage.observationMs>0);assert.equal(result.usage.requests,0);});
