// Explicit opt-in: real Jev, 20 synthetic fixture families x 5 deterministic layout/data variants.
// This is a regression matrix, not a benchmark of arbitrary third-party sites.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {fixtureBrowser} from './helpers.mjs';
import {goalFixture} from './goal-fixture.mjs';
let browser;
before(async()=>{assert.ok(process.env.JEV_API_KEY||process.env.TYPESAFE_API_KEY,'Set a Jev key for this opt-in matrix.');browser=await fixtureBrowser();});
after(async()=>{await browser?.close();});
const families=['basic','reordered','prefilled','nested-people','japanese','native-select','multi-select','checked-true','checked-false','delayed-form','late-ready','reset-input','dependent-select','confirmation-field','save-dialog','shadow-form','iframe-form','unrelated-form','many-fields','protocol-words'];
const count=Number(process.env.JEV_MATRIX_CASES??100);
assert.ok(Number.isInteger(count)&&count>=1&&count<=100);
function scenario(kind,seed){
  let values={name:`Fixture Person ${seed}`,email:`person-${seed}@example.invalid`};
  let fields=[{path:'/name',label:'Name'},{path:'/email',label:'Email',type:'email'}];
  let expected={'/name':values.name,'/email':values.email};
  const options={live:true};
  if(kind===2)fields=fields.map(field=>({...field,value:field.type==='email'?'old@example.invalid':'Previous value'}));
  if(kind===3){values={student:{name:`Student ${seed}`,email:`student-${seed}@example.invalid`},guardian:{name:`Guardian ${seed}`,email:`guardian-${seed}@example.invalid`}};fields=[{path:'/student/name',label:'Student name'},{path:'/guardian/name',label:'Guardian name'},{path:'/student/email',label:'Student email',type:'email'},{path:'/guardian/email',label:'Guardian email',type:'email'}];expected={'/student/name':values.student.name,'/student/email':values.student.email,'/guardian/name':values.guardian.name,'/guardian/email':values.guardian.email};}
  if(kind===4){fields[0].label='氏名';fields[1].label='メールアドレス';values.name=`検証用の受講者 ${seed}`;expected['/name']=values.name;}
  if(kind===5){fields.push({path:'/course',label:'Instrument',type:'select',options:['Choose','Piano','Viola da gamba']});values.course='Viola da gamba';expected['/course']=values.course;}
  if(kind===6){fields.push({path:'/genres',label:'Music genres',type:'select',multiple:true,options:['Classical','Baroque','Jazz']});values.genres=['Classical','Baroque'];expected['/genres']=['Classical','Baroque'];}
  if(kind===7||kind===8){fields.push({path:'/newsletter',label:'Newsletter subscription',type:'checkbox',required:false,checked:kind===8});values.newsletter=kind===7;if(kind===7)expected['/newsletter']='on';}
  if(kind===9)options.delayMs=250+(seed%5)*50;
  if(kind===11)values={email:values.email,name:values.name};
  if(kind===12){fields.push({path:'/country',label:'Country',type:'select',options:['Choose','Japan']},{path:'/region',label:'Region',type:'select',options:['Choose']});values.country='Japan';values.region='Kanazawa';expected['/country']='Japan';expected['/region']='Kanazawa';}
  if(kind===13){fields.push({path:'/emailConfirmation',label:'Confirm email',type:'email'});expected['/emailConfirmation']=values.email;}
  if(kind===18){fields=Array.from({length:16},(_,i)=>({path:`/field${i}`,label:`Field ${i}`}));values=Object.fromEntries(fields.map((_,i)=>[`field${i}`,`value-${seed}-${i}`]));expected=Object.fromEntries(fields.map((field,i)=>[field.path,values[`field${i}`]]));}
  if(kind===19){fields=[{path:'/name',label:'name'},{path:'/state',label:'state'},{path:'/operation',label:'operation'}];values={name:'name',state:'complete',operation:'click'};expected={'/name':'name','/state':'complete','/operation':'click'};}
  // Rotate/reverse the DOM without changing the caller's data or expected server state.
  const shift=seed%fields.length;fields=[...fields.slice(shift),...fields.slice(0,shift)];if(seed%2)fields.reverse();
  return {fields,values,expected,options};
}
async function prepare(kind,page){
  if(![10,11,12,14,15,16,17].includes(kind))return;
  await page.locator('#add').click();await page.locator('form').waitFor();
  if(kind===10)await page.locator('input[name="/email"]').evaluate(input=>input.addEventListener('input',()=>{input.form.setAttribute('aria-busy','true');setTimeout(()=>input.form?.removeAttribute('aria-busy'),200);},{once:true}));
  if(kind===11)await page.locator('input[name="/name"]').evaluate(input=>input.addEventListener('input',()=>{input.form.elements.namedItem('/email').value='';},{once:true}));
  if(kind===12)await page.locator('select[name="/country"]').evaluate(select=>select.addEventListener('change',()=>{select.form.elements.namedItem('/region').innerHTML='<option>Choose</option><option>Kanazawa</option>';},{once:true}));
  if(kind===14)await page.getByRole('button',{name:'Save'}).evaluate(button=>{button.onclick=()=>confirm('Save this contact?');});
  if(kind===15)await page.locator('form').evaluate(form=>{const host=document.createElement('div');form.before(host);host.attachShadow({mode:'open'}).append(form);});
  if(kind===16)await page.locator('form').evaluate(async form=>{const frame=document.createElement('iframe');frame.style.height='400px';const ready=new Promise(resolve=>frame.onload=resolve);frame.src='about:blank';form.before(frame);await ready;frame.contentDocument.body.append(form);});
  if(kind===17)await page.locator('form').evaluate(form=>form.insertAdjacentHTML('beforebegin','<form aria-label="Search"><label>Search<input name="query" required></label><button>Search</button></form>'));
}
test(`LIVE goal matrix: ${count} independently checked creation tasks`,{concurrency:3,timeout:300000},async t=>{
  await Promise.all(Array.from({length:count},(_,index)=>t.test(`${families[index%20]} / variant ${Math.floor(index/20)+1}`,{timeout:60000},async t=>{
    const kind=index%20,seed=index+1;const spec=scenario(kind,seed);
    const {core,page,records,attempts}=await goalFixture(t,browser,spec.fields,spec.options);
    await prepare(kind,page);const start=performance.now();
    const instruction=kind===4?'新規登録フォームを開く必要があれば開き、渡したすべての情報を入力して保存してください。':
      'Create one new record. Open Add if the form is not open yet, fill every supplied field, and Save. Re-enter an email confirmation if required. Accept only an ordinary confirmation of this save. Match any supplied select values and checkbox states. Verify the created record.';
    let result;
    try{result=await core.run(instruction,{values:spec.values,timeoutMs:45000,maxDecisions:12});}
    catch(error){console.log(JSON.stringify({case:families[kind],seed,error:error.code,partial:error.partial}));throw error;}
    console.log(JSON.stringify({case:families[kind],seed,status:result.status,reason:result.reason,steps:result.steps.length,usage:result.usage,totalMs:Math.round(performance.now()-start),submissions:attempts.length}));
    assert.equal(result.status,'complete',JSON.stringify(result));
    assert.equal(attempts.length,1);assert.equal(records.length,1);
    assert.deepEqual(records[0],spec.expected);
    assert.ok(result.inputs.every(input=>input.applied));
    assert.equal(result.effects.filter(effect=>effect.kind==='commit').length,1);
  })));
});
