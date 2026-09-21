import {JevBrowser} from '../dist/index.js';
import {engine,httpServer} from './helpers.mjs';
export async function selectionFixture(t,browser,options={}){
  const submissions=[];
  const opts=options.options??[{label:'Choose',value:''},{label:'日本',value:'JP'},{label:'ドイツ',value:'DE'}];
  const service=await httpServer(async(req,res)=>{
    if(req.url==='/save'){
      let raw='';for await(const chunk of req)raw+=chunk;const data=JSON.parse(raw);submissions.push(data);
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return;
    }
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`<h1>Address</h1><form><label>Country<select name="a9">${opts.map(o=>`<option value="${o.value}">${o.label}</option>`).join('')}</select></label><label>Private note<input name="b4"></label><button>Save</button></form><section id="result"></section><script>
      document.querySelector('form').onsubmit=async event=>{event.preventDefault();const form=event.target;const response=await fetch('/save',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});const data=await response.json();window.saved=data;if(!${!!options.omitResult}){const article=document.createElement('article');article.innerHTML='<h2>Address saved</h2><dl><dt>Country</dt><dd></dd></dl><dl><dt>Private note</dt><dd></dd></dl>';article.querySelectorAll('dd')[0].textContent=${JSON.stringify(options.resultCountry??'JP')};article.querySelectorAll('dd')[1].textContent=data.b4;form.remove();document.querySelector('#result').append(article);}};
    </script>`);
  });
  const decider=options.engine??engine((q,r,id)=>{
    if(id.startsWith('bind_'))return r.state.page.elements.find(e=>e.name===(q.instructions.includes('"/country"')?'Country':'Private note'))?.id??'__none__';
    if(id.startsWith('effect_'))return r.state.actions?.[id.slice(7)]?.target?.name==='Save'?'commit':'advance';
    if(id==='action')return c=>c?.kind==='click'&&c.target?.name==='Save';
    if(id.startsWith('stage_input_'))return 'current';
    if(id.startsWith('selection_'))return options.choice??(Object.hasOwn(q.criteria,'option_1')?'option_1':'__none__');
    if(id==='completion')return 'complete';
    if(id.startsWith('read_'))return r.state.sources.find(s=>s.context.startsWith(q.instructions.includes('"/country"')?'Country ':'Private note '))?.id??'__none__';
    return '__none__';
  });
  const original=decider.decide.bind(decider);
  decider.decide=async(r,o)=>{const answer=await original(r,o);if(Object.keys(r.questions).some(id=>id.startsWith('selection_'))){
    for(const [id,a] of Object.entries(answer.answers))if(id.startsWith('selection_'))a.confidence=options.confidence??0.95;
    if(options.afterSelection)await options.afterSelection(page);
  }return answer;};
  const page=await browser.newPage();await page.goto(service.url);
  const core=new JevBrowser({page,engine:decider,...options.coreOptions});
  t.after(async()=>{await core.close();await page.close();await service.close();});
  return {core,page,submissions,decider};
}
