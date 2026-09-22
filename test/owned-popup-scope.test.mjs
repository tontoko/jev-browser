import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {fixtureBrowser} from './helpers.mjs';
import {modernFixture} from './modern-fixture.mjs';
let browser;before(async()=>{browser=await fixtureBrowser();});after(async()=>{await browser?.close();});
for(const move of [false,true])test(`owned popup: control ${move?'leaves':'stays in'} original caller scope during option approval`,async t=>{
 let page;
 const app=await modernFixture(t,browser,{browserOptions:{allowCommand:async command=>{
   if(move&&command.command==='click'&&command.element==='Viola da gamba')await page.evaluate(()=>{const outside=document.createElement('aside');document.body.append(outside);outside.append(document.querySelector('form'));});
   return true;
 }}});page=app.page;await page.getByRole('button',{name:'New learner',exact:true}).click();
 let result,error;try{result=await app.core.run('Fill supplied learner details, select instrument and create the learner once.',{scope:'#editor',values:{student:{fullName:'Synthetic Learner',contactEmail:'synthetic@example.invalid'},instrument:'Viola da gamba'},settleTimeoutMs:150});}catch(e){error=e;}
 if(move){assert.equal(await page.evaluate(()=>window.optionClicks||0),0);assert.equal(app.attempts.length,0);assert.notEqual(result?.status,'complete');assert.equal(error?.code,'STALE_TARGET');}
 else{assert.equal(app.attempts.length,1);assert.equal(await page.evaluate(()=>window.optionClicks),1);}
});
