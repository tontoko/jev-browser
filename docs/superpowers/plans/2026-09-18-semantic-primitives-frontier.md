# Semantic Primitives and Decision Frontier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add grounded semantic locate/compare/assert primitives and a reusable Jev decision-frontier executor that minimizes serial provider depth without weakening deterministic Playwright verification.

**Architecture:** A new `frontier.ts` owns only batching/chunking/validation/usage for independent ready questions. A new `semantic.ts` owns grounded evidence discovery, deterministic short-circuiting, confidence-thresholded semantic comparison, and assertion conversion. `JevBrowser` remains the single SDK core; CLI/MCP are thin command adapters over the same methods.

**Tech Stack:** TypeScript 7, Node.js 22+, Playwright 1.63, TypeSafe/Jev SDK through the existing `DecisionEngine`, Zod 4, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-18-semantic-primitives-frontier-design.md` (within the architecture in `docs/superpowers/specs/2026-09-18-semantic-runtime-architecture-design.md`)

## Global Constraints

- Public shipped material remains pure OSS and must not mention private adopters/applications.
- Playwright remains the only browser execution primitive.
- Jev may select grounded candidates or compare grounded evidence; it never generates executable selectors/JavaScript.
- Deterministic/local equality is attempted before semantic comparison.
- Low confidence and insufficient evidence never pass.
- Raw Jev confidence is a thresholded decision score, not a correctness probability.
- No generic workflow DAG, second planner model, site-specific scripts, or new runtime dependency.
- Browser mutation retry policy, existing policy hooks, resource ownership, cancellation, and exact/native assertions remain unchanged.

---

### Task 1: Shared decision frontier and usage accounting

**Files:**
- Create: `src/frontier.ts`
- Modify: `src/types.ts`
- Modify: `src/runner.ts`
- Test: `test/frontier.test.mjs`
- Test: `test/goal-provider.test.mjs`

**Interfaces:**
- Produces `DecisionUsage` with `requests`, `questions`, `serialDecisionDepth`, `inputTokens`, `outputTokens`, `providerMs`.
- Produces `decideFrontier(engine, request, options): Promise<DecisionResult>`.
- `runGoal` consumes the frontier helper instead of its private sequential transport loop, preserving `maxDecisions` semantics as a cap on actual provider requests.

- [ ] **Step 1: Write failing frontier tests**

Add cases proving that 130 independent questions are split into three provider requests but invoked concurrently as one semantic dependency depth; every answer is mapped back to the original ID; unknown/missing answers fail; abort prevents provider work; request count/usage is exact.

```js
test('frontier: transport chunks share one serial dependency depth', async () => {
  let active = 0, peak = 0;
  const engine = { async decide(request) {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 20));
    active--;
    return { answers: Object.fromEntries(Object.keys(request.questions).map(id => [id, { choice: 'yes', confidence: 1 }])), model: 'fixture' };
  }};
  const usage = emptyDecisionUsage();
  const questions = Object.fromEntries(Array.from({ length: 130 }, (_, i) => [`q${i}`, { type: 'choice', instructions: 'Pick yes', criteria: { yes: 'yes' } }]));
  const result = await decideFrontier(engine, { state: { task: 'fixture' }, questions }, { signal: new AbortController().signal, usage });
  assert.equal(Object.keys(result.answers).length, 130);
  assert.equal(usage.requests, 3);
  assert.equal(usage.questions, 130);
  assert.equal(usage.serialDecisionDepth, 1);
  assert.ok(peak > 1);
});
```

- [ ] **Step 2: Run frontier tests and verify RED**

Run: `npm run build && node --test test/frontier.test.mjs`

Expected: FAIL because `frontier.ts` / exported usage helpers do not exist.

- [ ] **Step 3: Implement minimal frontier**

Implement:

```ts
export interface DecisionUsage {
  requests: number;
  questions: number;
  serialDecisionDepth: number;
  inputTokens: number;
  outputTokens: number;
  providerMs: number;
}

export function emptyDecisionUsage(): DecisionUsage;

export async function decideFrontier(
  engine: DecisionEngine,
  request: DecisionRequest,
  options: {
    signal: AbortSignal;
    usage: DecisionUsage;
    maxRequests?: number;
    maxRetries?: number;
  },
): Promise<DecisionResult>;
```

Partition by <=64 questions and <=128 KiB serialized request; a single oversize question throws `OBSERVATION_LIMIT`. Validate every returned choice against its offered criteria and confidence in `[0,1]`. Launch independent chunks with `Promise.all`; increment `serialDecisionDepth` once before the wave, `requests` by chunk count, and `providerMs` by elapsed wall time for the whole frontier. Fail before launching if the request budget cannot cover all chunks.

- [ ] **Step 4: Run frontier tests and verify GREEN**

Run: `npm run build && node --test test/frontier.test.mjs`

Expected: all frontier cases PASS.

- [ ] **Step 5: Move `runGoal` onto the shared frontier**

Replace the private question-chunk loop with `decideFrontier`. Keep `decisionRetries`, `maxDecisions`, result metadata, and existing provider error wrapping. Extend `RunResult.usage` with optional/new timing/depth fields without removing existing fields.

- [ ] **Step 6: Verify existing goal provider behavior**

Run: `node --test test/goal-provider.test.mjs test/goal.test.mjs test/goal-integrity.test.mjs`

Expected: all PASS and provider request budgets remain enforced.

- [ ] **Step 7: Commit**

```bash
git add src/frontier.ts src/types.ts src/runner.ts test/frontier.test.mjs test/goal-provider.test.mjs
git commit -m "feat: add shared parallel Jev decision frontier"
```

---

### Task 2: Grounded semantic evidence and `locateSemantic`

**Files:**
- Create: `src/semantic.ts`
- Modify: `src/types.ts`
- Modify: `src/browser.ts`
- Modify: `src/index.ts`
- Test: `test/semantic.test.mjs`

**Interfaces:**
- Produces `SemanticEvidence`, `SemanticTarget`, `SemanticLocateOptions`.
- Produces `JevBrowser.locateSemantic(description, options)`.
- Consumes `decideFrontier` for one grounded source/target-selection frontier.

- [ ] **Step 1: Write failing locate tests**

Cover unique semantic text, actionable element selection, ambiguity, no-match, below-threshold selection, reversed candidate order, scope, and stale/foreign ref rejection. Assert the returned target contains a short-lived real ref/evidence rather than generated selector text.

```js
test('semantic locate: returns the actual grounded element ref and evidence', async t => {
  const { core, page, decider } = await fixture(t, '<button>Archive order</button><button>Refund order</button>', ...);
  const target = await core.locateSemantic('The control that archives the order');
  assert.match(target.ref, /^r[0-9a-f]+_e/);
  assert.equal(target.evidence.text, 'Archive order');
  assert.equal(target.evidence.role, 'button');
  assert.equal(decider.requests.length, 1);
});
```

- [ ] **Step 2: Run locate tests and verify RED**

Run: `npm run build && node --test --test-name-pattern="semantic locate" test/semantic.test.mjs`

Expected: FAIL because `locateSemantic` does not exist.

- [ ] **Step 3: Implement semantic source inventories**

In `semantic.ts`, derive bounded candidate objects from observed `Snapshot.texts` and `Snapshot.elements`. Element evidence uses accessible name as `text`, context/role/frame from observation, and source ID equal to the real snapshot ref. Text evidence preserves its original source ID. No literal expected value is needed for locate.

Add types:

```ts
export interface SemanticEvidence {
  sourceId: string;
  frame: number;
  role: string;
  text: string;
  context: string;
  attribute?: string;
  value?: string | number | boolean;
}

export interface SemanticTarget {
  ref: string;
  snapshotId: string;
  confidence: number;
  evidence: SemanticEvidence;
}
```

- [ ] **Step 4: Implement `JevBrowser.locateSemantic`**

Validate description and `minConfidence` (`0..1`, default `0.8`) before observation. Capture once with existing scope/limits. Refuse truncated relevant inventories rather than guessing. Ask one choice question with `__none__` / `__ambiguous__`; validate threshold. Retain the capture as `snapshotCapture` so the returned element ref can be consumed by existing native commands until invalidated normally.

- [ ] **Step 5: Run locate tests and verify GREEN**

Run: `npm run build && node --test test/semantic.test.mjs`

Expected: locate cases PASS.

- [ ] **Step 6: Commit**

```bash
git add src/semantic.ts src/types.ts src/browser.ts src/index.ts test/semantic.test.mjs
git commit -m "feat: locate grounded semantic evidence"
```

---

### Task 3: Semantic compare, assert, and batch frontiers

**Files:**
- Modify: `src/semantic.ts`
- Modify: `src/types.ts`
- Modify: `src/browser.ts`
- Test: `test/semantic.test.mjs`
- Test: `test/semantic-batch.test.mjs`

**Interfaces:**
- Produces `SemanticChoice`, `SemanticComparisonResult`, `SemanticComparisonRequest`.
- Produces `compareSemantic`, `compareSemanticBatch`, `assertSemantic` SDK methods.
- Consumes `SemanticTarget` or `{ description: string }` as grounded actual sources.

- [ ] **Step 1: Write failing comparison truth-table tests**

Cover:

```js
['equivalent', 0.95, 0.8, 'passed'],
['different', 0.95, 0.8, 'failed'],
['equivalent', 0.70, 0.8, 'inconclusive'],
['different', 0.70, 0.8, 'inconclusive'],
['insufficient_evidence', 1.0, 0.8, 'inconclusive']
```

Assert `assertSemantic` throws `SEMANTIC_ASSERTION_FAILED` or `SEMANTIC_ASSERTION_INCONCLUSIVE` exactly. Add invalid threshold cases that prove zero provider calls.

- [ ] **Step 2: Write failing deterministic short-circuit test**

Ground actual evidence whose normalized text is exactly expected; assert `source === 'deterministic'`, `status === 'passed'`, and provider request count is zero.

- [ ] **Step 3: Write failing batch-depth/evidence-isolation tests**

For 10 independent description-based assertions, assert source selection is one frontier and comparison is one frontier (`serialDecisionDepth === 2`), while every comparison question contains only its own selected evidence/expected pair. Reverse source ordering and ensure results remain mapped to original request indexes.

- [ ] **Step 4: Run semantic compare tests and verify RED**

Run: `npm run build && node --test test/semantic.test.mjs test/semantic-batch.test.mjs`

Expected: FAIL because compare/assert methods do not exist.

- [ ] **Step 5: Implement result classification and deterministic normalization**

Use a conservative local normalization (Unicode NFKC, collapsed whitespace, trim) for exact textual equality only. Do not add fuzzy string matching. If equal, return deterministic pass without Jev.

Define:

```ts
type SemanticChoice = 'equivalent' | 'different' | 'insufficient_evidence';
type SemanticAssertionStatus = 'passed' | 'failed' | 'inconclusive';
```

- [ ] **Step 6: Implement batch source discovery and comparison**

Batch all unresolved source questions in one `decideFrontier`; then batch all unresolved semantic comparisons in a second `decideFrontier`. Comparison state contains the selected grounded `actual` evidence and caller-provided `expected`; no other page sources are candidates at this stage. Map each answer back by stable request index.

`compareSemantic` delegates to a one-item batch. `assertSemantic` delegates to compare and throws only after the structured result is available.

- [ ] **Step 7: Verify GREEN and cancellation**

Run: `npm run build && node --test test/semantic.test.mjs test/semantic-batch.test.mjs`

Expected: all PASS, including cancellation between source and comparison frontiers.

- [ ] **Step 8: Commit**

```bash
git add src/semantic.ts src/types.ts src/browser.ts test/semantic.test.mjs test/semantic-batch.test.mjs
git commit -m "feat: add confidence-aware grounded semantic assertions"
```

---

### Task 4: CLI/MCP thin adapters

**Files:**
- Modify: `src/commands.ts`
- Modify: `src/cli.ts`
- Modify: `src/mcp.ts`
- Test: `test/semantic-adapters.test.mjs`
- Modify: `scripts/check-package.mjs`

**Interfaces:**
- Produces read-only commands `semantic_locate`, `semantic_compare`, `semantic_assert`.
- MCP exposes `browser_semantic_locate`, `browser_semantic_compare`, `browser_semantic_assert` through existing generic registration.

- [ ] **Step 1: Write failing command-schema and adapter tests**

Use JSON shapes:

```json
{"command":"semantic_locate","description":"The paid status","minConfidence":0.8}
{"command":"semantic_compare","actual":{"description":"Current plan"},"expected":"Professional annual plan","minConfidence":0.8}
{"command":"semantic_assert","actual":{"ref":"ref:..."},"expected":"Paid","minConfidence":0.9}
```

Assert all three commands are read-only, CLI returns structured result, MCP annotations use `readOnlyHint: true`, and assertion failure is surfaced as an MCP/tool error rather than a success envelope.

- [ ] **Step 2: Run adapter tests and verify RED**

Run: `npm run build && node --test test/semantic-adapters.test.mjs`

Expected: unknown command/tool failures.

- [ ] **Step 3: Implement schemas and dispatch**

Add Zod schemas in `commands.ts`; do not add a second semantic engine. `executeCommand` calls the SDK methods. Add help examples to CLI. Generic MCP registration should require no semantic-specific execution branch beyond normal structured result/error handling.

- [ ] **Step 4: Extend installed-package verification**

Make the synthetic provider return grounded semantic choices. Install the actual tarball and prove at least one semantic compare/assert through installed SDK, CLI, and official MCP stdio. Keep provider synthetic in package tests.

- [ ] **Step 5: Verify adapters/package**

Run:

```bash
npm run build
node --test test/semantic-adapters.test.mjs
npm run check:examples
npm run check:package
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/commands.ts src/cli.ts src/mcp.ts test/semantic-adapters.test.mjs scripts/check-package.mjs
git commit -m "feat: expose semantic assertions through CLI and MCP"
```

---

### Task 5: Real-Jev semantic calibration and latency evidence

**Files:**
- Create: `test/live-semantic.mjs`
- Modify: `package.json`
- Create: `docs/semantic-verification.md`
- Modify: `README.md`
- Modify: `README.ja.md`
- Modify: `docs/api.md`
- Modify: `docs/verification.md`
- Modify: `SECURITY.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- `npm run test:live:semantic` runs only product-neutral synthetic pages with a real Jev credential.
- Public docs distinguish deterministic/local, semantic/Jev, and caller/Playwright verification.

- [ ] **Step 1: Add real-Jev fixture matrix**

Include exact deterministic matches, English paraphrases, multilingual equivalents, near-miss contradictions, explicit insufficient context, indirect UI state, and candidate-order reversals. Each case has a local ground-truth label unknown to Jev. Log choice, confidence, threshold result, model, usage, serial depth, and elapsed time.

- [ ] **Step 2: Run the live matrix**

Run:

```bash
JEV_TEST_ENV=/absolute/path/to/a/local-ignored-env-file
node --env-file="$JEV_TEST_ENV" --test --test-concurrency=1 --test-timeout=120000 test/live-semantic.mjs
```

`JEV_TEST_ENV` is local execution infrastructure only. Its resolved path is never committed or copied into public docs/output fixtures.

Expected: fixture assertions pass; retain raw TAP/JSON evidence outside the repository for release evidence.

- [ ] **Step 3: Document contracts and confidence correctly**

Public docs must state:

- `minConfidence` defaults to 0.8 and is configurable;
- confidence is not a probability of correctness;
- exact/local checks avoid Jev;
- semantic outcomes include evidence and can be inconclusive;
- `assertSemantic` fails closed on inconclusive;
- named expected literals used for semantic comparison are sent to the Jev provider by explicit caller choice;
- deterministic Playwright/native assertions remain the preferred oracle when exact truth is available.

Use neutral accounts/orders/invoices/subscriptions/reservations examples only.

- [ ] **Step 4: Review public documentation for OSS-only terminology**

Run:

```bash
git diff origin/main -- README.md README.ja.md docs SECURITY.md CHANGELOG.md package.json
```

Expected: examples and terminology are limited to neutral OSS scenarios such as accounts, orders, invoices, subscriptions, contacts, and reservations; no private adopter/application context appears.

- [ ] **Step 5: Commit**

```bash
git add test/live-semantic.mjs package.json README.md README.ja.md docs/api.md docs/verification.md docs/semantic-verification.md SECURITY.md CHANGELOG.md
git commit -m "docs: publish semantic verification contract and calibration harness"
```

---

### Task 6: Full regression, cross-platform PR, and release candidate evidence

**Files:**
- No behavior files unless a regression is found; every regression fix requires a new failing test first.
- Update release/version files only after behavior is green.

**Interfaces:**
- Produces a mergeable feature PR and a release candidate with exact-source evidence.

- [ ] **Step 1: Run complete local verification**

Run:

```bash
npm run check
npm run check:examples
npm run check:package
npm audit --omit=dev --json
```

Expected: all tests/checks PASS; runtime vulnerability count 0 at verification time.

- [ ] **Step 2: Re-run real Jev semantic and core live suites on the exact candidate source**

Run explicit `test:live:semantic` plus existing live suites needed to prove `act/extract/run` were not regressed. Record raw logs outside the repo.

- [ ] **Step 3: Open PR and require six-platform CI**

PR body reports exact commit, deterministic counts, real-provider counts, semantic confidence bucket evidence, package checks, and honest boundaries. Do not present regression fixtures as unseen-site accuracy.

- [ ] **Step 4: Merge only after exact-head CI green**

Verify Linux Node 22/24 Chromium, Linux Firefox/WebKit, macOS Chromium, Windows Chromium. After squash merge, prove merge commit has the identical Git tree as tested head and require post-merge main CI green before public release.

- [ ] **Step 5: Publish release evidence**

Attach tarball, SHA256 sums, machine-readable verification summary, and raw semantic live evidence. Public release notes remain product-neutral and distinguish deterministic/semantic/caller verification.
