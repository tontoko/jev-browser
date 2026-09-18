import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {fixtureBrowser} from './helpers.mjs';
import {modernFixture,fieldOrder} from './modern-fixture.mjs';
let browser;before(async()=>{browser=await fixtureBrowser();});after(async()=>{await browser?.close();});
const values={student:{fullName:'Synthetic Learner',contactEmail:'synthetic@example.invalid'},instrument:'Viola da gamba'};
const instruction='Create one new learner, fill all supplied information, select the supplied lesson instrument and save. Verify the created learner.';
for(const widget of ['portal','inline','editable','search'])test(`modern controls: ${widget} combobox commits a choice instead of only typing search text`,async t=>{
 const f=await modernFixture(t,browser,{widget,delayMs:widget==='search'?200:0});
 const result=await f.core.run(instruction,{values});
 assert.equal(result.status,'complete',JSON.stringify(result));assert.equal(f.attempts.length,1);
 assert.deepEqual(f.records,[{fullName:values.student.fullName,email:values.student.contactEmail,instrument:'gamba'}]);
 assert.ok(result.inputs.every(input=>input.applied&&input.readback));
 assert.ok(!JSON.stringify(f.decider.requests).includes(values.student.contactEmail));
});
test('modern controls: a different popup with the same option text is never selected',async t=>{
 const f=await modernFixture(t,browser,{noise:true});const result=await f.core.run(instruction,{values});
 assert.equal(result.status,'complete');assert.equal(await f.page.evaluate(()=>window.decoyClicked===true),false);assert.equal(f.attempts.length,1);
});
test('modern controls: two matching options in the owned popup are ambiguous',async t=>{
 const f=await modernFixture(t,browser,{duplicate:true});
 await assert.rejects(f.core.run(instruction,{values,settleTimeoutMs:200}),{code:'AMBIGUOUS_SELECTION'});
 assert.equal(f.attempts.length,0);assert.equal(await f.page.evaluate(()=>window.optionClicks??0),0);
});
test('modern controls: an unassociated popup is not guessed from global text',async t=>{
 const f=await modernFixture(t,browser,{association:false,noise:true});
 const result=await f.core.run(instruction,{values,settleTimeoutMs:100}).catch(error=>error.partial);
 assert.notEqual(result?.status,'complete');assert.equal(f.attempts.length,0);assert.equal(await f.page.evaluate(()=>window.decoyClicked===true),false);
});
test('modern controls: disabled options never become a successful binding',async t=>{
 const f=await modernFixture(t,browser,{disabled:true});
 const result=await f.core.run(instruction,{values,settleTimeoutMs:100}).catch(error=>error.partial);
 assert.notEqual(result?.status,'complete');assert.equal(f.attempts.length,0);assert.equal(await f.page.evaluate(()=>window.optionClicks??0),0);
});
test('modern controls: option click authorization is not bypassed by the widget helper',async t=>{
 const f=await modernFixture(t,browser,{browserOptions:{allowCommand:command=>!(command.command==='click'&&command.element==='Viola da gamba')}});
 await assert.rejects(f.core.run(instruction,{values}),{code:'ACTION_DENIED'});assert.equal(f.attempts.length,0);
});
test('modern controls: an option that closes without changing the selected value fails before Save',async t=>{
 const f=await modernFixture(t,browser,{ignoreSelection:true});
 const result=await f.core.run(instruction,{values,settleTimeoutMs:100}).catch(error=>error.partial);
 assert.notEqual(result?.status,'complete');assert.equal(f.attempts.length,0);
});
test('modern fixture: names and result labels do not expose caller paths and permutations differ',async t=>{
 const f=await modernFixture(t,browser);
 assert.ok(!f.html.includes('student/fullName')&&!f.html.includes('student.contactEmail'));
 assert.equal(new Set(Array.from({length:6},(_,i)=>JSON.stringify(fieldOrder(i)))).size,6);
 await f.page.getByRole('button',{name:'New learner',exact:true}).click();
 const names=await f.page.locator('[name]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('name')));
 assert.ok(names.every(name=>/^u[0-9a-f]+[abc]$/.test(name)));
});

test('modern controls: cancellation while suggestions load cannot produce a late click',async t=>{
 const abort=new AbortController();let timer;
 const f=await modernFixture(t,browser,{widget:'editable',delayMs:350,browserOptions:{allowAction:plan=>{if(plan.action.target?.role==='combobox')timer=setTimeout(()=>abort.abort(),50);return true;}}});
 t.after(()=>clearTimeout(timer));
 await assert.rejects(f.core.run(instruction,{values,signal:abort.signal}));
 await f.page.getByRole('option',{name:'Viola da gamba',exact:true}).waitFor();
 assert.equal(await f.page.evaluate(()=>window.optionClicks??0),0);assert.equal(f.attempts.length,0);
});
test('modern controls: widget substeps honor the same overall step budget',async t=>{
 const f=await modernFixture(t,browser);const result=await f.core.run(instruction,{values,maxSteps:4});
 assert.equal(result.reason,'step-limit');assert.equal(result.steps.length,4);assert.equal(f.attempts.length,0);
});
test('modern controls: changing the control popup during option authorization prevents selection',async t=>{
 let page;
 const f=await modernFixture(t,browser,{browserOptions:{allowCommand:async command=>{
   if(command.command==='click'&&command.element==='Viola da gamba')await page.getByRole('combobox').evaluate(el=>el.setAttribute('aria-controls','different-popup'));
   return true;
 }}});page=f.page;
 const result=await f.core.run(instruction,{values,settleTimeoutMs:100}).catch(error=>error.partial);
 assert.notEqual(result?.status,'complete');assert.equal(await page.evaluate(()=>window.optionClicks??0),0);assert.equal(f.attempts.length,0);
});

test('modern controls: prefilled query text is not evidence of a committed selection',async t=>{
 const f=await modernFixture(t,browser,{widget:'editable'});
 await f.page.getByRole('button',{name:'New learner',exact:true}).click();
 await f.page.getByRole('combobox').evaluate(el=>{el.value='Viola da gamba';});
 const result=await f.core.run(instruction,{values});
 assert.equal(result.status,'complete');assert.equal(f.attempts.length,1);assert.equal(f.records[0].instrument,'gamba');
 assert.equal(await f.page.evaluate(()=>window.optionClicks),1);
});
test('modern controls: aria-controls may be declared only when the popup opens',async t=>{
 const f=await modernFixture(t,browser);
 await f.page.getByRole('button',{name:'New learner',exact:true}).click();
 await f.page.getByRole('combobox').evaluate(el=>{
   const controls=el.getAttribute('aria-controls');el.removeAttribute('aria-controls');
   el.addEventListener('click',()=>el.setAttribute('aria-controls',controls),{once:true});
 });
 const result=await f.core.run(instruction,{values});
 assert.equal(result.status,'complete');assert.equal(f.attempts.length,1);assert.equal(f.records[0].instrument,'gamba');
});
test('modern controls: supplied data is not skipped by an already true caller predicate',async t=>{
 const f=await modernFixture(t,browser);
 const result=await f.core.run(instruction,{values,until:()=>true});
 assert.ok(result.inputs.every(input=>input.applied));
 assert.equal(result.verification.source,'caller');
 assert.ok(result.steps.length>0); // The caller's true predicate controls completion, not an implied save oracle.
});

test('modern controls: an explicit false completion oracle cannot be replaced by inferred UI success',async t=>{
 const f=await modernFixture(t,browser);
 const result=await f.core.run(instruction,{values,until:()=>false,settleTimeoutMs:100});
 assert.notEqual(result.status,'complete');assert.equal(f.attempts.length,1);
});
