# Goal execution

A goal is one instruction plus supplied data. SDK `run`, `agent().execute`, CLI `run` and MCP `browser_run` share the same implementation. Native commands remain available without a Jev key.

## Invocation

```ts
const result = await browser.run('Add the customer, fill every supplied field and Save. Do not send marketing email.', {
  values: { customer: { name: 'Example Customer', email: 'customer@example.invalid' }, account: { plan: 'Professional annual' } },
  // Optional caller-authored assertion, also accepted by CLI/MCP:
  // expect: { target: '#saved-customers article', property: 'count', expected: 1 },
});
```

CLI: `jev-browser run --session work --args -` reads that JSON object (including `instruction`) from stdin. `--url` runs against a fresh browser. In MCP, call `browser_run` with the object. JavaScript `until(page, operation)` is SDK-only; it must be read-only, cooperate with cancellation and promptly return false while work remains.

## Execution

The runtime observes the current page, asks independent input-to-control questions together, checks collisions and actual form ownership before writing, and uses native Playwright primitives serially. It retains earlier wizard-step coverage, verifies current field values, re-observes changed select options and repairs a field reset by another input. Native selects keep their full local option identity; exact named values are resolved locally, while very long prose-driven lists are partitioned into bounded Jev questions only after that control is selected. Standards-associated ARIA comboboxes open/filter their declared popup, select one unique owned option, and verify the exposed value/collapse before continuing. Unchanged state is waited on locally rather than repeatedly sent to Jev.

A primary binding does not grant permission to ignore other supplied values. Missing or conflicting current-stage inputs stop before commit. An input explicitly assigned to a later stage can remain pending, but cannot be dropped at final completion. Unsupported inputs are rejected before the run starts. Required confirmation fields may reuse an existing supplied value only after a separate grounded decision; unrelated missing data is not invented. Exact native select labels/values are resolved locally. The goal does not expose all hidden input values to solve arbitrary synonyms.

Normal native confirm/alert dialogs can be accepted inside the same run when they only acknowledge the requested effect. Prompt input is not invented. Ambiguous/additional effects return permission-required. The exact pending dialog is rechecked after authorization, and native `allowCommand` plus AI `allowAction` both apply. A result that still has a pending dialog requires deliberate `handle_dialog` or session closure.

## Results

- `complete / ui-readback`: a new read-only result record was found, its identity and selected displayed values matched supplied data locally, and no subsequent requested work was identified. `verification.source` is `inferred` and `basis` is `ui-readback`.
- `complete / verified`: caller `expect` or `until` passed after supplied-input coverage. The verification identifies assertion/condition; it guarantees that condition, not unspecified business facts.
- `unverified / effect-unknown`: a commit was attempted but sufficient result evidence was not obtained. Do not repeat the whole goal blindly.
- `stopped`: a reason such as missing-input, ambiguous, validation, permission-required or step-limit explains the boundary. It is not success.

`inputs` preserves JSON Pointer paths and applied/readback flags. `verification.readback` and `unobserved` separate saved values seen on screen from values that were only checked in their input controls. `effects` records input/advance/commit attempts; `error.partial` preserves progress on an exception. A toast or model-only done answer cannot alone verify a save. An unchanged old matching row cannot become evidence of the new commit.

A UI readback is not a server transaction, durable database acknowledgement or exactly-once guarantee. Pages can autosave during typing; completed side effects cannot be rolled back. The model still chooses real candidates and can misunderstand a page. Isolate sessions and use authorization hooks and independent application assertions for high-impact work.

## Data and budgets

`values` accepts finite JSON numbers (safe integers), strings, booleans, null, nested plain objects and scalar arrays for native multiselects. Undefined is ignored in SDK inputs. Empty string means clear text, false means off, null is an empty input only where its control supports it. Input object arrays are refused; create separate explicit goals rather than silently processing one item.

Default goal limits: 60 seconds total (an explicit browser/operation timeout overrides it), 100 browser steps, 32 logical decisions, 2 read-only provider retries per decision, and a 2-second finite settle window when no explicit busy state remains. `maxSteps`, `maxDecisions`, `decisionRetries` (0–2), `settleTimeoutMs` and `timeoutMs` are supported in all three interfaces. Each decision request is bounded to 64 questions / 128 KiB; observations retain configured control/text/candidate limits. Increasing a limit is explicit, not a hidden retry.

`usage.requests` counts actual logical provider requests, not SDK retry attempts. `usage.questions` counts Jev questions and `usage.serialDecisionDepth` counts dependency frontiers: transport chunks for one independent frontier can run concurrently without increasing semantic depth. Provider input/output tokens and `providerMs` are reported when available. These are diagnostic measurements, not pricing estimates.

Known literal string echoes in goal state/results are masked while input paths and protocol metadata remain usable. This is not a general privacy filter: labels, numbers, transformed echoes, traces, screenshots and instructions may contain sensitive data. Refer to SECURITY.md.

## Extraction and boundaries

Structured extraction keeps full parent descriptions and field paths. Independent siblings/rows are batched by ready frontier, with at most 64 questions and 128 KiB per request. Array inclusion and its dependent field extraction remain separate stages. Each question's allowed values still come only from its own record; response IDs are checked before copying.

The current automatic path is DOM/ARIA-observable. It covers native forms, long native option lists, open shadow roots/child frames, and comboboxes whose popup ownership and selected value are exposed through standard ARIA. On a truncated whole page, the runtime may choose one real semantic region for the current work and separately choose a result region for readback; an explicit caller `scope` is never widened. Hidden-value synonym matching, arbitrary custom widget conventions, arbitrary multi-record creation, visual-only/Canvas interaction and workflows whose saves have no independently observable result are not universally automated. Observable multi-stage commits and same-session continuation are covered in [goal-continuation.md](goal-continuation.md). A hinted menu (`aria-haspopup`) offers hover; not every native command is automatically a goal candidate. SDK callers retain the genuine Playwright Page; CLI/MCP retain the documented native tools for unsupported steps. No arbitrary model-generated code, site-specific workflow DSL or mandatory second planning model is added.

## Verification

`npm run check` covers deterministic real-browser regressions. `npm run check:package` installs the actual tarball and drives a local HTTP app through all three installed goal interfaces, using a synthetic provider and independent submission assertions.

`npm run test:live` exercises synthetic SDK/CLI/MCP flows with real Jev. `npm run test:live:matrix` separately opts into 100 creation tasks (20 fixture families, five deterministic variants; at most three independent browser pages run concurrently). Set `JEV_MATRIX_CASES=20` for one variant per family. Each case checks the actual server record and exactly one save attempt. This is a controlled regression matrix, not an unseen-site benchmark or a measured universal success rate. Families include nested people, native/multiple select, booleans, delayed readiness, dependent fields, confirmation inputs, save dialogs, shadow/iframe forms and 16 fields.

`run()` and `resume()` retain ordered checkpoints. Final `expect` is distinct from intermediate readback; supplying both `until` and `expect` requires both to succeed. `error.partial` and recoverable stops can carry an opaque continuation. See [continuation lifecycle and unknown saves](goal-continuation.md).
