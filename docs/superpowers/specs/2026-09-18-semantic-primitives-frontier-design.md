# Semantic Primitives and Decision Frontier — Slice A

## Goal

Ship the first independently useful part of the semantic runtime: grounded semantic locate/compare/assert primitives plus a small frontier batching layer that improves latency without weakening deterministic verification.

## User-facing behavior

### `locateSemantic`

```ts
const target = await browser.locateSemantic(
  'The result row for the account ending in 0421',
  { minConfidence: 0.8 },
);
```

It selects one grounded observed target/evidence source. It returns confidence and evidence. It does not invent or return arbitrary selector text.

When no unique candidate is supported, it returns/throws an explicit no-match or ambiguity result. Low confidence is inconclusive rather than silently selecting a target.

### `compareSemantic`

```ts
const result = await browser.compareSemantic({
  actual: target,
  expected: 'Professional annual plan',
  minConfidence: 0.8,
});
```

If actual text/value equals expected under an existing deterministic normalization, return a deterministic pass with no Jev call. Otherwise Jev gets only the grounded actual evidence, expected semantic value, and the three comparison choices.

### `assertSemantic`

```ts
await browser.assertSemantic({
  actual: { description: 'Current subscription status' },
  expected: 'Active and paid',
  minConfidence: 0.9,
});
```

If `actual` is a description rather than an existing target, source discovery happens first. The assertion passes only on `equivalent` at or above threshold. `different` at/above threshold fails. Low confidence or insufficient evidence is inconclusive and throws a distinct error.

## Exact result contract

```ts
type SemanticChoice = 'equivalent' | 'different' | 'insufficient_evidence';
type SemanticAssertionStatus = 'passed' | 'failed' | 'inconclusive';

interface SemanticComparisonResult {
  status: SemanticAssertionStatus;
  choice: SemanticChoice;
  confidence: number;
  threshold: number;
  source: 'deterministic' | 'semantic';
  evidence: SemanticEvidence;
  model?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}
```

`minConfidence` accepts finite numbers in `[0,1]`; default `0.8`. Documentation calls it a confidence threshold, never a correctness probability.

## Evidence selection

A semantic description is resolved against observed sources, not arbitrary page prose. Candidate classes initially include:

- semantic text sources already used by extraction;
- read-only record field evidence;
- actionable elements when locating a target.

The selection question includes `__none__` and `__ambiguous__`. The runtime validates that returned choice IDs are among offered candidates.

`locateSemantic` target identity uses the same current-element authority/staleness checks as existing grounded actions. Phase A does not synthesize a CSS/XPath selector and does not mutate the page to attach a private attribute.

## Decision frontier primitive

Create one small internal primitive that accepts already-constructed independent questions and handles:

- maximum 64 questions per provider request;
- maximum 128 KiB request payload;
- cancellation;
- answer membership validation;
- usage aggregation;
- one increment of `serialDecisionDepth` for one logical ready frontier, even if transport-size limits require multiple parallel/chunked requests at that same dependency depth.

It is not responsible for browser planning, effects, retries, persistence, or dependency discovery. Callers decide which questions are ready.

Existing code may migrate to the primitive only where the behavior is equivalent and tests prove no changed authority boundary. Do not rewrite every decision path merely for architectural purity.

## Batching semantic assertions

The SDK supports one assertion and a batch form:

```ts
const results = await browser.compareSemanticBatch([
  { actual: { description: 'Plan' }, expected: 'Professional annual plan' },
  { actual: { description: 'Billing status' }, expected: 'Paid' },
], { minConfidence: 0.8 });
```

Batch algorithm:

1. observe once;
2. deterministic short-circuit any already-grounded exact comparisons;
3. put unresolved source-selection questions into one frontier;
4. validate unique grounded sources;
5. put unresolved semantic-comparison questions into one frontier;
6. map each answer back to its own source/expected pair;
7. never let one assertion borrow another assertion's evidence.

For N independent unresolved assertions, target semantic serial depth is <= 2 after observation, subject to no browser state change between stages.

## Error model

- `SEMANTIC_NO_MATCH`: no grounded actual source/target.
- `SEMANTIC_AMBIGUOUS`: multiple indistinguishable sources/targets.
- `SEMANTIC_ASSERTION_FAILED`: `different` at/above threshold.
- `SEMANTIC_ASSERTION_INCONCLUSIVE`: insufficient evidence or below-threshold directional decision.
- existing cancellation/provider errors remain unchanged.

`compareSemantic*` is non-throwing for semantic failed/inconclusive outcomes but still throws structural/runtime errors. `assertSemantic` converts semantic failed/inconclusive outcomes to the two assertion errors above.

## Metrics

Add a reusable usage accumulator with at least:

```ts
{
  requests,
  questions,
  serialDecisionDepth,
  inputTokens,
  outputTokens,
  providerMs,
  observationMs,
  verificationMs,
}
```

Existing `run()` result metrics may gain fields without removing current fields. Exact attribution is best-effort and documented. The key invariant is that serial frontier depth is not inflated merely because one ready frontier was chunked for transport limits.

## Verification strategy

### Deterministic tests

- exact actual/expected match performs zero provider requests;
- equivalent/high-confidence passes;
- different/high-confidence fails;
- equivalent below threshold is inconclusive;
- different below threshold is inconclusive;
- insufficient evidence is inconclusive even with confidence 1;
- invalid thresholds fail before observation/provider work;
- candidate-order reversal does not silently change a unique result;
- ambiguous sources fail before comparison;
- two assertion fields cannot cross-use evidence;
- N batch assertions use source and comparison frontiers rather than O(N) serial calls;
- cancellation after source selection prevents the comparison frontier;
- literal private named inputs are not introduced into unrelated semantic requests.

### Real Jev fixtures

Use only synthetic, product-neutral pages and locally known oracles. Include:

- multilingual semantic equivalents;
- paraphrases;
- near-miss/contradiction pairs;
- insufficient-context pairs;
- semantic state expressed indirectly by UI copy;
- exact matches that must short-circuit locally;
- candidate-order variants.

Report confusion counts and inconclusive counts by confidence bucket. Do not describe confidence as calibrated probability.

### Speed checks

Record total operation time and frontier depth. A multi-field batch fixture should demonstrate that adding independent assertions increases questions before it increases serial depth. Any public comparison with another tool is a separate benchmark and must disclose configuration/model/cache/oracle conditions.

## CLI and MCP

After SDK semantics are stable:

- CLI command `semantic_assert` accepts JSON args, returns the full comparison result, and exits nonzero for failed or inconclusive assertion mode.
- MCP tool `browser_semantic_assert` uses the same shared command/core path.
- A non-throwing semantic comparison tool may be added if clients need inspection rather than assertion, but do not duplicate the semantic engine.

## Documentation constraints

README and docs explain the three verification sources clearly:

- deterministic/local;
- semantic/Jev with confidence threshold;
- caller/Playwright oracle.

No public shipped material mentions private adopters or uses adopter-specific scenarios. Examples use neutral accounts, orders, invoices, contacts, subscriptions, and reservations.

## Slice A completion criteria

Slice A is releasable only when:

- deterministic and semantic assertion contracts are distinct in types and docs;
- grounded evidence is returned for every semantic result;
- low confidence can never pass;
- exact deterministic cases avoid Jev;
- batch assertions show bounded serial frontier depth;
- SDK/CLI/MCP use the same semantic core;
- existing `act/observe/extract/run`, native assertions, policy hooks, cancellation, and package checks remain green;
- cross-platform CI and explicit real-Jev synthetic fixtures pass on the release source.
