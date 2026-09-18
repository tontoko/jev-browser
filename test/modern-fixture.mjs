import {randomBytes} from 'node:crypto';
import {JevBrowser,JevDecisionEngine} from '../dist/index.js';
import {engine,httpServer} from './helpers.mjs';

const labels={name:'Learner full name',email:'Contact email address',instrument:'Lesson instrument'};
// Only the deterministic test double knows this mapping. The app has opaque field names
// and human labels; no caller JSON paths are inserted into DOM names, IDs or result labels.
export function modernEngine(){return engine((q,r,id)=>{
  if(id.startsWith('bind_')){
    const input=r.state.inputs.find(input=>q.instructions.includes(JSON.stringify(input.path)));
    const meaning=input?.path==='/student/fullName'?labels.name:input?.path==='/student/contactEmail'?labels.email:labels.instrument;
    const controls=r.state.page.elements.filter(element=>element.name===meaning);
    return controls.length===1&&Object.hasOwn(q.criteria,controls[0].id)?controls[0].id:'__none__';
  }
  if(id.startsWith('effect_'))return r.state.actions[id.slice(7)]?.target?.name==='Create learner'?'commit':'advance';
  if(id==='action')return c=>c?.kind==='click'&&['New learner','Create learner'].includes(c.target?.name);
  if(id==='completion')return 'complete';
  if(id.startsWith('read_')){
    const input=r.state.inputs.find(input=>q.instructions.includes(JSON.stringify(input.path)));
    const label=input?.path==='/student/fullName'?labels.name:input?.path==='/student/contactEmail'?labels.email:labels.instrument;
    return r.state.sources.find(source=>source.context.startsWith(label+' ')&&source.text===`[input:${input.path}]`)?.id??'__none__';
  }
  return '__none__';
});}
export function fieldOrder(variant){
  return [[0,1,2],[1,2,0],[2,0,1],[0,2,1],[2,1,0],[1,0,2]][variant%6];
}
export async function modernFixture(t,browser,{widget='portal',variant=0,live=false,duplicate=false,disabled=false,association=true,delayMs=0,ignoreSelection=false,noise=false,browserOptions={}}={}){
  const suffix=randomBytes(5).toString('hex'),keys=[`u${suffix}a`,`u${suffix}b`,`u${suffix}c`];
  const control=`c${suffix}`,popup=`p${suffix}`,caption=`l${suffix}`;
  const records=[],attempts=[];
  const options=[...(widget==='search'?Array.from({length:997},(_,i)=>({code:`catalog-${i}`,label:`Catalog instrument ${i}`})):[]),{code:'piano',label:'Piano'},{code:'gamba',label:'Viola da gamba'},{code:'violin',label:'Violin'},...(duplicate?[{code:'gamba-duplicate',label:'Viola da gamba'}]:[])];
  const editable=widget==='editable'||widget==='search';
  const ordinary=[`<label>${labels.name}<input name="${keys[0]}" required autocomplete="off"></label>`,`<label>${labels.email}<input name="${keys[1]}" type="email" required></label>`];
  const combo=`<div><label id="${caption}">${labels.instrument}</label>${editable
    ?`<input id="${control}" role="combobox" aria-labelledby="${caption}" aria-autocomplete="list" aria-expanded="false" ${association?`aria-controls="${popup}"`:''} autocomplete="off">`
    :`<button type="button" id="${control}" role="combobox" aria-labelledby="${caption}" aria-expanded="false" ${association?`aria-controls="${popup}"`:''}>Choose an instrument</button>`}<input type="hidden" name="${keys[2]}"></div>`;
  const fields=[...ordinary,combo];
  const editor=`<form aria-label="Create learner">${fieldOrder(variant).map(i=>fields[i]).join('')}<button>Create learner</button></form>`;
  const pageHTML=`<h1>Music lessons</h1><button id="new-record">New learner</button><main id="editor"></main><section id="results"></section>
  <script>
  const keys=${JSON.stringify(keys)},choices=${JSON.stringify(options)};
  document.getElementById('new-record').onclick=()=>{
    document.getElementById('new-record').remove();document.getElementById('editor').innerHTML=${JSON.stringify(editor)};
    const form=document.querySelector('form'),combo=document.getElementById(${JSON.stringify(control)});
    const popup=document.createElement('div');popup.id=${JSON.stringify(popup)};popup.setAttribute('role','listbox');popup.hidden=true;
    ${widget==='inline'?'form.append(popup);':'document.body.append(popup);'}
    ${noise?`const decoy=document.createElement('div');decoy.setAttribute('role','listbox');decoy.innerHTML='<div role="option" onclick="window.decoyClicked=true">Viola da gamba</div>';document.body.prepend(decoy);`:''}
    let generation=0;
    function open(){const token=++generation;combo.setAttribute('aria-expanded','true');popup.hidden=false;popup.replaceChildren();
      setTimeout(()=>{if(token!==generation)return;const query=${editable?'combo.value.toLowerCase()':"''"};
        for(const choice of choices.filter(choice=>!query||choice.label.toLowerCase().includes(query)).slice(0,20)){const option=document.createElement('div');option.setAttribute('role','option');option.textContent=choice.label;
          if(${disabled}&&choice.code==='gamba')option.setAttribute('aria-disabled','true');
          option.onclick=()=>{if(option.getAttribute('aria-disabled')==='true')return;window.optionClicks=(window.optionClicks||0)+1;
            if(!${ignoreSelection}){form.elements.namedItem(keys[2]).value=choice.code;${editable?'combo.value=choice.label;':'combo.textContent=choice.label;'}}
            else ${editable?"combo.value='';":"combo.textContent='Choose an instrument';"}
            popup.hidden=true;combo.setAttribute('aria-expanded','false');};popup.append(option);}
      },${delayMs});}
    ${editable?"combo.oninput=open;combo.onclick=()=>{if(combo.getAttribute('aria-expanded')!=='true')open();};":'combo.onclick=open;'}
    form.onsubmit=async event=>{event.preventDefault();const body=Object.fromEntries(new FormData(form));
      const response=await fetch('/records',{method:'POST',body:JSON.stringify(body)});const saved=await response.json();
      if(!response.ok)return;form.remove();popup.remove();const article=document.createElement('article');article.innerHTML='<h2>Learner created</h2>';
      for(const[label,value]of [[${JSON.stringify(labels.name)},saved.fullName],[${JSON.stringify(labels.email)},saved.email],[${JSON.stringify(labels.instrument)},choices.find(choice=>choice.code===saved.instrument)?.label??'Missing instrument']]){const dl=document.createElement('dl'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;dl.append(dt,dd);article.append(dl);}document.getElementById('results').append(article);
    };
  };
  </script>`;
  const service=await httpServer(async(req,res)=>{
    if(req.url==='/records'&&req.method==='POST'){
      let raw='';for await(const chunk of req)raw+=chunk;const supplied=JSON.parse(raw);attempts.push(supplied);
      const record={fullName:supplied[keys[0]],email:supplied[keys[1]],instrument:supplied[keys[2]]};
      res.setHeader('Content-Type','application/json');
      if(!record.instrument){res.statusCode=422;res.end(JSON.stringify({error:'Select an instrument'}));return;}
      records.push(record);res.end(JSON.stringify(record));return;
    }
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end(pageHTML);
  });
  const page=await browser.newPage();await page.goto(service.url);
  const decider=live?new JevDecisionEngine():modernEngine();
  const core=new JevBrowser({page,engine:decider,...browserOptions});
  t.after(async()=>{await core.close();await page.close();await service.close();});
  return {core,page,records,attempts,decider,keys,html:pageHTML};
}
