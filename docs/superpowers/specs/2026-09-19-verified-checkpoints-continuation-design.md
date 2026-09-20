# Verified Checkpoints and Session-local Continuation Design

## Goal

Extend `run()` from a single verified commit into a bounded multi-stage goal that can verify each committed stage, continue toward remaining requested work, and resume stopped work inside the same browser session without replaying an uncertain or already verified commit.

This is Slice B of `2026-09-18-semantic-runtime-architecture-design.md`. It reuses the grounded evidence and decision-frontier primitives shipped in v0.5.0. It does not add a generic workflow engine, persistent orchestration service, or model-authored plan graph.

## Public contract

### Checkpoints

Every independently verified commit can produce a checkpoint:

```ts
export interface GoalCheckpoint {
  id: string;
  effectId: string;
  verification: RunVerification;
  inputPaths: string[];
  resultRecordId?: string;
}
```

A checkpoint is evidence that one browser-side commit produced an observed result. It is not proof that the complete caller goal is finished.

`RunResult.checkpoints` is ordered by verified commit time.

### Continuation

A stopped or unverified run may expose:

```ts
export interface GoalContinuation {
  id: string;
  reason: RunResult['reason'];
  pendingEffect?: 'commit';
}
```

The opaque ID references state stored only inside the same `JevBrowser` instance. It contains no literal caller values.

```ts
const first = await browser.run(task, { values });
const second = await browser.resume(first.continuation!.id, {
  values: { missingField: 'value' },
});
```

Phase B supports same-process/session continuation only:

- SDK: same `JevBrowser` instance;
- CLI: same persistent named session;
- MCP: same running MCP server/core.

A fresh process cannot use the ID.

## Checkpoint verification versus final verification

These are separate facts.

A commit checkpoint can be created when:

1. a commit effect was attempted;
2. a fresh read-only result record is identified;
3. every displayed caller input chosen as evidence is copied from that record and compared locally;
4. there is at least one stable identity anchor;
5. Jev may classify whether more requested work remains, but that classification does not create the checkpoint.

The completion decision after a verified checkpoint has three choices:

- `final`: no requested work remains;
- `continue`: this commit is valid but the caller task requires another stage;
- `rejected`: the observed result is not a successful requested commit.

A `continue` result keeps the checkpoint and returns to the run loop. A `final` result reaches the final-verification boundary. A `rejected` result never becomes a checkpoint.

Caller `expect` assertions are final-goal assertions. They are not run at intermediate checkpoints. SDK `until` may still be polled because it is read-only and nonthrowing, but model completion never overrides a false caller condition.

## Stage inputs

All caller values are flattened once, but each commit has a current stage:

- `checkpointed`: covered by an earlier verified checkpoint;
- `applied`: currently written/verified in this browser stage;
- `pending`: not yet bound/applied.

After checkpoint creation, its input paths become checkpointed. Their values stay local. They no longer need a live DOM ref in later stages and are not rebound merely because their prior controls disappeared.

Inputs not covered by the checkpoint remain pending. Later pages can bind them.

A run never silently drops supplied values. Final completion requires every supplied input to be either checkpointed or currently verified as part of the final stage.

## Commit signatures and duplicate prevention

A verified commit creates a deterministic signature from observed authority:

- page URL origin/path;
- action kind;
- target role/name/context/form identity;
- sorted current-stage input paths.

The exact signature is internal and contains no input literal values.

After a checkpoint, an identical commit signature cannot execute again until a meaningful non-commit browser effect changes progress or a different grounded commit signature appears.

This is a duplicate-submit guard, not an idempotency guarantee. It does not claim server exactly-once semantics.

## Unknown effects

If a commit started but its outcome is unknown, the result is `unverified / effect-unknown` and receives a continuation when enough local state exists for reconciliation.

Continuation stores:

- pre-commit record inventory;
- current-stage input bindings/values locally;
- commit signature;
- prior checkpoints;
- instruction and run policy/budgets.

`resume()` must reconcile read-only first:

1. observe current page/result;
2. attempt the same local readback verification against the saved pre-commit inventory;
3. if verified, create a checkpoint and continue/finalize;
4. if not verified, return `effect-unknown` again;
5. never re-execute the unknown commit automatically.

## Resume values

`resume(id, { values })` can add missing values.

Rules:

- new paths are allowed;
- a value for an existing uncheckpointed path may be supplied only if equal to the stored value;
- a checkpointed path cannot be changed;
- object-array restrictions remain unchanged;
- literal values stay in the in-memory continuation state and are never exposed through the continuation ID/result.

Changing the instruction during resume is unsupported in this slice.

## Runtime ownership

`JevBrowser` owns a private continuation map. Continuations are deleted when:

- the resumed goal completes;
- the browser core closes;
- caller explicitly resumes and a non-resumable structural error occurs.

A continuation can be consumed multiple times only while it remains unresolved. It is not transferable to another core.

## Runner interface

`runGoal()` accepts an internal seed:

```ts
interface RunSeed {
  checkpoints?: GoalCheckpoint[];
  checkpointedInputs?: string[];
  pendingUnknownCommit?: PendingCommitState;
}
```

and returns internal continuation material separately from public `RunResult`. Public result filtering must never include literal values.

The core `JevBrowser.run()` stores returned continuation material and attaches only an opaque `GoalContinuation`.

## Completion refactor

`verifyReadback()` must separate two concerns:

1. deterministic checkpoint evidence;
2. Jev task-stage classification.

Proposed internal result:

```ts
interface CommitReadback {
  verification: RunVerification;
  stage: 'final' | 'continue' | 'rejected';
}
```

A fresh record is locally validated before stage classification can influence control flow.

The model cannot cause a checkpoint by saying `final`; it can only classify already grounded/validated evidence.

## Final assertion boundary

`expect` is evaluated only after the latest verified checkpoint is classified `final` or when a no-commit path otherwise reaches a final boundary.

An intermediate checkpoint classified `continue` must never run a final `expect`.

A final caller assertion failure is a normal run failure and does not invalidate already verified checkpoints; a continuation may be returned if the caller can still make progress.

## CLI and MCP

Add shared command:

```json
{
  "command": "resume",
  "continuationId": "...",
  "values": { "missingField": "value" }
}
```

CLI supports it only with a persistent named session. One-shot fresh-browser resume fails with `CONTINUATION_NOT_FOUND`.

MCP exposes `browser_resume` through the same command dispatcher/core.

No separate continuation implementation exists in adapters.

## Metrics

Continuation runs keep their own operation usage and expose cumulative checkpoint history. Do not sum repeated batch usage incorrectly.

Later benchmark reporting should include:

- number of verified checkpoints;
- duplicate commit attempts blocked;
- resume reconciliation requests;
- total provider calls and serial decision depth across the whole task.

This slice does not add a billing/cost estimator.

## Initial automatic-path boundary

Automatic multi-commit continuation is supported when each commit can be independently verified from a fresh read-only result record with at least one local identity anchor from caller-supplied stage inputs.

A commit with no new stage evidence is not silently marked verified. It remains unverified unless a caller oracle verifies it.

This keeps the implementation honest while preserving a path to later semantic/result-specific checkpoint policies.

## Acceptance criteria

1. One `run()` can perform three independently verified commits and each server receives exactly one submission.
2. After checkpoint 1, failure in stage 2 never recreates stage 1.
3. Final `expect` is not evaluated at checkpoint 1 or checkpoint 2.
4. Same verified commit signature cannot be submitted twice without meaningful progress.
5. Unknown commit outcome is never automatically replayed.
6. `resume()` reconciles a now-visible unknown result read-only and continues.
7. If unknown result is still unverified, resume returns `effect-unknown` with zero new submissions.
8. Resume can add a missing value.
9. Resume rejects changing a checkpointed value.
10. SDK, persistent CLI, and MCP use the same core.
11. Cancellation/policy hooks/dialog semantics remain unchanged.
12. Public docs and fixtures remain product-neutral and contain no private adopter/application context.
13. Existing single-commit `run()` behavior remains source-compatible.

## Out of scope

- durable continuation across process restart;
- distributed orchestration;
- arbitrary DAG/workflow DSL;
- automatic replay of an unknown mutation;
- cross-machine continuation IDs;
- checkpointing commits that have no independently grounded result evidence;
- private-adopter-specific public documentation.

## Implementation rulings (2026-09-20)

Verified action signatures are retained for the entire goal and its continuations, rather than rearmed by unrelated non-commit actions. A scrolling regression exposed the weaker rule. Current bindings can explicitly defer later-stage inputs in the same frontier; fallback classification is used only when that answer was not available. `incomplete` is not successful stage evidence: only the explicit `continue` choice permits subsequent work. Pending metadata is recorded when execution starts and normal readback and reconciliation share one path. Both caller `until` and `expect` must pass when both exist. Continuations are bound to Page/origin and immutable scope/value structure.
