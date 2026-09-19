// A complete synthetic create task. Run with JEV_API_KEY set: npm run example:goal.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {JevBrowser} from '@tontoko/jev-browser';
const records=[];
const site=createServer(async(req,res)=>{
  if(req.url==='/save'&&req.method==='POST'){
    let body='';for await(const chunk of req)body+=chunk;
    const record=JSON.parse(body);records.push(record);
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(record));return;
  }
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end(`<h1>Contacts</h1><button id="add">Add contact</button><div id="editor"></div><section id="results"></section>
    <script>document.querySelector('#add').onclick=()=>{
      document.querySelector('#add').remove();
      document.querySelector('#editor').innerHTML='<form aria-label="New contact"><label>Contact name<input name="name" required></label><label>Contact email<input name="email" type="email" required></label><button>Save</button></form>';
      document.querySelector('form').onsubmit=async event=>{
        event.preventDefault();const form=event.target;
        const response=await fetch('/save',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});
        const saved=await response.json();form.remove();
        const article=document.createElement('article'),heading=document.createElement('h2');heading.textContent='Contact created';article.append(heading);
        for(const [key,value] of Object.entries(saved)){const dl=document.createElement('dl'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;dl.append(dt,dd);article.append(dl);}
        document.querySelector('#results').append(article);
      };
    };</script>`);
});
await new Promise(resolve=>site.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await JevBrowser.launch();
  await browser.goto(`http://127.0.0.1:${site.address().port}`);
  const values={name:'Example Contact',email:'example-contact@example.invalid'};
  const result=await browser.run('Open the new contact form, enter all supplied details, Save once, and verify the new contact.',{values});
  assert.equal(result.status,'complete');
  assert.deepEqual(records,[values]); // Independent application result, not a model self-score.
  console.log(JSON.stringify({status:result.status,verification:result.verification,steps:result.steps.length,usage:result.usage},null,2));
}finally{await browser?.close();site.closeAllConnections();await new Promise(resolve=>site.close(resolve));}
