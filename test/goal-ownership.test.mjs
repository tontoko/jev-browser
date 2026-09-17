import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {JevBrowser} from '../dist/index.js';
import {fixtureBrowser} from './helpers.mjs';
import {formEngine} from './goal-fixture.mjs';
let browser;before(async()=>{browser=await fixtureBrowser();});after(async()=>{await browser?.close();});
test('goal ownership: two separate shadow forms cannot be mistaken for the same native form',async t=>{
 const page=await browser.newPage();await page.setContent('<div id="one"></div><div id="two"></div>');
 await page.locator('#one').evaluate(host=>{host.attachShadow({mode:'open'}).innerHTML='<form><label>Email<input name="/email"></label><button type="button">Save</button></form>';});
 await page.locator('#two').evaluate(host=>{host.attachShadow({mode:'open'}).innerHTML='<form><label>Name<input name="/name"></label><button type="button">Save</button></form>';});
 const core=new JevBrowser({page,engine:formEngine()});t.after(async()=>{await core.close();await page.close();});
 const result=await core.run('Fill the supplied contact and save',{values:{email:'ownership@example.invalid',name:'Second Person'},settleTimeoutMs:100});
 assert.equal(result.reason,'ambiguous');
 assert.equal(await page.locator('#one input').inputValue(),'');assert.equal(await page.locator('#two input').inputValue(),'');
});
