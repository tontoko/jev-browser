import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {fixtureBrowser,select} from './helpers.mjs';
import {JevBrowser} from '../dist/index.js';
import {goalFixture,formEngine} from './goal-fixture.mjs';
let browser;
before(async()=>{browser=await fixtureBrowser();});
after(async()=>{await browser?.close();});
const email={path:'/email',label:'Email',type:'email'};
function decisions({dialog='accept',reuse=false}={}){
  const base=formEngine();
  return {async decide(request,options){
    const result=await base.decide(request,options);
    for(const key of Object.keys(request.questions)){
      if(key==='dialog')result.answers[key]={choice:dialog,confidence:1};
      if(key.startsWith('reuse_')&&reuse)result.answers[key]={choice:'/email',confidence:1};
    }
    return result;
  }};
}
async function opened(t,fields=[email],options={}){
  const f=await goalFixture(t,browser,fields,options);
  await f.page.locator('#add').click();await f.page.locator('form').waitFor();return f;
}
test('goal controls: an authorized save confirmation is handled within the same run',async t=>{
  const {core,page,records,attempts}=await opened(t,[email],{engine:decisions()});
  await page.getByRole('button',{name:'Save'}).evaluate(el=>{el.onclick=()=>confirm('Save this contact?');});
  const result=await core.run('Fill the supplied email and save the contact. Confirm the ordinary save prompt.',{values:{email:'confirmed@example.invalid'}});
  assert.equal(result.status,'complete',JSON.stringify(result));assert.equal(attempts.length,1);
  assert.equal(records[0]['/email'],'confirmed@example.invalid');
  assert.ok(result.steps.some(step=>step.plan.action.kind==='dialog'));
});
test('goal controls: an additional-charge confirmation is not accepted',async t=>{
  const {core,page,attempts}=await opened(t,[email],{engine:decisions({dialog:'stop'})});
  await page.getByRole('button',{name:'Save'}).evaluate(el=>{el.onclick=()=>confirm('Also charge the account and send an invitation?');});
  const result=await core.run('Save the contact only. Do not charge or invite.',{values:{email:'no-charge@example.invalid'}});
  assert.equal(result.status,'stopped');assert.equal(result.reason,'permission-required');assert.equal(attempts.length,0);
});
test('goal controls: native authorization still applies to a proposed dialog response',async t=>{
  const {core,page,attempts}=await opened(t,[email],{engine:decisions(),browserOptions:{allowCommand:command=>command.command!=='handle_dialog'}});
  await page.getByRole('button',{name:'Save'}).evaluate(el=>{el.onclick=()=>confirm('Save this contact?');});
  await assert.rejects(core.run('Save the supplied contact.',{values:{email:'policy@example.invalid'}}),error=>error.code==='ACTION_DENIED'&&error.partial.effects.some(effect=>effect.kind==='commit'&&effect.status==='unknown'));
  assert.equal(attempts.length,0);
});
test('goal controls: a required email confirmation reuses its supplied input without another caller turn',async t=>{
  const {core,records,attempts}=await opened(t,[email,{path:'/emailConfirmation',label:'Re-enter email',type:'email'}],{engine:decisions({reuse:true})});
  const result=await core.run('Enter the email, confirm it and Save.',{values:{email:'matching@example.invalid'}});
  assert.equal(result.status,'complete',JSON.stringify(result));assert.equal(attempts.length,1);
  assert.equal(records[0]['/email'],'matching@example.invalid');assert.equal(records[0]['/emailConfirmation'],'matching@example.invalid');
  assert.deepEqual(result.inputs.map(input=>input.path),['/email']);
});
test('goal controls: an unrelated missing required field is not synthesized from other data',async t=>{
  const {core,attempts}=await opened(t,[email,{path:'/phone',label:'Phone'}]);
  const result=await core.run('Fill supplied data and Save.',{values:{email:'no-phone@example.invalid'},settleTimeoutMs:100});
  assert.equal(result.status,'stopped');assert.equal(result.reason,'missing-input');assert.equal(attempts.length,0);
});
test('goal controls: an explicit ARIA validation error prevents the commit',async t=>{
  const {core,page,attempts}=await opened(t);
  await page.locator('input').evaluate(el=>{el.setAttribute('aria-invalid','true');el.insertAdjacentHTML('afterend','<span role="alert">Address is already in use</span>');});
  const result=await core.run('Fill the supplied email and Save.',{values:{email:'invalid@example.invalid'}});
  assert.equal(result.status,'stopped');assert.equal(result.reason,'validation');assert.equal(attempts.length,0);
});
test('goal controls: a visibly busy form is not edited until it becomes ready',async t=>{
  const {core,page,attempts}=await opened(t);
  await page.locator('form').evaluate(form=>{
    form.setAttribute('aria-busy','true');window.prematureWrites=0;
    form.addEventListener('input',()=>{if(form.getAttribute('aria-busy')==='true')window.prematureWrites++;});
    setTimeout(()=>form.removeAttribute('aria-busy'),350);
  });
  const result=await core.run('Fill email and Save.',{values:{email:'ready@example.invalid'}});
  assert.equal(result.status,'complete');assert.equal(attempts.length,1);
  assert.equal(await page.evaluate(()=>window.prematureWrites),0);
});
test('goal controls: an observed menu exposes a native hover operation to AI',async t=>{
  const page=await browser.newPage();await page.setContent('<button aria-haspopup="menu" onmouseenter="document.body.dataset.open=1">Contacts</button>');
  const core=new JevBrowser({page,engine:select(candidate=>candidate.kind==='hover')});
  t.after(async()=>{await core.close();await page.close();});
  await core.act('Hover the Contacts menu.');assert.equal(await page.locator('body').getAttribute('data-open'),'1');
});

test('goal controls: pending validation triggered by input settles before saving',async t=>{
  const {core,page,attempts}=await opened(t);
  await page.locator('input').evaluate(input=>input.addEventListener('input',()=>{
    input.form.setAttribute('aria-busy','true');
    setTimeout(()=>{input.setAttribute('aria-invalid','true');input.form?.removeAttribute('aria-busy');},250);
  },{once:true}));
  const result=await core.run('Fill the email and Save.',{values:{email:'async-rejected@example.invalid'}});
  assert.equal(result.status,'stopped');assert.equal(result.reason,'validation');assert.equal(attempts.length,0);
});
test('goal controls: a dialog replaced during authorization is never accepted',async t=>{
  let currentDialog,page,replacement;
  const f=await opened(t,[email],{engine:decisions(),browserOptions:{allowCommand:async command=>{
    if(command.command==='handle_dialog'){
      await currentDialog.dismiss();
      const ready=page.waitForEvent('dialog');
      replacement=page.evaluate(()=>confirm('Authorize an additional charge?')).catch(()=>undefined);
      await ready;
    }
    return true;
  }}});page=f.page;
  page.on('dialog',dialog=>{currentDialog=dialog;});
  await page.getByRole('button',{name:'Save'}).evaluate(el=>{el.onclick=()=>confirm('Save this contact?');});
  t.after(async()=>{await replacement;});
  await assert.rejects(f.core.run('Save this contact only.',{values:{email:'stale-dialog@example.invalid'}}),{code:'STALE_DIALOG'});
  assert.equal(f.attempts.length,0);
});
test('goal controls: an incorrect prefilled confirmation is replaced with the supplied value',async t=>{
  const {core,records,attempts}=await opened(t,[email,{path:'/emailConfirmation',label:'Confirm email',type:'email',value:'old@example.invalid'}],{engine:decisions({reuse:true})});
  const result=await core.run('Enter the email, confirm it and Save.',{values:{email:'new-confirmation@example.invalid'}});
  assert.equal(result.status,'complete');assert.equal(attempts.length,1);
  assert.equal(records[0]['/emailConfirmation'],'new-confirmation@example.invalid');
});

test('goal controls: pending primary validation blocks confirmation-field writes too',async t=>{
  const {core,page,attempts}=await opened(t,[email,{path:'/emailConfirmation',label:'Confirm email',type:'email'}],{engine:decisions({reuse:true})});
  await page.locator('input[name="/email"]').evaluate(input=>input.addEventListener('input',()=>{
    input.form.setAttribute('aria-busy','true');
    setTimeout(()=>{input.setAttribute('aria-invalid','true');input.form?.removeAttribute('aria-busy');},250);
  },{once:true}));
  const result=await core.run('Enter the email, confirm it and Save.',{values:{email:'invalid-confirmation@example.invalid'}});
  assert.equal(result.reason,'validation');assert.equal(attempts.length,0);
  assert.equal(await page.locator('input[name="/emailConfirmation"]').inputValue(),'');
});
