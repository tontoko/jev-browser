import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {fixtureBrowser} from './helpers.mjs';
import {wizardFixture} from './wizard-fixture.mjs';
let browser;before(async()=>{browser=await fixtureBrowser();});after(async()=>{await browser?.close();});
test('goal wizard: retain input coverage after Next unmounts the previous step',async t=>{
 const {core,records,attempts}=await wizardFixture(t,browser);
 const result=await core.run('Fill contact name and email across the steps, then Save the new contact',{values:{name:'Wizard Contact',email:'wizard@example.invalid'},settleTimeoutMs:500});
 assert.equal(result.status,'complete',JSON.stringify({reason:result.reason,inputs:result.inputs}));
 assert.equal(attempts.length,1);assert.deepEqual(records,[{'/name':'Wizard Contact','/email':'wizard@example.invalid'}]);
 assert.ok(result.inputs.every(input=>input.applied&&input.readback));
});
