import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { JevBrowser } from '../dist/index.js';
import { fixtureBrowser, engine, select } from './helpers.mjs';
let browser;
before(async()=>{browser=await fixtureBrowser();});
after(async()=>{await browser?.close();});
async function fixture(t,html,decider=engine(()=> '__none__')){
 const page=await browser.newPage();await page.setContent(html);const core=new JevBrowser({page,engine:decider});
 t.after(async()=>{await core.close();await page.close();});return {page,core,decider};
}
const selected=p=>p.locator('select').evaluate(e=>[...e.selectedOptions].map(o=>o.value));
test('multi-select addition preserves the original selection',async t=>{
 const {page,core}=await fixture(t,'<label>Courses<select multiple><option selected value=a>Existing</option><option value=b>New</option></select></label>',select(c=>c.kind==='select'&&c.option?.label==='New'));
 await core.act('Add New');assert.deepEqual(await selected(page),['a','b']);
});
test('multi-select removal preserves other selections',async t=>{
 const {page,core}=await fixture(t,'<select multiple aria-label=Courses><option selected value=a>Keep</option><option selected value=b>Remove</option></select>',select(c=>c.kind==='deselect'&&c.option?.label==='Remove'));
 await core.act('Remove only Remove');assert.deepEqual(await selected(page),['a']);
});
test('multi-select can remove its last selection',async t=>{
 const {page,core}=await fixture(t,'<select multiple aria-label=Courses><option selected value=a>Only</option></select>',select(c=>c.kind==='deselect'));
 await core.act('Deselect Only');assert.deepEqual(await selected(page),[]);
});
test('selected disabled option is not silently removed',async t=>{
 const {page,core}=await fixture(t,'<select multiple aria-label=Courses><option selected disabled value=a>Locked</option><option value=b>New</option></select>',select(c=>c.kind==='select'));
 assert.equal(await core.observe('Add New'),null);assert.deepEqual(await selected(page),['a']);
});
test('multi-select drift rejects stale actions',async t=>{
 const {page,core}=await fixture(t,'<select multiple aria-label=Courses><option selected value=a>A</option><option value=b>B</option><option value=c>C</option></select>',select(c=>c.kind==='select'&&c.option?.label==='B'));
 const plan=await core.observe('Add B');await page.locator('select').evaluate(e=>{e.options[2].selected=true;});
 await assert.rejects(core.act(plan),{code:'STALE_TARGET'});assert.deepEqual(await selected(page),['a','c']);
});
test('multi-select options retain distinct identities with duplicated values',async t=>{
 const {page,core}=await fixture(t,'<select multiple aria-label=Courses><option selected value=same>A</option><option value=same>B</option></select>',select(c=>c.kind==='select'&&c.option?.label==='B'));
 await core.act('Add B');assert.deepEqual(await page.locator('select').evaluate(e=>[...e.options].map(o=>o.selected)),[true,true]);
});
test('native indeterminate state remains mixed',async t=>{
 const {page,core}=await fixture(t,'<label>All<input type=checkbox></label>');await page.locator('input').evaluate(e=>{e.checked=true;e.indeterminate=true;});
 const s=await core.snapshot();assert.equal(s.elements[0].checked,'mixed');assert.equal(s.texts.find(e=>e.role==='checkbox').value,undefined);
});
for(const state of ['mixed',''])test(`ARIA ${state||'missing'} state cannot invent false`,async t=>{
 const {core}=await fixture(t,`<button role=checkbox ${state?'aria-checked='+state:''} aria-label=All>All</button>`);
 const r=await core.extract('Checked state',z.object({checked:z.boolean().nullable()}));assert.deepEqual(r.data,{checked:null});assert.deepEqual(r.evidence,{});
});
test('input-button uses ARIA rather than native checked bit',async t=>{
 const {core}=await fixture(t,'<input type=button role=checkbox aria-checked=true aria-label=All value=All>');assert.equal((await core.snapshot()).elements[0].checked,true);
});
test('document scroll ignores the pointer over a nested panel',async t=>{
 const {core,page}=await fixture(t,'<div id=panel style="position:fixed;width:200px;height:250px;overflow:auto"><div style="height:3000px">Panel</div></div><main style="margin-left:250px;height:4000px">Page</main>',select(c=>c.kind==='scroll'&&c.direction==='down'));
 await page.mouse.move(50,100);await core.act('Scroll page down');const r=await page.evaluate(()=>({page:scrollY,panel:document.getElementById('panel').scrollTop}));assert.ok(r.page>0);assert.equal(r.panel,0);
});
test('unsafe integers cannot be returned rounded',async t=>{
 const {core}=await fixture(t,'<p>9007199254740993</p>',engine(()=>c=>typeof c?.value==='number'));
 await assert.rejects(core.extract('Exact integer',z.object({amount:z.number()})),{code:'EXTRACTION_MISSING'});
});
test('unsafe integers remain exact as text',async t=>{
 const {core}=await fixture(t,'<p>9007199254740993</p>',engine(()=>c=>c?.value==='9007199254740993'));
 assert.equal((await core.extract('Exact integer',z.object({amount:z.string()}))).data.amount,'9007199254740993');
});
test('Unicode minus sign is preserved',async t=>{
 const {core}=await fixture(t,'<p>−1,000円</p>',engine(()=>c=>c?.value===-1000));const r=await core.extract('Amount',z.object({amount:z.number()}));assert.equal(r.data.amount,-1000);assert.equal(r.evidence.amount.text,'−1,000円');
});
for(const terminal of ['__done__','__none__'])test(`completion during ${terminal} decision is verified`,async t=>{
 let page;const f=await fixture(t,'<p>Pending</p><button>Save</button>',engine(async(q,r,n)=>{if(n.startsWith('effect_'))return 'commit';await page.locator('p').evaluate(e=>{e.textContent='Done';});return terminal;}));page=f.page;
 const r=await f.core.run('Save',{until:async p=>(await p.locator('p').textContent())==='Done'});assert.equal(r.status,'complete');assert.equal(r.reason,'verified');assert.deepEqual(r.steps,[]);
});
