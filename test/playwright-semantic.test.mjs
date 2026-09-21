import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {expect as playwrightExpect} from '@playwright/test';
import {JevBrowser} from '../dist/index.js';
import {fixtureBrowser} from './helpers.mjs';
let browser;before(async()=>{browser=await fixtureBrowser();});after(async()=>{await browser?.close();});
async function setup(t,choice='equivalent',confidence=0.95){let calls=0;const page=await browser.newPage();await page.setContent('<p id="plan">Pro annual</p>');const core=new JevBrowser({page,engine:{async decide(r){calls++;return {answers:Object.fromEntries(Object.keys(r.questions).map(id=>[id,{choice,confidence}]))};}}});t.after(async()=>{await core.close();await page.close();});const {semanticMatchers}=await import('../dist/playwright.js');return {page,core,expect:playwrightExpect.extend(semanticMatchers(core)),calls:()=>calls};}

test('Playwright semantic matcher: native Locator supports exact no-model comparison',async t=>{const a=await setup(t);await a.expect(a.page.locator('#plan')).toSemanticallyMatch('Pro annual');assert.equal(a.calls(),0);});

test('Playwright semantic matcher: a supported difference can pass .not',async t=>{const a=await setup(t,'different');await a.expect(a.page.locator('#plan')).not.toSemanticallyMatch('Free plan');assert.equal(a.calls(),1);});

for(const [choice,confidence] of [['equivalent',0.4],['insufficient_evidence',1]])test('Playwright semantic matcher: .not never turns '+choice+' inconclusive into success',async t=>{const a=await setup(t,choice,confidence);await assert.rejects(a.expect(a.page.locator('#plan')).not.toSemanticallyMatch('Free plan'),e=>e.code==='SEMANTIC_ASSERTION_INCONCLUSIVE');assert.equal(a.calls(),1);});

test('Playwright semantic matcher: mismatch prints source and comparison diagnostics',async t=>{const a=await setup(t,'different',0.93);await assert.rejects(a.expect(a.page.locator('#plan')).toSemanticallyMatch('Free plan'),e=>e.message.includes('Pro annual')&&e.message.includes('sourceConfidence')&&e.message.includes('0.93'));});
