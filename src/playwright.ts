import type { Locator } from 'playwright';
import type { JevBrowser } from './browser.js';
import { BrowserError } from './errors.js';
import type { SemanticCompareOptions, SemanticComparisonResult, SemanticLocatorProperty } from './types.js';

export interface SemanticMatcherOptions extends SemanticCompareOptions {
  property?: SemanticLocatorProperty;
  attribute?: string;
}

/** Pass to the caller's expect.extend. Does not import or replace Playwright Test. */
export function semanticMatchers(core: JevBrowser) {
  return {
    async toSemanticallyMatch(actual: Locator, expected: string, options: SemanticMatcherOptions = {}) {
      const {property,attribute,...operation}=options;
      let result:SemanticComparisonResult;
      try { result=await core.assertSemantic({actual:{locator:actual,property,attribute},expected},operation); }
      catch(error) {
        // Only a supported, fresh difference may satisfy .not. Uncertainty must throw.
        if(!(error instanceof BrowserError)||error.code!=='SEMANTIC_ASSERTION_FAILED'||!error.semantic)throw error;
        result=error.semantic.results[0]!;
      }
      return {
        name:'toSemanticallyMatch',pass:result.status==='passed',actual:result.evidence.value??result.evidence.text,expected,
        message:()=>`Semantic comparison with current grounded evidence:\n${JSON.stringify({expected,...result},null,2)}`,
      };
    },
  };
}
