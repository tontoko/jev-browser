import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

export async function checkInstalledScreen(pkg, directory, env) {
  const { JevBrowser } = await import(pathToFileURL(join(pkg, 'dist', 'index.js')).href);
  let saves = 0;
  const site = createServer((req, res) => {
    if (req.url === '/save') { saves++; res.end('Saved'); return; }
    res.setHeader('content-type','text/html');
    res.end('<title>PRIVATE_TITLE</title><button aria-label="PRIVATE_ARIA" style="position:absolute;left:20px;top:20px;width:160px;height:50px" onclick="fetch(\'/save\').then(r=>r.text()).then(t=>this.textContent=t)">Save</button><i hidden>PRIVATE_DOM</i>');
  });
  await new Promise(resolve => site.listen(0,'127.0.0.1',resolve));
  const url = 'http://127.0.0.1:'+site.address().port+'/PRIVATE_ROUTE';
  const cli = args => new Promise((resolve,reject) => {
    const child=spawn(process.execPath,[join(pkg,'dist','cli.js'),...args],{cwd:directory,env,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Installed screen CLI timed out.'));},60000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('close',code=>{clearTimeout(timer);try{resolve({code,...JSON.parse(stdout)});}catch{reject(new Error('Installed screen CLI did not return JSON: '+stderr));}});
  });
  let core, client;
  try {
    core=await JevBrowser.launch({screenOnly:true});
    await core.page.goto(url);
    let r=await core.screen({action:'look'});
    assert.equal(JSON.stringify(r).includes('PRIVATE_'),false);
    r=await core.screen({action:'click',x:70,y:45,observationId:r.observationId});
    await core.page.waitForFunction(()=>document.querySelector('button')?.textContent==='Saved');
    assert.equal(saves,1);assert.equal(r.frames[0].mimeType,'image/png');
    await core.close();core=undefined;
    try {
      const opened=await cli(['open',url,'--session','installed-screen','--screen-only']);
      assert.equal(opened.code,0);assert.equal(opened.result.screenOnly,true);assert.equal(JSON.stringify(opened).includes('PRIVATE_ROUTE'),false);
      const screen=await cli(['screen','--session','installed-screen','--args','{"action":"look"}']);
      assert.equal(screen.code,0);assert.ok(screen.result.frames[0].data);assert.equal(JSON.stringify(screen).includes('PRIVATE_'),false);
      const blocked=await cli(['snapshot','--session','installed-screen']);assert.equal(blocked.code,1);assert.equal(blocked.error.code,'SCREEN_ONLY');
      const mismatch=await cli(['open','--session','installed-screen']);assert.equal(mismatch.error.code,'SESSION_MODE_MISMATCH');
    } finally { await cli(['close','--session','installed-screen']); }
    client=new Client({name:'installed-screen-proof',version:'1'});
    await client.connect(new StdioClientTransport({command:process.execPath,args:[join(pkg,'dist','mcp-stdio.js'),'--screen-only','--url',url],cwd:directory,env,stderr:'pipe'}));
    assert.deepEqual((await client.listTools()).tools.map(tool=>tool.name).sort(),['browser_close','browser_screen']);
    const image=await client.callTool({name:'browser_screen',arguments:{action:'look'}});
    assert.notEqual(image.isError,true);assert.equal(image.content.filter(c=>c.type==='image').length,1);
    assert.equal(JSON.stringify(image).includes('PRIVATE_'),false);
    return { installedScreenSDK:true, installedScreenCLI:true, installedScreenMCP:true };
  } finally {
    await client?.close();await core?.close();site.closeAllConnections();await new Promise(resolve=>site.close(resolve));
  }
}

