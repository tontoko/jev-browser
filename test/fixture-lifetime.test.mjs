import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('fixture cleanup is registered before navigation can fail',()=>{
  // Isolate the intentionally failed setup: the old helper leaves its HTTP server open.
  const result=spawnSync(process.execPath,['--input-type=module','-e',`
    import {goalFixture} from './test/goal-fixture.mjs';
    const cleanups=[];let closed=0,error;
    const page={goto:async()=>{throw Error('synthetic navigation failure');},close:async()=>{closed++;}};
    try{await goalFixture({after(fn){cleanups.push(fn);}},{newPage:async()=>page},[]);}
    catch(e){error=e.message;}
    finally{for(const cleanup of cleanups)await cleanup();}
    console.log(JSON.stringify({error,closed,registered:cleanups.length}));
    process.exit(0);
  `],{cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);
  const output=JSON.parse(result.stdout);
  assert.equal(output.error,'synthetic navigation failure');
  assert.equal(output.closed,1);assert.ok(output.registered>0);
});
