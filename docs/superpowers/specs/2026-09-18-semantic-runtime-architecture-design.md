# Jev Browser Semantic Runtime Architecture

## Purpose

Jev Browser should be a pure OSS browser automation runtime that combines three properties that are usually split across tools:

1. Stagehand-class programmability: grounded `act`, `observe`, typed `extract`, and multi-step `run` from one SDK/CLI/MCP core.
2. Jev-class latency: exploit independent System One questions in parallel, avoid serial model round-trips, and never ask AI to solve a deterministic browser problem.
3. Playwright-class verification: browser effects execute through Playwright, exact facts are checked locally, and AI-derived judgments remain explicitly identified as semantic evidence rather than silently becoming deterministic truth.

The public repository, package, README, docs, examples, release notes, benchmark fixtures, and API names must remain product-neutral. They must not mention private adopters, internal applications, or adopter-specific terminology. Adopter experiments may exist outside release branches but are not merged or shipped.

## Product position

Jev Browser is not only a fast browser agent and not only a Playwright MCP/CLI clone. Its core promise is:

> Parallel semantic decisions, deterministic browser effects, and explicit verification provenance.

The runtime should support the same high-level work through TypeScript SDK, persistent CLI, and MCP without separate agent implementations.

## Non-negotiable invariants

- Playwright remains the browser execution primitive.
- Jev selects only grounded candidates or compares grounded evidence. It never generates executable JavaScript, arbitrary selectors, or hidden workflow code.
- Literal named input values remain local unless a caller explicitly chooses an API that requires semantic comparison of that literal.
- Deterministic equality, normalization, browser state, and schema validation happen locally before a model call is considered.
- Browser mutations remain serial within one task lane. Decision questions may be parallel; effects do not race.
- Unknown mutations are never automatically replayed.
- Model confidence is a decision score, not a calibrated probability of correctness.
- Exact/caller assertions remain available and are never weakened by semantic assertions.
- Explicit caller scope, policy hooks, cancellation, budgets, and resource ownership continue to apply.
- No generic DAG engine, site-specific workflow DSL, mandatory second planning model, or duplicate browser selector engine.

## Architecture layers

### 1. Observation and grounded evidence

Observation continues to produce actual controls, semantic text sources, records, regions, frame identity, and execution refs. The runtime may narrow a crowded page to a real semantic region, but it must not silently discard candidates and pretend the inventory was complete.

A common evidence type represents any semantic source that can be used by extraction or assertions:

```ts
interface SemanticEvidence {
  sourceId: string;
  frame: number;
  role: string;
  text: string;
  context: string;
  attribute?: string;
  value?: string | number | boolean;
}
```

Evidence identity is separate from the expected value. The model may select the source; local code copies and validates the actual source value.

### 2. Decision frontier

The runtime maintains only the set of semantic questions that are answerable from the current observation. Independent questions on the same frontier are sent together. Questions that depend on a browser effect or on an earlier answer wait for the next frontier.

Examples from one observed form:

- bind `customer.name` to a control;
- bind `customer.email` to a control;
- classify visible Save as advance/commit/forbidden;
- identify an optional caller-requested setting.

These belong to one frontier. A region or popup that does not exist until after an action belongs to a later frontier.

This is not a general planner. It is a bounded batching primitive over existing typed Jev questions.

### 3. Local interpretation

After Jev selects a source or candidate, local code owns truth-preserving interpretation:

- exact string/boolean equality;
- locale-safe numeric/currency normalization when already supported;
- native control state and option identity;
- schema parsing without defaults/fallback invention;
- caller-authored Playwright assertions.

A semantic model call is skipped whenever these operations settle the comparison exactly.

### 4. Semantic comparison

When literal equality is not enough, Jev may compare grounded actual evidence against an expected meaning. Semantic comparison has exactly three choices:

- `equivalent`
- `different`
- `insufficient_evidence`

The caller supplies `minConfidence`. The initial ergonomic default is `0.8`, but documentation must say this is a decision threshold, not “80% probability of correctness.”

Rules:

- `equivalent` with confidence >= threshold -> passed;
- `different` with confidence >= threshold -> failed;
- either directional choice below threshold -> inconclusive;
- `insufficient_evidence` -> inconclusive regardless of confidence.

The result always retains the grounded evidence, selected choice, model confidence, threshold, and model/usage metadata when available.

### 5. Semantic target

A semantic target is a grounded, refreshable browser target selected from current observation. Phase 1 does not claim to convert every semantic target into a raw Playwright `Locator`: Playwright Locators encode retrieval logic, while an observed ref identifies a concrete current element. Returning a fake or brittle selector would weaken the design.

Instead:

```ts
interface SemanticTarget {
  readonly evidence: SemanticEvidence;
  readonly confidence: number;
  refresh(): Promise<SemanticTarget>;
}
```

SDK users still retain the genuine `Page`. A future `asLocator()` may be added only for cases where a deterministic unique Playwright locator can be constructed and revalidated; it is not required for the first slice.

### 6. Verified goal ledger

`run()` evolves from “one save then finish” into a task that can accumulate independently verified checkpoints.

A checkpoint is created only after an effect has independent evidence:

```ts
interface GoalCheckpoint {
  id: string;
  effectId: string;
  verification: RunVerification;
  inputs: string[];
  resultRecordId?: string;
  effectContext: string;
}
```

Checkpoint verification is not final-goal verification. A task may create one object, attach it somewhere, then create a reservation; the caller's final `expect` is evaluated only when the whole requested goal is at its final boundary.

The runtime may ask Jev whether verified work leaves another requested stage, but that model answer never retroactively creates or validates a checkpoint.

### 7. Continuation

A stopped run may return a session-local continuation ID. The first version supports continuation only inside the same SDK instance / persistent CLI session / MCP server session. No cross-process durable workflow store is added initially.

Continuation state contains:

- original instruction;
- local input bindings (not exposed in result JSON);
- verified checkpoints;
- unresolved inputs;
- pending unknown effect, if any;
- budgets and verification requirements.

`resume(id, { values })` may add missing values. It must reject changes to input facts already covered by a verified checkpoint.

If a previous effect is `unknown`, resume performs read-only reconciliation first. If the result can be verified, it becomes a checkpoint and work continues. If not, the runtime remains `effect-unknown`; it does not press Save again.

## Public API direction

### Deterministic assertion

Existing native/Playwright assertions remain unchanged.

### Semantic comparison

Non-throwing primitive:

```ts
const result = await browser.compareSemantic({
  actual: { description: 'Current plan shown for this account' },
  expected: 'Professional annual plan',
  minConfidence: 0.8,
});
```

Result:

```ts
{
  status: 'passed' | 'failed' | 'inconclusive',
  choice: 'equivalent' | 'different' | 'insufficient_evidence',
  confidence: number,
  threshold: number,
  evidence: SemanticEvidence,
  source: 'deterministic' | 'semantic'
}
```

Throwing assertion:

```ts
await browser.assertSemantic({
  actual: { description: 'Current plan shown for this account' },
  expected: 'Professional annual plan',
  minConfidence: 0.8,
});
```

`failed` throws `SEMANTIC_ASSERTION_FAILED`; `inconclusive` throws `SEMANTIC_ASSERTION_INCONCLUSIVE`. A later option may allow callers to map inconclusive to a non-throwing test annotation, but the first API must not silently pass it.

### Semantic locate

```ts
const target = await browser.locateSemantic('The row for the account ending in 0421');
```

The first slice returns a `SemanticTarget`, not a model-generated selector. Target-dependent operations revalidate or refresh the semantic target before mutation.

### Goal continuation

```ts
const first = await browser.run(task, { values });
if (first.continuation) {
  const resumed = await browser.resume(first.continuation.id, {
    values: { missingField: 'value' },
  });
}
```

CLI and MCP expose the same contracts through thin adapters.

## Semantic assertion flow

A semantic assertion may require two decision frontiers:

1. source discovery: select the actual source for each assertion from grounded candidates;
2. semantic comparison: compare each selected actual value against its expected meaning.

For N independent semantic assertions over one observation, all N source questions share frontier 1 and all N comparison questions share frontier 2. The target serial decision depth is therefore <= 2, rather than 2N.

If the actual source is already supplied as a `SemanticTarget`, only frontier 2 is needed. If local equality already passes, no semantic frontier is needed.

## Speed model

Measure whole-task time instead of advertising one model call. `usage` grows explicit timing/depth fields:

```ts
interface RunUsage {
  requests: number;
  questions: number;
  serialDecisionDepth: number;
  inputTokens: number;
  outputTokens: number;
  providerMs: number;
  observationMs: number;
  browserEffectMs: number;
  waitingMs: number;
  verificationMs: number;
}
```

The implementation does not need nanosecond-perfect attribution. The metrics are diagnostic measurements with documented boundaries, not billing estimates.

Optimization order:

1. settle exact/local work without Jev;
2. narrow observation only when needed;
3. put all currently independent semantic questions in one frontier;
4. execute already-grounded browser effects without another decision;
5. wait locally on Playwright/browser state;
6. re-decide only invalidated semantics after a meaningful state change;
7. verify multiple fields in a batched source/comparison frontier.

## Initial performance acceptance criteria

These are controlled-fixture engineering targets, not universal site promises.

- A native form with N independent exact named fields must not require O(N) serial Jev requests. Field binding is one frontier regardless of N within request limits.
- A 1000-option native select with an exact named input must not send the complete option list to Jev.
- N independent semantic assertions over one record should need at most two semantic frontier depths after observation: source binding and comparison.
- Already-grounded exact equality must use zero semantic comparison requests.
- A verified checkpoint must not be semantically re-adjudicated on every later stage unless its evidence is invalidated.
- No optimization may turn ambiguity, truncation, or low confidence into a pass.

## Confidence and calibration

Semantic assertion fixtures must measure confidence buckets separately from correctness. Evaluation records:

- ground-truth label;
- Jev choice;
- confidence;
- threshold outcome;
- false-positive / false-negative / inconclusive result;
- model identity;
- candidate-order variation.

Calibration reports may say “on this fixture set, threshold X produced Y false-positive rate.” They must never redefine raw Jev confidence as a probability of correctness.

The evaluation set should contain exact matches, paraphrases, multilingual equivalents, near-misses, contradictory states, insufficient context, and cases that should have been handled deterministically instead of semantically.

## OSS benchmark discipline

Public fixtures use neutral domains such as contacts, accounts, orders, invoices, subscriptions, and reservations. They must not contain private application names, internal IDs, or customer data.

Tuning and evaluation cases are separated. Results from known regression fixtures are labeled regression results. Any comparison with Stagehand, Playwright MCP/CLI, Browser Use, or other agents must use the same task, application oracle, model/config disclosure, cache conditions, and total task latency. Single fastest calls are not presented as end-to-end superiority.

## Phased implementation

### Slice A — semantic primitives and decision frontier

- shared grounded evidence binding;
- `compareSemantic` / `assertSemantic`;
- `locateSemantic` returning `SemanticTarget`;
- internal frontier batching and serial-depth/timing metrics;
- extraction/source selection migrated to the same frontier primitive where doing so reduces duplication;
- SDK first, then thin CLI/MCP adapters;
- calibration/regression fixtures.

This slice is independently releasable and does not change `run()` into a multi-commit workflow.

### Slice B — verified checkpoints and continuation

- checkpoint ledger;
- multiple independent verified commits in one `run()`;
- final assertion separated from checkpoint verification;
- session-local continuation and `resume()`;
- unknown-effect read-only reconciliation;
- SDK/CLI/MCP parity;
- duplicate-commit regression matrix.

This slice depends on Slice A's evidence and frontier primitives.

### Slice C — partial semantic reuse

Only after A/B are measured: retain semantic bindings whose observed authority still holds and re-decide invalidated bindings only. This is not a blind action cache. Past success is never execution authority, and current outcomes are still verified.

## Out of scope for this architecture

- arbitrary visual/Canvas understanding inside Jev;
- persistent distributed workflow orchestration;
- cross-machine continuation;
- autonomous recovery from an unknown mutation by retrying it;
- model-generated application code or selectors;
- replacing Playwright Test / its assertions;
- claiming raw confidence is calibrated probability;
- private-adopter-specific public documentation.
