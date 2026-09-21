import {expect as baseExpect,test} from '@playwright/test';
import {JevBrowser,BrowserError} from '@tontoko/jev-browser';
import {semanticMatchers} from '@tontoko/jev-browser/playwright';

// Exact path works without a model key. Use non-identical expected wording to opt into semantic inference.
test('reuse a native Locator and attach semantic diagnostics to the standard report',async({page},testInfo)=>{
  await page.setContent('<dl><dt>Plan</dt><dd data-testid="plan">Professional annual plan</dd></dl>');
  const core=new JevBrowser({page});
  const expect=baseExpect.extend(semanticMatchers(core));
  try{
    await expect(page.getByTestId('plan')).toSemanticallyMatch('Professional annual plan',{minConfidence:0.8});
  }catch(error){
    if(error instanceof BrowserError && error.semantic)
      await testInfo.attach('semantic-evidence.json',{body:JSON.stringify(error.semantic,null,2),contentType:'application/json'});
    throw error;
  }finally{await core.close();}
});
