import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JevBrowser} from '../dist/index.js';
test('a native file chooser is reported as a tool limitation without revealing its element metadata',async t=>{
 const core=await JevBrowser.launch();t.after(()=>core.close());
 await core.page.setContent('<input type="file" hidden aria-label="PRIVATE_FILE_FIELD"><button style="position:absolute;left:20px;top:20px;width:140px;height:50px" onclick="document.querySelector(\'input\').click()">Choose a file</button>');
 const seen=await core.screen({action:'look'});
 await assert.rejects(core.screen({action:'click',x:60,y:40,observationId:seen.observationId}),error=>{
  assert.equal(error.code,'SCREEN_FILE_CHOOSER_UNSUPPORTED');assert.equal(error.message.includes('PRIVATE_'),false);return true;
 });
 assert.equal(await core.page.locator('input').evaluate(input=>input.files.length),0);
});
