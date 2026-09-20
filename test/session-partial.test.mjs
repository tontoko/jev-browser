import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {httpServer} from './helpers.mjs';
import {sendSession,sessionDirectory} from '../dist/sessions.js';
import {publicError} from '../dist/errors.js';

test('session errors retain the core partial and continuation without replay',async()=>{
  const root=await mkdtemp(join(tmpdir(),'jev-partial-')),previous=process.env.JEV_SESSION_DIR;
  process.env.JEV_SESSION_DIR=root;let calls=0;
  const partial={status:'unverified',reason:'effect-unknown',steps:[],continuation:{id:'session-local',reason:'effect-unknown',pendingEffect:'commit'}};
  const server=await httpServer((_req,res)=>{calls++;res.statusCode=500;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:false,error:{code:'PROVIDER_ERROR',message:'Decision interrupted',partial}}));});
  try{
    const directory=sessionDirectory('partial');await mkdir(directory,{mode:0o700});
    await writeFile(join(directory,'session.json'),JSON.stringify({name:'partial',cwd:process.cwd(),pid:process.pid,port:Number(new URL(server.url).port),token:'a'.repeat(64),createdAt:new Date().toISOString()}),{mode:0o600});
    await assert.rejects(sendSession('partial',{command:'run',instruction:'Save'}),error=>{
      assert.equal(error.code,'PROVIDER_ERROR');assert.deepEqual(publicError(error).partial,partial);return true;
    });
    assert.equal(calls,1);
  }finally{
    if(previous===undefined)delete process.env.JEV_SESSION_DIR;else process.env.JEV_SESSION_DIR=previous;
    await server.close();await rm(root,{recursive:true,force:true});
  }
});
