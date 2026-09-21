# Semantic verification

Jev Browser has three deliberately different verification modes. They are not interchangeable.

## 1. Deterministic / local

Use Playwright or native assertions when the browser exposes the fact directly.

```ts
await expect(page.getByRole('status')).toHaveText('Paid');

await browser.native({
  command: 'assert',
  target: '[data-state="paid"]',
  property: 'visible',
  expected: true,
});
```

These checks do not call Jev. Exact browser facts remain the preferred oracle for E2E tests.

## 2. Semantic / Jev

Use semantic comparison when the actual UI evidence and the expected meaning are not reliably reducible to literal equality.

```ts
const result = await browser.compareSemantic({
  actual: { description: 'Current subscription plan' },
  expected: 'Professional annual subscription',
  minConfidence: 0.8,
});
```

The runtime first grounds `actual` to observed page evidence. It then compares only that evidence with the caller-supplied expected meaning.

A comparison has three model choices:

- `equivalent`
- `different`
- `insufficient_evidence`

and three public statuses:

- `passed`
- `failed`
- `inconclusive`

The default `minConfidence` is `0.8` and accepts any finite value from `0` through `1`. `minSourceConfidence` is optional and defaults to the effective `minConfidence`; it can be tuned independently when source-selection confidence has a different distribution from comparison confidence.

**Jev confidence is a decision score, not a calibrated probability that the assertion is correct.** A threshold of `0.8` means “accept this semantic decision only when the returned score is at least 0.8.” It does not mean “80% probability of correctness.”

```ts
{
  status: 'passed',
  choice: 'equivalent',
  confidence: 0.93,
  sourceConfidence: 0.94,
  threshold: 0.8,
  sourceThreshold: 0.8,
  source: 'semantic',
  evidence: {
    sourceId: 't0_3',
    frame: 0,
    role: 'definition',
    text: 'Pro annual',
    context: 'Plan Pro annual'
  },
  usage: {
    requests: 2,
    questions: 2,
    serialDecisionDepth: 2,
    inputTokens: 1057,
    outputTokens: 100,
    providerMs: 520,
    observationMs: 8,
    verificationMs: 3
  }
}
```

### Source confidence and comparison confidence are separate

`sourceConfidence` describes Jev's selection of the grounded actual source. `confidence` describes the final semantic comparison when a comparison model call was needed.

They are intentionally not collapsed into one number. A semantic assertion passes only when every model-dependent link it relied on clears its configured threshold. `minConfidence` gates semantic comparison; `minSourceConfidence` gates source selection and defaults to `minConfidence`. A low source score therefore makes the result inconclusive before a later comparison is attempted; the second frontier is skipped because it cannot turn that assertion into a pass. Exact equality after a semantic source selection performs no second model call and is reported as a deterministic comparison, while the separate `sourceConfidence` still determines whether the overall result is conclusive.

Source binding still fails closed on an explicit no-match or ambiguity. The selected source is always returned so callers can inspect what was actually compared.

### Tuning source confidence separately

Source selection and semantic comparison can have different score distributions. Keep the comparison threshold strict while lowering only the source threshold when your own calibration justifies it:

```ts
const result = await browser.compareSemantic({
  actual: { description: 'Current plan' },
  expected: 'Professional annual plan',
  minConfidence: 0.8,
  minSourceConfidence: 0.4,
});
```

This does not reinterpret either score as a probability. The result reports both `threshold` and `sourceThreshold` so callers and CI logs can see exactly which policy was applied.

When a semantic source is selected and the actual value then matches the expected text exactly, there is no second Jev comparison. The comparison provenance is deterministic, `confidence` is `1`, and the separately retained `sourceConfidence` still has to clear `sourceThreshold` for the overall result to pass.

### Throwing assertion

```ts
await browser.assertSemantic({
  actual: { description: 'Billing state' },
  expected: 'Paid',
  minConfidence: 0.9,
});
```

`assertSemantic` uses the same comparison core:

- `failed` -> `SEMANTIC_ASSERTION_FAILED`
- `inconclusive` -> `SEMANTIC_ASSERTION_INCONCLUSIVE`
- `passed` -> returns the structured result

An inconclusive semantic result never silently passes.

## Snapshot comparisons and current assertions

`compareSemantic()` and `compareSemanticBatch()` return `freshness: "snapshot"`: their verdict is about the evidence captured for that operation. They do not claim it remains current after inference.

`assertSemantic()` and `assertSemanticBatch()` re-read every bound source before returning while retaining the same core operation lease. Unchanged evidence is `freshness: "verified"`. Changed, hidden, detached or replaced captured sources are `freshness: "changed"` and `status: "inconclusive"`; `currentEvidence` is included when the current source can still be read. This is verification at a bounded instant, not a promise that a page cannot change immediately afterward. No database durability guarantee follows from DOM text.

There is no favorable-answer retry loop. Unchanged low-confidence evidence remains inconclusive. When evidence changes, inspect the current evidence or wait for a caller-known application state before explicitly starting a new assertion. Do not wrap semantic assertions in blind `expect.poll` / `toPass` loops to turn repeated model sampling into confidence.

## Caller Playwright Locators

```ts
const results = await browser.assertSemanticBatch([
  { actual: { locator: page.getByTestId('plan'), property: 'text' }, expected: 'Professional annual subscription' },
  { actual: { locator: page.getByLabel('Opt in'), property: 'checked' }, expected: 'false' },
]);
```

Locator inputs are SDK-only and belong to the core's real `Page`. Locator resolution must be unique and visible; caller `scope` bounds the result, including frames/shadow roots. A missing attached element may wait through Playwright within the operation budget. `text` is the default and reads the caller Locator's visible text without additional whitespace folding. `value` reads native input/textarea/single-select values. `checked` reads native or ARIA state (expected meaning remains a string such as `"true"`). `attribute` requires an explicit attribute name and reads its literal DOM value. Unsupported properties and ambiguous matches fail explicitly.

An explicit Locator supplies source authority, so no source-discovery model call is needed. Literal equality of the grounded value uses zero model calls and does not initialize the provider. A semantic comparison still sends the selected actual value/context and expected meaning to the configured endpoint. Sensitive input values are not read this way unless the caller explicitly chooses that property.

For a caller-authored Locator, identical rerendering is allowed when the Locator resolves to the same current meaning on the same Page/frame/URL. Captured semantic refs are stricter: replacing their observed node invalidates that identity. This does not synthesize a CSS selector, cache an old outcome, or claim identity across login/tenant changes.

## Native Playwright Test integration

```ts
import { expect as baseExpect } from '@playwright/test';
import { semanticMatchers } from '@tontoko/jev-browser/playwright';
const expect = baseExpect.extend(semanticMatchers(browser));
await expect(page.getByTestId('plan')).toSemanticallyMatch('Professional annual subscription', {
  minConfidence: 0.8,
});
```

This optional export imports no Playwright Test runtime and defines only the semantic matcher. A confidently different, freshly checked value may satisfy `.not`; insufficient evidence, stale evidence or low confidence still throws rather than passing through negation. Normal Playwright assertions remain unchanged. `examples/semantic.spec.ts` demonstrates existing report attachments; evidence attachments can contain private UI data.

## Batch APIs and reuse

`locateSemanticBatch(descriptions, options)` discovers independent targets against one observation. Its refs stay usable through normal native operations while the captured node/semantic authority remains valid; a new snapshot, new semantic target discovery or invalidation may expire them. This is partial reuse of grounded targets, not an automatic persistent cross-page cache.

The CLI and MCP have `semantic_locate_batch`, `semantic_compare_batch`, `semantic_assert_batch` (MCP prefix `browser_`). For comparison/assertion, send `{requests: [{actual: {description: "Plan"}, expected: "Professional annual"}, ...], minConfidence?, minSourceConfidence?, scope?, timeoutMs?}`. Locator objects cannot cross JSON boundaries; use descriptions or current refs there. The wire result is `{results, usage}`; usage is aggregate for the entire batch and should be counted once. Per-item SDK usage remains repeated for shape compatibility.

Source selection criteria refer to complete evidence in shared `state.page.sources`; candidate metadata is not copied N times. Transport chunks retain the same dependency depth. `models` lists reported model IDs from applicable source/comparison frontiers; `model` is present only when model attribution is complete and uniform. A missing model ID is not invented, and multiple models are not collapsed to the last one.

## Failure evidence

A resolved assertion failure throws `BrowserError` with `semantic: {results, expected}`. Results retain the actual evidence, verdict, source/comparison confidence and thresholds, freshness and any current evidence. Batch failures include independent successful items too. CLI, MCP and named sessions preserve this data without provider response bodies. Source-discovery no-match/ambiguity and structural errors may occur before there is any comparable result.

Error messages distinguish source uncertainty from comparison uncertainty. Caller request primitives are copied before asynchronous work, so mutating an expected value during inference cannot rewrite the diagnostic. Treat error/attachment payloads as sensitive application data, not public telemetry.

## 3. Caller / application oracle

When the application has a stronger source of truth, use it.

Examples include:

- a Playwright assertion over a stable application identifier;
- a test-only API/database fixture;
- a caller-supplied `run().expect` or SDK `until`.

Jev Browser does not reinterpret a caller oracle. A semantic assertion may complement an application oracle, but it does not replace one when exact business truth is available.

## Grounded semantic targets

```ts
const target = await browser.locateSemantic(
  'The control that manages the current subscription',
  { minConfidence: 0.8 },
);

await browser.native({ command: 'click', ref: target.ref });
```

`locateSemantic` returns the real current snapshot ref plus evidence and confidence. It does not generate CSS/XPath selectors or executable JavaScript.

The ref is short-lived authority over the current observed node. Existing staleness and node-identity checks apply before execution.

## Deterministic short-circuit

Only literal equality of the grounded actual value and the expected value skips semantic comparison. Displayed text evidence preserves its visible spacing; accessible names and context summaries remain compact descriptions, not rewritten actual values. Compatibility glyphs, superscripts/subscripts, and whitespace differences are not rewritten into an automatic pass. Jev receives the original captured evidence to judge their meaning in context. For example, `10²` versus `102` requires a semantic decision, as does `H₂O` versus `H2O`; no equation or synonym rules are introduced.

```ts
const target = await browser.locateSemantic('The Manage plan control');

const result = await browser.compareSemantic({
  actual: target,
  expected: 'Manage plan',
});

// No additional semantic comparison request is needed.
```

The goal is reliable end-to-end work, not the fewest Jev calls. Jev owns semantic interpretation; local code owns observed identities, literal copying, caller thresholds and browser effects. Independent questions are dispatched together without ranking away candidates or replacing them with site-specific rules. An additional clear semantic question is preferable to a growing dictionary of UI guesses.

Structured extraction and semantic verification share the same bounded parallel transport. Extraction retains each record's own candidates and complete context; independent chunks at the same dependency level overlap. A failed or invalid response aborts its siblings and drains their completion before returning. This cancels cooperative client work, not already performed server inference or billing. Custom decision engines must honor their `AbortSignal`. Received token usage is retained even when another chunk fails.

## Batch comparison and decision frontiers

Independent semantic assertions share provider frontiers.

```ts
const results = await browser.compareSemanticBatch([
  {
    actual: { description: 'Current plan' },
    expected: 'Professional annual plan',
  },
  {
    actual: { description: 'Billing state' },
    expected: 'Paid',
  },
  {
    actual: { description: 'Renewal state' },
    expected: 'Will renew automatically',
  },
]);
```

For independent description-based comparisons, the normal dependency shape is:

1. one source-discovery frontier;
2. one semantic-comparison frontier.

Adding more independent assertions therefore increases questions before it increases `serialDecisionDepth`.

Transport limits still apply: at most 64 questions and 128 KiB per provider request. Multiple transport chunks at the same dependency level run concurrently and count as one serial decision depth.

## Speed measurements

Semantic results expose diagnostic timing rather than a single “AI latency” number:

- `requests`: actual provider requests;
- `questions`: semantic questions;
- `serialDecisionDepth`: dependency waves that had to wait for one another;
- `providerMs`: wall time spent waiting on Jev frontiers;
- `observationMs`: browser observation time for this semantic operation;
- `verificationMs`: local semantic-result processing excluding provider wait;
- input/output token usage when the provider reports it.

For `compareSemanticBatch()`, the same aggregate `usage` object is attached to every returned item for result-shape consistency. It describes the whole batch and must be counted once rather than summed across results.

These values are measurements, not billing estimates. Public benchmark claims should compare complete tasks under disclosed model, cache, browser, and oracle conditions.

## Privacy

A semantic comparison necessarily sends its caller-supplied expected meaning to the configured Jev endpoint. A description used for semantic source discovery is also sent.

Named goal input values are still withheld from ordinary goal binding as documented elsewhere. Choosing semantic comparison for a literal secret is an explicit decision to expose that expected text to the semantic provider.

The grounded page evidence selected for comparison is also provider-visible. Use deterministic assertions when a sensitive value can be checked locally.

## Calibration

Jev Browser's real-provider semantic fixtures record:

- expected ground-truth direction;
- Jev choice;
- final confidence;
- source confidence;
- threshold outcome;
- candidate-order variants;
- model identity and usage;
- serial depth and elapsed time.

Reports group outcomes by confidence range and distinguish false positives, false negatives, and inconclusive results. They do not redefine raw confidence as a probability of correctness.

Synthetic fixture success is regression evidence, not a claim of universal website accuracy.
