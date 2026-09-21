// Opt-in, real configured Jev endpoint. Synthetic evidence and independent local oracles only.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {JevBrowser,JevDecisionEngine} from '../dist/index.js';
import {extractStructured} from '../dist/structured.js';
import {fixtureBrowser} from './helpers.mjs';
let browser;
before(async()=>{assert.ok(process.env.JEV_API_KEY||process.env.TYPESAFE_API_KEY,'Set a key for explicit real-provider tests.');browser=await fixtureBrowser();});
after(async()=>{await browser?.close();});

for(const [label,actual,expected,truth] of [
  ['Mathematical expression','10²','102','different'],
  ['Mathematical expression','10²','one hundred','equivalent'],
  ['Chemical formula for water','H₂O','H2O','equivalent'],
  ['Account code','ＡＢ','AB','equivalent'],
])test(`LIVE semantic-first: ${actual} vs ${expected}`,async t=>{
  const page=await browser.newPage();await page.setContent('<dl><dt></dt><dd id="actual"></dd></dl>');
  await page.locator('dt').evaluate((el,value)=>{el.textContent=value;},label);
  await page.locator('#actual').evaluate((el,value)=>{el.textContent=value;},actual);
  const provider=new JevDecisionEngine();let calls=0;
  const core=new JevBrowser({page,engine:{async decide(r,o){calls++;return provider.decide(r,o);}}});
  t.after(async()=>{await core.close();await page.close();});
  const result=await core.compareSemantic({actual:{locator:page.locator('#actual')},expected,minConfidence:0.8});
  console.log(JSON.stringify({case:'semantic-first',actual,expected,truth,status:result.status,choice:result.choice,confidence:result.confidence,source:result.source,models:result.models,calls,usage:result.usage}));
  assert.equal(calls,1);assert.equal(result.source,'semantic');assert.equal(result.evidence.text,actual);
  assert.equal(result.choice,truth);
  assert.equal(result.status,result.confidence>=0.8?(truth==='equivalent'?'passed':'failed'):'inconclusive');
});

test('LIVE semantic-first: large extraction overlaps independent provider chunks',async()=>{
  const texts=[],records=[],count=40;
  for(let i=0;i<count;i++){
    const context=`Account ${i} Credits ${i+10}`;
    texts.push({id:`n${i}`,frame:0,text:`Account ${i}`,context,role:'cell'},{id:`a${i}`,frame:0,text:String(i+10),context,role:'cell'});
    records.push({id:`r${i}`,frame:0,context,textIds:[`n${i}`,`a${i}`],readOnly:true});
  }
  const snapshot={id:'rows',url:'https://fixture.example.invalid/',title:'Accounts',elements:[],texts,records,truncated:false,truncatedElements:false,truncatedTexts:false,scroll:{y:0,maxY:0,height:720}};
  const provider=new JevDecisionEngine();let active=0,peak=0;const timeline=[],start=performance.now();
  const engine={async decide(request,options){
    const entry={questions:Object.keys(request.questions).length,startMs:Math.round(performance.now()-start)};
    timeline.push(entry);active++;peak=Math.max(peak,active);
    try{const response=await provider.decide(request,options);entry.model=response.model;return response;}
    finally{active--;entry.endMs=Math.round(performance.now()-start);}
  }};
  const result=await extractStructured(snapshot,'Read every account name and credits. Do not omit accounts.',z.array(z.object({name:z.string().describe('Account name'),credits:z.number().describe('Credits')})),()=>engine,AbortSignal.timeout(60000),250);
  console.log(JSON.stringify({case:'parallel-extraction',rows:count,peakConcurrent:peak,providerRequests:timeline.length,timeline,totalMs:Math.round(performance.now()-start)}));
  assert.deepEqual(result.data,Array.from({length:count},(_,i)=>({name:`Account ${i}`,credits:i+10})));
  assert.equal(peak,2);assert.deepEqual(timeline.map(x=>x.questions),[40,64,16]);
});
