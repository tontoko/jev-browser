import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {httpServer} from './helpers.mjs';

const cli=fileURLToPath(new URL('../dist/cli.js',import.meta.url));
async function connect(t,site,{screenOnly=true,timeoutMs=2500}={}) {
  const transport=new StdioClientTransport({command:process.execPath,
    args:[cli,'mcp',...(screenOnly?['--screen-only']:[]),'--url',site.url+'/journey','--timeout-ms',String(timeoutMs)],
    env:{...process.env,JEV_API_KEY:'',TYPESAFE_API_KEY:''},stderr:'pipe'});
  const client=new Client({name:'screen-lifecycle',version:'1'});
  t.after(async()=>{await client.close();await site.close();});
  await client.connect(transport);
  return {client,transport};
}
const look=client=>client.callTool({name:'browser_screen',arguments:{action:'look'}});

test('MCP stdin shutdown cancels a held trusted startup navigation promptly',async t=>{
  let requested;
  const navigationRequested=new Promise(resolve=>{requested=resolve;});
  const site=await httpServer(()=>{requested();});
  const {client,transport}=await connect(t,site);
  const pending=look(client).catch(error=>error);
  await navigationRequested;
  // End only stdin, without the client's later forced process termination masking a leaked browser.
  const child=transport._process;
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  child.stdin.end();
  const result=await Promise.race([exited,delay(1200).then(()=>null)]);
  assert.deepEqual(result,{code:0,signal:null},'EOF must close the owned browser while initial navigation is pending');
  await pending;
});

for(const screenOnly of [true,false]) {
  test(`MCP close ${screenOnly?'is final in screen-only mode':'preserves ordinary lazy restart'}`,async t=>{
    let visits=0;
    const site=await httpServer((req,res)=>{
      if(req.url==='/journey')visits++;
      res.setHeader('content-type','text/html');res.end('<p>Visible journey</p>');
    });
    const {client}=await connect(t,site,{screenOnly});
    assert.notEqual((await look(client)).isError,true);
    const closed=await client.callTool({name:'browser_close',arguments:{}});
    assert.equal(closed.structuredContent.status,'closed');
    const next=await look(client);
    if(screenOnly){
      assert.equal(next.isError,true);
      assert.equal(JSON.parse(next.content.find(item=>item.type==='text').text).error.code,'CLOSED');
      assert.equal(visits,1,'a closed visual journey must not be silently replayed');
    } else {
      assert.notEqual(next.isError,true);assert.equal(visits,2);
    }
  });
}

test('a failed MCP startup is not automatically launched or navigated again',async t=>{
  let requests=0;
  const site=await httpServer(()=>{requests++;});
  const {client}=await connect(t,site,{timeoutMs:400});
  assert.equal((await look(client)).isError,true);
  const afterFailure=requests;assert.ok(afterFailure>0);
  assert.equal((await look(client)).isError,true);
  assert.equal(requests,afterFailure);
});
