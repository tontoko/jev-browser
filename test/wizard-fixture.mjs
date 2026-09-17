import {JevBrowser,JevDecisionEngine} from '../dist/index.js';
import {httpServer} from './helpers.mjs';
import {formEngine} from './goal-fixture.mjs';
export async function wizardFixture(t,browser,{live=false}={}){
 const records=[],attempts=[];
 const service=await httpServer(async(req,res)=>{
  if(req.url==='/save'){let raw='';for await(const chunk of req)raw+=chunk;const record=JSON.parse(raw);attempts.push(record);records.push(record);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(record));return;}
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end(`<h1>New contact</h1><div id=editor></div><section id=results></section><script>
   const draft={};let step=0;
   function render(){const key=step===0?'/name':'/email',label=step===0?'Contact name':'Contact email';
    document.getElementById('editor').innerHTML='<form aria-label="Contact step '+(step+1)+'"><label>'+label+'<input required name="'+key+'"></label><button>'+(step===0?'Next':'Save')+'</button></form>';
    const form=document.getElementById('editor').querySelector('form');form.onsubmit=async event=>{event.preventDefault();Object.assign(draft,Object.fromEntries(new FormData(form)));
     if(step===0){step++;render();return;}
     const response=await fetch('/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(draft)});const saved=await response.json();
     form.remove();const article=document.createElement('article');article.innerHTML='<h2>Contact created</h2>';
     for(const[key,value]of Object.entries(saved)){const dl=document.createElement('dl'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;dl.append(dt,dd);article.append(dl);}
     document.getElementById('results').append(article);
    };
   }render();
  </script>`);
 });
 const page=await browser.newPage();await page.goto(service.url);const core=new JevBrowser({page,engine:live?new JevDecisionEngine():formEngine()});
 t.after(async()=>{await core.close();await page.close();await service.close();});return {core,page,records,attempts};
}
