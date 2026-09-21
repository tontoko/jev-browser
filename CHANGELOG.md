# Changelog

## 0.8.0

- Progress waiting and observation share visible text eligibility; plain paragraphs, spans, definitions and output text do not require a status role. Native checked state and link destinations are observed too.
- Caller completion conditions are rechecked before terminal quiet-wait failures. A missed observation never causes a save retry.
- Supplied native select values that cannot be mapped now return `unresolved-input` with grounded blockers, separately from genuinely missing caller data.
- Optional `semanticInputs` grants explicit per-path disclosure and confidence policy for native select/multiselect meaning resolution. Exact matching stays local; no synonym/country rules or inference runtime are added.
- Option identity, semantic provenance and readback resolution survive pending-save reconciliation. Stale proposals cannot override fresh literal bindings.
- SDK, CLI and MCP share the same run contract and installed-package checks.

## 0.7.1

- A speculative no-action answer is reconsidered after new input effects, using the resulting observation. It does not prevent a requested save merely because the earlier decision saw empty fields; unchanged evidence is not repeatedly sampled.
- A blocked goal can ask Jev to distinguish missing caller data from an unavailable action, preserving resumable checkpoints. This diagnostic runs only after no action/progress; it does not compete with executable actions or replace semantic judgment with required-field heuristics.
- Preserve semantic evidence rather than compatibility-folding notation into deterministic truth. Literal equality remains local; notation/spacing differences reach Jev with the original captured text. Caller Locator text is no longer additionally whitespace-normalized.
- Numeric extraction copies only supported numeric syntax, including its existing full-width digit/currency forms. Superscripts, subscripts and circled digits cannot silently become unrelated decimal values; no equation evaluator or synonym rules were added.
- Structured extraction uses the shared parallel decision frontier. Independent transport chunks now overlap while preserving every question, per-record candidates/context, output order and per-request metadata.
- A failed/invalid frontier response cancels sibling requests without cancelling the caller's parent signal. Cooperative requests settle before the operation returns; received usage remains counted on failure.
- Public SDK/CLI/MCP methods, assertion thresholds, native execution and continuation contracts are unchanged. No persistent decision cache, provider ranking or site-specific rules were added.

## 0.7.0

- Live semantic assertions re-read bound evidence before returning. A changed/hidden/replaced source is inconclusive rather than a stale pass; snapshot comparison remains available separately.
- Accept real SDK Playwright Locators for visible text, explicit value, checked state and named attributes. Exact comparisons no longer require provider configuration. Added optional `semanticMatchers(core)` for native `expect.extend`, including non-passing inconclusive negation.
- Added shared SDK/CLI/MCP semantic target/compare/assert batch APIs. Candidate metadata is shared once per frontier; multiple target refs remain available within one observation.
- Preserve mixed-model provenance and structured assertion failure evidence, both thresholds, and expected values across inference, CLI/MCP and persistent session boundaries.
- Reobserve detached form bindings instead of mistaking asynchronous navigation/search updates for ambiguous live form ownership. No stale browser mutation is replayed.
- Expanded neutral search/edit/update/readback, freshness, cancellation, adapter and installed-package regression coverage. No new runtime dependency or browser selector engine.

Freshness is an instant of observation, not a durability guarantee. Semantic confidence remains an uncalibrated decision score. The batch target reuse is not persistent automatic plan caching; same-core continuation from v0.6 remains available.

## 0.6.0

- Multi-stage goals accumulate verified checkpoints and continue to explicitly requested later saves. Current-field binding and later-stage placement share a parallel decision frontier.
- Added same-session `resume()` / CLI `resume` / MCP `browser_resume`; stopped results and interrupted commit errors retain opaque continuation IDs. Unknown saves reconcile read-only before later mutations.
- Final caller assertions are separate from intermediate checkpoint evidence. When both `until` and `expect` are provided, both must pass.
- Existing values and their nested structure, Page/origin and observation scope cannot change on resume. Verified action signatures remain blocked after unrelated actions and across continuations.
- Strengthened neutral HTTP fixtures, installed-tarball continuation checks and opt-in real-provider interruption tests. No model server, planner dependency or workflow DSL was added.

Continuation is in-memory only; this is not durable orchestration, an arbitrary batch-creation API, or an exactly-once/database-durability guarantee.

## 0.5.1

- A custom `baseURL` / `JEV_BASE_URL` can use a TypeSafe-compatible System One endpoint without requiring a hosted Jev API key.
- The wire contract remains `POST /v1/systemone` with the existing `state/questions` request and `model/answers/usage` response; no provider-specific runtime dependency or model router was added.
- The hosted default still fails closed when no API key is configured.

This enables local or self-hosted decision backends while keeping browser semantics, validation, policies and verification inside Jev Browser. Backend confidence/accuracy remains distribution-specific and must be calibrated independently.

## 0.5.0

- Grounded semantic verification across SDK, CLI and MCP: `locateSemantic`, `compareSemantic`, `compareSemanticBatch`, and `assertSemantic`.
- Semantic assertions distinguish `passed`, `failed`, and `inconclusive`; configurable `minConfidence` defaults to 0.8. `minSourceConfidence` defaults to the comparison threshold but can be tuned independently. Low source-selection confidence, low comparison confidence, or insufficient evidence never passes; low source confidence short-circuits before the comparison frontier.
- Model confidence is exposed as a decision score, not a correctness probability. Source-selection confidence is reported separately from final semantic-comparison confidence.
- Exact grounded equality short-circuits locally without an additional semantic comparison call. Deterministic Playwright/native assertions remain unchanged and preferred when exact truth is available.
- Independent Jev questions use a shared decision frontier: transport chunks at one dependency level can run concurrently, while `serialDecisionDepth` reports the actual sequential semantic depth.
- Semantic usage reports provider requests/questions/tokens plus provider, observation and local verification time.
- Semantic source grounding excludes definition-list terms from value candidates and returns the actual evidence used for every result.
- Installed-package verification exercises semantic SDK, persistent CLI and MCP paths with a deterministic synthetic provider; explicit real-Jev semantic fixtures cover multilingual equivalence, contradiction, low-confidence inconclusive outcomes, batching and candidate-order variation.
- Public examples and documentation use neutral OSS scenarios rather than adopter-specific application context.

Semantic verification is opt-in. It does not convert Jev confidence into a probability, replace application-specific truth sources, or weaken existing deterministic assertions. Verified multi-commit checkpoints/resume remain a later architecture slice.

## 0.4.0

- Long native selects no longer explode the action inventory: exact named values stay local, while prose-only choices are resolved in bounded option partitions without dropping the tail of the list.
- Native select verification now binds the selected index to its observed label/value semantics, so replacing options at the same index cannot silently satisfy an old plan.
- Standards-associated ARIA comboboxes (`aria-controls` / `aria-owns`) support portal, inline, editable and search variants through the same native execution and authorization lane; typed query text alone is never treated as a committed choice.
- Crowded pages can select a bounded semantic form/result region instead of requiring callers to raise whole-page observation limits. Explicit caller scope is never widened.
- New application fixtures use opaque control names and human labels rather than caller input paths, with genuinely distinct layout permutations.
- Cancellation, authorization, popup replacement, ambiguity and step-budget regressions cover the new widget substeps.

These are DOM/ARIA-grounded capabilities, not a claim of arbitrary custom widgets or visual-only Canvas automation. Multiple independent commits and resumable business workflows remain a later slice.

## 0.3.0

- One-instruction creation goals across SDK, CLI and MCP: nested input paths, parallel binding questions, serial native execution, multi-screen forms and fresh result readback.
- Common `expect` assertions; input/readback coverage, logical provider usage, effect state and sanitized partial results on errors.
- Normal confirm/alert handling through existing native primitives and both policy hooks; changed dialog identities and unauthorized extra effects are not accepted.
- Reuse supplied values for required confirmation fields; wait for declared form readiness/validation; preserve exact native select identities and reject conflicting form bindings.
- No-input saves are tracked as commits too. Unknown submissions are not replayed. Input string redaction cannot rewrite protocol fields or its own replacement tokens.
- Nested extraction retains parent meaning and batches independent record frontiers, with per-record candidate boundaries and explicit request size limits.
- Hinted native menu hover, canonical boolean readback, installed-package goal checks and an opt-in 100-task synthetic real-provider matrix.

Automatic `complete / ui-readback` is new: callers requiring only their own oracle should supply `expect`/`until` and inspect `verification.source`. Defaults and unsupported workflow classes are documented in docs/goal-runtime.md. General third-party-site success and exact API compatibility are not claimed.

## 0.2.0

Initial packaged OSS release following local prototypes.

- Shared typed SDK, native/AI MCP tools, one-shot and JSONL CLI, and authenticated named CLI sessions.
- Native browser operations, current-page/tab/frame management, dialogs, files, screenshots/PDF, diagnostics, storage, routing, traces and deterministic assertions.
- Chromium, Firefox and WebKit launch options; persistent, CDP and WebSocket connections; explicit borrowed resource ownership.
- Grounded action selection with local input bindings and verbatim quoted input; bounded `run` and `agent().execute()`.
- Nested objects, scalar roots and repeated DOM record extraction with source evidence and record isolation.
- Single-use AI plans, stable semantic model labels separate from public snapshot refs, explicit cancellation and no hidden mutation retries.
- Multiselect preservation, mixed-state handling, exact numeric boundaries, semantic heading extraction, inert/shadow-root support and source-preserving validation.
- Cross-platform tests, installed-tarball consumer verification, public migration/security documentation and a CLI agent skill.

API/flag compatibility with upstream projects is not implied. See docs/migration.md for deliberate differences.
