import {JevBrowser} from '../dist/index.js';
import {engine,httpServer} from './helpers.mjs';

export const stages = [
  {key:'account',button:'Save account',title:'Account created',label:'Email address',path:'/email',field:'a7'},
  {key:'membership',button:'Save membership',title:'Membership created',label:'Membership code',path:'/membershipCode',field:'b3'},
  {key:'reservation',button:'Save reservation',title:'Reservation created',label:'Reservation reference',path:'/reservationReference',field:'c9'},
];
export const goal='Create the account with the email address, then create its membership with the membership code, then create a reservation with the reservation reference. Save each once; finish after all three are created.';
export const values={email:'account-042@example.invalid',membershipCode:'MEM-042',reservationReference:'RES-042'};

// The test engine controls semantic selections only. The HTTP handler independently
// records actual submissions and rejects missing stage input. Tests separately check order and exact counts.
export function stagedDecider(count=3){
  return engine((question,request,id)=>{
    if(id.startsWith('bind_')){
      const input=request.state.inputs.find(input=>question.instructions.includes(JSON.stringify(input.path)));
      const stage=stages.find(stage=>stage.path===input?.path);
      const control=request.state.page.elements.find(control=>control.name===stage?.label);
      if(control)return control.id;
      const current=stages.findIndex(item=>request.state.page.elements.some(control=>control.name===item.button));
      return Object.hasOwn(question.criteria,'__later__')&&stages.indexOf(stage)>current?'__later__':'__none__';
    }
    if(id.startsWith('stage_input_')){
      const input=request.state.inputs.find(input=>question.instructions.includes(JSON.stringify(input.path)));
      const current=stages.findIndex(stage=>stage.button===request.state.action?.target?.name);
      return stages.findIndex(stage=>stage.path===input?.path)>current?'later':'current';
    }
    if(id.startsWith('effect_'))return request.state.actions?.[id.slice(7)]?.target?.name?.startsWith('Save ')?'commit':'advance';
    if(id==='action')return candidate=>candidate?.kind==='click'&&candidate.target?.name?.startsWith('Save ');
    if(id==='completion')return request.state.record.context.includes(stages[count-1].title)?'complete':(Object.hasOwn(question.criteria,'continue')?'continue':'incomplete');
    if(id.startsWith('read_')){
      const input=request.state.inputs.find(input=>question.instructions.includes(JSON.stringify(input.path)));
      const stage=stages.find(stage=>stage.path===input?.path);
      return request.state.sources.find(source=>source.context.startsWith(stage.label+' ')&&Object.hasOwn(question.criteria,source.id))?.id??'__none__';
    }
    if(id.startsWith('reuse_'))return '__none__';
    return '__none__';
  });
}

export async function continuationFixture(t,browser,{count=3,holdStage=-1,decider=stagedDecider(count),onSave,coreOptions={}}={}){
  const submissions=[];let html;
  const service=await httpServer(async(req,res)=>{
    if(req.url?.startsWith('/save/')){
      let raw='';for await(const chunk of req)raw+=chunk;
      const data=JSON.parse(raw),stage=stages.find(stage=>req.url==='/save/'+stage.key);
      submissions.push({stage:stage?.key,data});
      res.setHeader('Content-Type','application/json');
      if(!stage||typeof data[stage.field]!=='string'||!data[stage.field].trim()){
        res.statusCode=422;res.end(JSON.stringify({error:'Required value missing'}));return;
      }
      if(onSave)await onSave({stage:stage.key,data});
      res.end(JSON.stringify({value:data[stage.field]}));return;
    }
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(html);
  });
  const page=await browser.newPage();
  // HTML is supplied by the local app, using opaque input names and human labels.
  html=`<!doctype html><main><h1>Account setup</h1><div id="editor"></div><section id="results"></section><p id="final">Pending</p></main><script>
    const stages=${JSON.stringify(stages.slice(0,count).map(({path,...stage})=>stage))},editor=document.querySelector('#editor'),results=document.querySelector('#results');
    const saved={};let index=0,pending;
    function finishStage(stage,value){
      saved[stage.label]=value;
      const article=document.createElement('article'),h=document.createElement('h2');h.textContent=stage.title;article.append(h);
      for(const [label,actual] of Object.entries(saved)){const dl=document.createElement('dl'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=actual;dl.append(dt,dd);article.append(dl);}
      results.append(article);index++;render();
    }
    window.releaseResult=()=>{if(pending){const [stage,value]=pending;pending=undefined;finishStage(stage,value);}};
    function render(){
      editor.replaceChildren();
      if(index===stages.length){document.querySelector('#final').textContent='Ready';return;}
      const stage=stages[index],form=document.createElement('form'),label=document.createElement('label'),input=document.createElement('input'),button=document.createElement('button');
      form.setAttribute('aria-label',stage.key+' details');label.textContent=stage.label;input.name=stage.field;input.required=true;label.append(input);button.textContent=stage.button;form.append(label,button);editor.append(form);
      form.onsubmit=async event=>{event.preventDefault();button.disabled=true;
        const response=await fetch('/save/'+stage.key,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({[stage.field]:input.value})});
        const result=await response.json();if(!response.ok){button.disabled=false;return;}
        if(index===${holdStage})pending=[stage,result.value];else finishStage(stage,result.value);
      };
    }
    render();
  </script>`;
  await page.goto(service.url);
  const core=new JevBrowser({page,engine:decider,...coreOptions});
  t.after(async()=>{await core.close();await page.close();await service.close();});
  return {core,page,submissions,decider,service,release:()=>page.evaluate(()=>window.releaseResult())};
}
