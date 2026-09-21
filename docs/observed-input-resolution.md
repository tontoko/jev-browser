# Observed progress and supplied input resolution

The runtime waits on the same visible text eligibility it uses for observation. A result in a paragraph, inline span, definition value or output element must not require a special status role to be noticed. Native checked state and visible link destinations also participate. Waiting itself does not ask the model whether work succeeded: caller conditions and result evidence still decide that. Before returning `condition-unmet` after a quiet settle window, the current caller condition is checked again. No save is replayed to compensate for a missed observation.

## Exact inputs remain private by default

Named native select inputs normally require a unique exact label or option value. A supplied value that cannot be mapped is not absent data. The result is `stopped / unresolved-input` with `blockers`, including its input path and grounded target when known. An absent option, ambiguous options and insufficient mapping confidence are distinguishable from missing caller information.

## Explicit semantic selection

A caller may permit a native selection input to be interpreted by meaning:

```ts
const result = await browser.run('Set the country and note, then save the address once.', {
  values: { country: 'Japan', note: 'A private note' },
  semanticInputs: { '/country': 0.8 },
});
```

`semanticInputs` maps JSON Pointer paths to confidence thresholds in `[0,1]`. This is also an explicit data-disclosure grant: only values at the listed paths, and only when needed for the native option comparison, are sent to the configured decision endpoint. The note above stays in the ordinary local-input lane. A grant is copied before asynchronous work and retained unchanged for the same goal's continuation. It is not a wildcard permission for all named inputs.

The endpoint chooses real option IDs for the supplied meaning. For example, the current options may expose label `日本` and value `JP`. No country table, synonym dictionary or model-generated selector is used. Exact matches need no additional semantic option call. Strings and string arrays for native multiselect are supported; other values retain existing exact matching. ARIA/custom combobox synonym selection is not claimed by this option.

Independent option questions are batched; long lists are partitioned without removing the tail. Every relevant partition must meet the configured confidence threshold. Multiple matches, ambiguous answers, absent matches and low confidence do not authorize a save. A confidence score is not a calibrated probability of correctness or an authorization policy. Existing action/command hooks remain authoritative.

## Evidence, not rewritten user data

The original supplied value is never replaced with a country code internally. The selected option's observed index, label and value form a separate resolution. Input readback checks that actual option identity; a changed option at the same index cannot satisfy the old proposal. `inputs[].resolution` retains its semantic provenance, confidence, threshold and selected options. `verification.semanticInputs` identifies fields whose readback depends on that resolution, rather than pretending literal equality to the original supplied string.

If a pending save needs read-only reconciliation, the same local semantic resolution is retained. Resume does not reselect or resubmit that save. A newly discovered exact binding supersedes an unused stale semantic proposal. Result redaction and continuation authority remain separate from the model's interpretation.

## Missing data is a different question

When no grounded progress is available, the existing blocked-task decision can also select the actual observed field that needs caller information. A blank or required control alone does not prove that data is absent: the original instruction and supplied-input inventory remain relevant. `blockers` includes a missing field only when the model actually identifies it with sufficient confidence; no field name or value is invented to fill an error message.

## Shared interfaces and scope

SDK `run`, CLI `run --args` and MCP `browser_run` accept the same option. No second execution implementation or inference server is introduced.

The paired tests use synthetic pages, a deterministic engine to isolate runtime behavior, and an opt-in real-provider suite (`npm run test:live:observed`). The live country examples are known regression fixtures, not evidence of arbitrary multilingual accuracy or server durability. An application-specific caller assertion remains appropriate when the UI cannot establish the needed fact.
