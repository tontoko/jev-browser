import {httpServer} from './helpers.mjs';

// Layouts and IDs are fixed before any live provider run. This is a synthetic transfer set,
// not an unseen-site benchmark. No input JSON paths are present in the application markup.
export async function orderWorkflowFixture(t,{variant=0}={}) {
 const reference='ORD-'+String(4100+variant).padStart(5,'0');
 const records=[{id:reference+'-A',status:'Pending'},{id:reference,status:'Pending'},{id:reference+'-B',status:'Packed'}];
 if(variant%2)records.reverse();
 const before=structuredClone(records),writes=[];
 const labels=['Delivery status','Fulfillment state','Dispatch status'];
 const data={layout:variant%3,reference,labels:labels[variant%3]};
 const site=await httpServer(async(req,res)=>{
  res.setHeader('content-type','application/json');
  if(req.url.startsWith('/search')){res.end(JSON.stringify(records));return;}
  if(req.url==='/update'){
   let raw='';for await(const c of req)raw+=c;const request=JSON.parse(raw);writes.push(request);
   const record=records.find(r=>r.id===request.id);
   if(!record||!['Pending','Packed','Shipped','Cancelled'].includes(request.status)){res.statusCode=422;res.end('{}');return;}
   record.status=request.status;res.end(JSON.stringify(record));return;
  }
  res.setHeader('content-type','text/html; charset=utf-8');
  res.end(`<!doctype html><main><h1>Orders</h1><div id="workspace"><form aria-label="Order search"><label>Order reference<input name="q17" required></label><button>Search orders</button></form></div></main><script>
   const config=${JSON.stringify(data)},root=document.querySelector('#workspace');
   let rows=[];
   function text(tag,value){const el=document.createElement(tag);el.textContent=value;return el;}
   function edit(row){
    root.replaceChildren(text('h2','Edit order '+row.id));const form=document.createElement('form');form.setAttribute('aria-label','Order '+row.id);const label=text('label',config.labels),select=document.createElement('select');select.name='c82';
    for(const status of ['Pending','Packed','Shipped','Cancelled']){const option=text('option',status);option.value=status;option.selected=status===row.status;select.append(option);}label.append(select);form.append(label,text('button','Save order'));root.append(form);
    form.onsubmit=async event=>{event.preventDefault();form.querySelector('button').disabled=true;const response=await fetch('/update',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:row.id,status:select.value})});const saved=await response.json();const article=document.createElement('article');article.append(text('h2','Order updated'));const dl=document.createElement('dl');const id=text('dd',saved.id),status=text('dd',saved.status);id.setAttribute('data-testid','saved-reference');status.setAttribute('data-testid','saved-status');dl.append(text('dt','Order reference'),id,text('dt',config.labels),status);article.append(dl);root.replaceChildren(article);};
   }
   function list(){root.replaceChildren(text('h2','Matching orders'));const container=document.createElement(config.layout===0?'table':config.layout===1?'ul':'section');
    const body=config.layout===0?document.createElement('tbody'):container;if(body!==container)container.append(body);
    for(const row of rows){const item=document.createElement(config.layout===0?'tr':config.layout===1?'li':'article');const tag=config.layout===0?'td':'p';item.append(text(tag,row.id),text(tag,row.status));const action=text('button','Edit');action.onclick=()=>edit(row);if(config.layout===0){const cell=document.createElement('td');cell.append(action);item.append(cell);}else item.append(action);body.append(item);}root.append(container);
   }
   document.querySelector('form').onsubmit=async event=>{event.preventDefault();const value=document.querySelector('input').value;const response=await fetch('/search?reference='+encodeURIComponent(value));rows=await response.json();list();};
  </script>`);
 });
 t.after(()=>site.close());return {url:site.url,reference,records,before,writes};
}
