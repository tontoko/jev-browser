import { JevBrowser, JevDecisionEngine } from '../dist/index.js';
import { engine, httpServer } from './helpers.mjs';
const esc = value => String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');

// This controls semantic answers, not application outcomes. The independent server below
// records what the browser actually submits. Live tests replace this engine with Jev.
export function formEngine({ collide = false, forbidden = false } = {}) {
  return engine((question, request, name) => {
    if (name.startsWith('bind_')) {
      const input = request.state.inputs.find(input => question.instructions.includes(JSON.stringify(input.path)));
      const controls = request.state.page.elements;
      const target = collide ? controls.find(e => e.fillable) : controls.find(e => e.name === input?.label || e.fieldName === input?.path);
      return target && Object.hasOwn(question.criteria,target.id) ? target.id : '__none__';
    }
    if (name.startsWith('effect_')) return forbidden ? 'forbidden' : request.state.actions?.[name.slice('effect_'.length)]?.target?.name === 'Save' ? 'commit' : 'advance';
    if (name === 'completion') return 'complete';
    if(name.startsWith('read_')) {
      const input=request.state.inputs.find(input=>question.instructions.includes(JSON.stringify(input.path)));
      const source=request.state.sources.find(source=>source.context.startsWith(input.path+' ') && source.text === '[input:'+input.path+']');
      return source?.id ?? '__none__';
    }
    if (name === 'action') return candidate => candidate && typeof candidate === 'object' && candidate.kind === 'click' && ['Add','Save','Next'].includes(candidate.target?.name);
    return '__none__';
  });
}

export async function goalFixture(t, browser, fields, options = {}) {
  const records = [], attempts = [];
  const controls = fields.map(field => `<label>${esc(field.label ?? field.path)}${field.type === 'select'
    ? `<select name="${esc(field.path)}"${field.multiple ? ' multiple' : ''}>${field.options.map((value,i)=>`<option value="${esc(value)}"${field.selected?.includes(value) ? ' selected':''}>${esc(value)}</option>`).join('')}</select>`
    : `<input name="${esc(field.path)}" type="${field.type ?? 'text'}"${field.required === false ? '' : ' required'}${field.checked ? ' checked' : ''} value="${esc(field.value ?? (field.type === 'checkbox' ? 'on' : ''))}">`}</label>`).join('');
  const body = `<h1>${esc(options.title ?? 'Contacts')}</h1><button id="add">Add</button><div id="editor"></div><section id="results"></section>
    <script>
    document.getElementById('add').onclick=()=>{
      document.getElementById('add').remove();
      setTimeout(()=>{document.getElementById('editor').innerHTML=${JSON.stringify(`<form aria-label="${esc(options.formName ?? 'New contact')}">${controls}<button>Save</button><p role="status"></p></form>`)};
      const form=document.getElementById('editor').querySelector('form');form.onsubmit=async event=>{
        event.preventDefault();const data=Object.fromEntries(new FormData(form));
        for(const select of form.querySelectorAll('select[multiple]'))data[select.name]=Array.from(select.selectedOptions,o=>o.value);
        const response=await fetch('/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
        const saved=await response.json();
        if(saved.error){form.querySelector('[role=status]').textContent=saved.error;return;}
        ${options.noReadback ? "form.querySelector('[role=status]').textContent='Saved';" : "form.remove();const article=document.createElement('article');const heading=document.createElement('h2');heading.textContent='Contact created';article.append(heading);for(const [key,value] of Object.entries(saved)){const dl=document.createElement('dl'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=Array.isArray(value)?value.join(', '):String(value);dl.append(dt,dd);article.append(dl);}document.getElementById('results').append(article);"}
      };
      },${options.delayMs ?? 0});
    };
    </script>`;
  const service = await httpServer(async(req,res) => {
    if(req.url === '/save') {
      let raw='';for await (const part of req) raw+=part;
      const data=JSON.parse(raw);attempts.push(data);
      if(options.reject) {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'Not saved'}));return;}
      records.push(data);
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return;
    }
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end(body.replace("heading.textContent='Contact created'",'heading.textContent='+JSON.stringify(options.resultTitle ?? 'Contact created')));
  });
  const page = await browser.newPage(); await page.goto(service.url);
  const decider = options.engine ?? (options.live ? new JevDecisionEngine() : formEngine());
  const core = new JevBrowser({page,engine:decider,...options.browserOptions});
  t.after(async()=>{await core.close();await page.close();await service.close();});
  return {core,page,records,attempts,decider};
}

