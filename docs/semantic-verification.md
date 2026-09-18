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

The default `minConfidence` is `0.8` and accepts any finite value from `0` through `1`.

**Jev confidence is a decision score, not a calibrated probability that the assertion is correct.** A threshold of `0.8` means “accept this semantic decision only when the returned score is at least 0.8.” It does not mean “80% probability of correctness.”

```ts
{
  status: 'passed',
  choice: 'equivalent',
  confidence: 0.93,
  sourceConfidence: 0.94,
  threshold: 0.8,
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

They are intentionally not collapsed into one number. A semantic assertion passes only when every model-dependent link it relied on clears `minConfidence`: source selection and, when a semantic comparison call is needed, the comparison itself. A low source score therefore makes the result inconclusive even if the later comparison is high-confidence. Exact equality after a semantic source selection performs no second model call and is reported as a deterministic comparison, while the separate `sourceConfidence` still determines whether the overall result is conclusive.

Source binding still fails closed on an explicit no-match or ambiguity. The selected source is always returned so callers can inspect what was actually compared.

When a semantic source is selected and the actual value then matches the expected text exactly, there is no second Jev comparison. The comparison provenance is deterministic, `confidence` is `1`, and the separately retained `sourceConfidence` still has to clear the threshold for the overall result to pass.

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

If a grounded actual value equals the expected value after conservative NFKC/whitespace normalization, semantic comparison is skipped.

```ts
const target = await browser.locateSemantic('The Manage plan control');

const result = await browser.compareSemantic({
  actual: target,
  expected: 'Manage plan',
});

// No additional semantic comparison request is needed.
```

This is the general optimization rule:

1. settle exact/local work without Jev;
2. use Jev only for unresolved semantics;
3. execute browser effects with Playwright;
4. verify the outcome with the strongest available oracle.

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
