import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCLI,commandFromCLI} from '../dist/cli-options.js';
import {parseCommand,executeCommand} from '../dist/commands.js';
test('screen-only startup and pixel commands are accepted without enabling evaluation',()=>{
 const startup=parseCLI(['mcp','--screen-only']);
 assert.equal(startup.options.screenOnly,true);assert.notEqual(startup.options.allowEvaluate,true);
 const request=commandFromCLI('screen',[],parseCLI(['screen','--args','{"action":"look"}']).values);
 assert.deepEqual(request,{command:'screen',action:'look'});
 assert.throws(()=>parseCommand({command:'screen',action:'look',scope:'body'}),{code:'INVALID_ARGUMENT'});
});
test('restricted dispatcher refuses a DOM read before invoking the browser',async()=>{
 let read=false,denied;
 const session={screenOnly:true,snapshot:async()=>{read=true;return {private:'hidden'};},recordScreenDenied:async command=>{denied=command;}};
 await assert.rejects(executeCommand(session,parseCommand({command:'snapshot'})),{code:'SCREEN_ONLY'});
 assert.equal(read,false);assert.equal(denied,'snapshot');
});

