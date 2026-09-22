import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {fixtureBrowser} from './helpers.mjs';
import {capture,verifyCapturedTarget} from '../dist/observation.js';
import {waitForRelevantChange} from '../dist/completion.js';
let browser;before(async()=>{browser=await fixtureBrowser();});after(async()=>{await browser?.close();});
test('capture ownership: temporary caller handles can be disposed after capture',async t=>{
 const page=await browser.newPage();t.after(()=>page.close());await page.setContent('<main><button>Save</button><p>Pending</p></main>');
 const root=await page.locator('main').elementHandle();const observed=await capture(page,{maxElements:20,maxTexts:20,selection:{frame:page.mainFrame(),roots:[root]}});t.after(()=>observed.dispose());await root.dispose();
 const ref=[...observed.refs.values()].find(ref=>ref.info.name==='Save');await verifyCapturedTarget(page,observed,ref);
 const next=await observed.reread();try{assert.ok(next.data.texts.some(x=>x.text==='Pending'));}finally{await next.dispose();}
 assert.equal(await waitForRelevantChange(page,observed,120,new AbortController().signal),false);
 await page.locator('p').evaluate(el=>el.textContent='Saved');assert.equal(await waitForRelevantChange(page,observed,180,new AbortController().signal),true);
});
test('capture ownership: owned handle does not make a removed DOM root valid',async t=>{
 const page=await browser.newPage();t.after(()=>page.close());await page.setContent('<main><button>Save</button></main>');const root=await page.locator('main').elementHandle();const observed=await capture(page,{maxElements:20,maxTexts:20,selection:{frame:page.mainFrame(),roots:[root]}});t.after(()=>observed.dispose());await root.dispose();
 await page.locator('main').evaluate(el=>el.remove());await assert.rejects(verifyCapturedTarget(page,observed,[...observed.refs.values()][0]),{code:'STALE_TARGET'});
});
