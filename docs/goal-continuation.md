# Verified stages and same-session resume

`run()` can complete several requested saves. It records each verified stage as a checkpoint, keeps subsequent inputs pending, and continues without a workflow DSL or a second planner. SDK, CLI, and MCP all call the same core.

## One request, several stages

```ts
const result = await browser.run(
  'Create the account with the email, add its membership with the membership code, then create its reservation. Save each once.',
  {
    values: {
      email: 'account@example.invalid',
      membershipCode: 'MEM-042',
      reservationReference: 'RES-042',
    },
    expect: { target: '#setup-status', property: 'text', expected: 'Ready' },
  },
);
```

Current-field binding and explicit later-stage placement share a decision frontier. A value is deferred only when the original request assigns it to a later stage. Otherwise a missing current field blocks the save. Deferred inputs remain visible in coverage and cannot be silently dropped at final completion.

Each automatic checkpoint needs a fresh read-only result with locally matching identity and field evidence. The model selects observed sources and distinguishes a successful intermediate stage from final completion; local code compares the selected values. An incomplete, rejected, ambiguous, or mismatched result does not authorize another commit.

`expect` is a final-goal assertion, not an assertion that must pass after the first intermediate checkpoint. A read-only `until` predicate remains authoritative; if both `until` and `expect` are supplied, both must pass. A model's done answer cannot replace either check.

## Continue after missing data

```ts
const first = await browser.run(
  'Create the account, then create its membership.',
  { values: { email: 'account@example.invalid' } },
);

if (first.reason === 'missing-input' && first.continuation) {
  const resumed = await browser.resume(first.continuation.id, {
    values: { membershipCode: 'MEM-042' },
  });
  console.log(resumed.status, resumed.checkpoints);
}
```

A resumable result carries only an opaque ID, its stop reason, and (when relevant) `pendingEffect: 'commit'`. The core privately retains the original task, copied values, policies, checkpoints and reconciliation state. It does not serialize input literals into that ID or result.

New values may be added. Existing values, including empty objects and nested object structure, cannot be replaced; conflicts raise `CONTINUATION_CONFLICT` before browser work. Input objects are copied before awaiting the provider. `resume` may supply a new signal and timeout. The original step/decision limits apply to each invocation, and usage is per invocation rather than a cumulative total.

Inputs applied in an unfinished wizard step can be carried through a pause without claiming they were saved. The paused URL and observable page structure must still match before those inputs are reused; a changed wizard view raises `CONTINUATION_CONTEXT_CHANGED`. Final result verification is still required.

Verified work also remains resumable after a step-budget or other recoverable stop. A failure with uncertain non-commit effects is not automatically made resumable by pretending that those effects did not happen.

## Unknown save outcomes

If a save started but its result was not verified, `continuation.pendingEffect` is `commit`. This includes a browser interruption or provider error after the save started. Exceptions expose the result through `error.partial`, including over persistent CLI and MCP error envelopes.

`resume(id)` first observes and reconciles that pending save. It does not press Save again. If a fresh matching result can now be verified, the core creates its checkpoint and continues. If the outcome remains unknown, it returns unknown again, retaining the continuation ID and making no new browser mutation.

A checkpoint's verified action signature remains blocked throughout the task and its continuations. Scrolling, hovering, or another unrelated action does not rearm the same save. A genuinely different stage needs distinguishable observed action/form semantics. This conservative guard may stop a workflow whose successive saves are indistinguishable; it is not a server idempotency key or an exactly-once guarantee.

## Result and lifecycle

`checkpoints` is ordered. Each item contains an ID, the attempted effect ID, its verification, newly covered input paths, and a result record ID when one exists. Record IDs refer to observations, not application/database primary keys. `verification` at the top level describes final acceptance; checkpoint verification describes its own stage. Read `readback` and `unobserved` to distinguish observed result values from values only checked in controls.

Continuations require the same running `JevBrowser` instance, Page and origin. An explicit observation scope cannot be changed on resume. Closing the core or completing the continuation invalidates its ID. Another SDK wrapper, a restarted CLI worker, a new MCP process, or a different origin cannot consume it. IDs whose response was lost are not recovered through a durable store; callers must retain the returned ID.

## CLI and MCP

Use a persistent named CLI session:

```sh
jev-browser run --session work --args '{"instruction":"Create the account, then create its membership.","values":{"email":"account@example.invalid"}}'
jev-browser resume CONTINUATION_ID --session work --values '{"membershipCode":"MEM-042"}'
```

MCP exposes `browser_run` and `browser_resume`. The resume arguments are `continuationId`, optional nested `values`, and optional `timeoutMs`. Resume is not annotated read-only: reconciliation is read-only, but verified work may then continue with authorized mutations. Per-action authorization and cancellation remain in effect.

## Limits and verification

These are DOM/ARIA-grounded stages, not arbitrary business-process orchestration. Automatic readback requires observable result records; visual-only controls, object-array batch creation and durable cross-process recovery remain outside this API. A matching UI is not proof of database durability. Page scripts can perform side effects independently of this library. Caller-authored application checks are appropriate where UI evidence is insufficient.

`npm run test:live:resume` exercises three saves, missing-input continuation, an unresolved second save, and cancellation during the second save using neutral synthetic HTTP applications and the configured real provider. The application independently checks submitted content and counts. These are known regression fixtures, not an unseen-site accuracy benchmark. `npm run check:package` also drives installed SDK, persistent CLI and MCP continuation paths using a deterministic fixture provider.
