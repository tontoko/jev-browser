import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {fixtureBrowser} from './helpers.mjs';
import {selectionFixture} from './selection-fixture.mjs';
let browser;before(async()=>{browser=await fixtureBrowser();});after(async()=>{await browser?.close();});
for(const preselected of [false,true])test(`decision dependency: a pre-resolution action cannot overwrite the resolved input (${preselected?'already selected':'new selection'})`,async t=>{
 const app=await selectionFixture(t,browser,{choice:'option_2',resultCountry:'DE'});
 if(preselected)await app.page.locator('select').selectOption('DE');
 await app.page.evaluate(()=>{window.selectedCountries=[];document.querySelector('select').addEventListener('change',e=>window.selectedCountries.push(e.target.value));});
 const decide=app.decider.decide.bind(app.decider);
 app.decider.decide=async(r,o)=>{
   const result=await decide(r,o);
   if(r.questions.action&&r.state.inputs.some(input=>input.path==='/country'&&!input.applied)){
     const stale=Object.entries(r.questions.action.criteria).find(([,action])=>action?.kind==='select'&&action.option?.label==='日本');
     if(stale){result.answers.action={choice:stale[0],confidence:0.95};result.answers['effect_'+stale[0]]={choice:'advance',confidence:0.95};}
   }
   return result;
 };
 const result=await app.core.run('Use the supplied country and private note, then Save once.',{values:{country:'Germany',note:'synthetic-state-change'},semanticInputs:{'/country':0.8},maxSteps:8,maxDecisions:16,settleTimeoutMs:100});
 assert.equal(result.status,'complete',JSON.stringify(result));assert.equal(app.submissions.length,1);assert.equal(app.submissions[0].a9,'DE');
 assert.ok(!(await app.page.evaluate(()=>window.selectedCountries)).includes('JP'),'The obsolete predicted action must not undo the resolved field.');
 assert.ok(app.decider.requests.some(r=>r.questions.action&&r.state.inputs.some(input=>input.path==='/country'&&input.applied)));
});
