# Changelog

## 0.15.0

- A Cloudflare Workers AI run URL for a System One model (for example `https://api.cloudflare.com/client/v4/accounts/<account>/ai/run/@cf/cloudflare/clef-flash`) is accepted as `baseURL` / `JEV_BASE_URL`: decisions are posted to that URL with the model's short name (`clef-flash`), the Cloudflare API token comes from `apiKey` or `JEV_ENDPOINT_API_KEY` (never a hosted Jev key), and the answer is read from the v4 envelope's `result`. A `success: false` or HTTP error is `PROVIDER_ERROR`, never an answer.

## 0.14.2

- `run` combobox selection no longer fails with `NO_MATCH` when the matching option is already shown as a short `settleTimeoutMs` budget expires on a slow machine; the deadline is judged on the page, not on how many polls fit into it.
- `run` observes again when the form it just authorized is replaced before an onward click, instead of stopping with reason `validation`.

## 0.14.1

- A decision request that hosted Jev rejects as over its input token limit (HTTP 400 `max_tokens_exceeded`, which dense pages reach below the 128 KiB byte budget) now fails with non-retryable `OBSERVATION_LIMIT` and narrowing guidance instead of `PROVIDER_ERROR`, from `act`, `observe`, `run`, `extract` and semantic operations.

## 0.14.0

- Opt-in image understanding: `screenDecide` (CLI `screen_decide`, MCP `browser_screen_decide`, also in screen-only sessions) captures the viewport once, has an OpenAI-compatible Chat Completions endpoint you configure (`vision` option, or `--vision-base-url` and `--vision-model` with `JEV_VISION_API_KEY`) describe it, and answers your questions with Jev from that text; `decideFromScreen` and `ChatCompletionsImageUnderstanding` are exported for your own captures. Screenshots go only to that HTTPS or loopback endpoint, only when called, and no Jev key is sent to it.
- New opt-in `screenFollowPopups` launch option (CLI/MCP `--screen-follow-popups`, with screen-only mode): a new tab the observed page opens becomes the observed page instead of being closed, results report `pageSwitched`, and closing that tab returns to its opener.
- `act`, `observe` and `run` no longer send link URLs in their decision state (observe on a 40-row table with a link per row: ~99.5 KB to ~86.2 KB); `extract` and semantic evidence keep them, and link `href` sources now have their own budget instead of counting toward `maxTexts`.
- An `act`/`observe` decision request larger than 128 KiB now fails with `OBSERVATION_LIMIT` before any provider call instead of a provider `PROVIDER_ERROR`; decision requests omit `frame` for the main frame.
- Plans, snapshot refs, `run` actions and owned combobox options are re-checked right before the effect, after caller policies and model decisions, against the Page, document, frame and observation scope they were captured in; a target that left them fails with `STALE_TARGET` instead of being clicked.
- `run()` adopts a UI readback as a checkpoint only after re-reading that the same result record and page headings/status/alerts are still shown; otherwise it observes again (the save is never repeated).
- `run()` progress waits watch only the observed frames and scope roots, so a change in an unrelated frame or region outside `scope` no longer ends a wait early.
- If the Page closes while a `run()` pauses, its own result or error is returned instead of a failure from preparing carried wizard input, and no continuation is kept.
- `run()` re-decides instead of executing a speculative action that targets a control whose input it just applied, and a model "done" answer given before inputs were applied no longer skips to the final `expect`.
- `extract()` evidence keys escape a literal `.` or `\` inside a field name with `\` (for example `a\.b` for a field named `a.b`), and a field under an empty name no longer shares a key with a root field, so different fields never share an evidence key; ordinary names are unchanged.
- A native dialog that opens during a `screen` capture is now always reported once as `SCREEN_FAILED` (or `SCREEN_INTERRUPTED` after an input) with reason `dialog`; in screen-only sessions it could instead surface as `SCREEN_DIALOG_UNSUPPORTED` after a retaken capture, depending on which timeout fired first.
- Documented that `console_messages` and `network_requests` telemetry is Page-scoped: several cores sharing one Page each record all of that Page's events in their own buffer, and `clear: true` empties only that core's buffer.

## 0.13.0

- Breaking: `playwright-core` (`>=1.62.0 <2`) and `zod` (`^4.2.0`) are now peer dependencies instead of bundled `playwright` and `zod` copies, so the package shares your project's Playwright and Zod; an older `playwright-core` fails with `CONFIG`. Yarn Berry users must add them explicitly. See `docs/migration.md`.
- Breaking: the CLI and MCP server enable the `cookies`, `storage`, `storage_state`, `route`, `trace`, `evaluate` and `init_script` tools only through `--caps storage,network,trace,evaluate`; disabled tools are left out of MCP `tools/list` and fail with `CAPABILITY_DISABLED` in the CLI. `--allow-evaluate` is kept as an alias for `--caps evaluate`. See `docs/migration.md`.
- Breaking: CLI and MCP uploads no longer read from the working directory by default; pass `--file-root DIR` (`--file-root .` restores the old behavior), otherwise `file_upload` fails with `FILE_ACCESS_DENIED`. The SDK default is unchanged. See `docs/migration.md`.
- Breaking: native `select_option` with `by: 'value'` now matches option values exactly instead of value or label; omit `by` to keep matching either. A value with no matching option fails with `TIMEOUT` when the operation budget ends. See `docs/migration.md`.
- Breaking: `open` of an existing named session with different launch options (browser, headless, context options, storage state, profile, endpoints, limits, timeouts, file roots, `--caps` and other flags fixed at start) now fails with `SESSION_MODE_MISMATCH` instead of silently keeping the original options. See `docs/migration.md`.
- Breaking: `cdpEndpoint` or `wsEndpoint` with `contextOptions` or `storageState` now fails with `CONFIG` when the attached browser already has a context, instead of silently ignoring them. See `docs/migration.md`.
- Row, list, form and record context strings sent to the decision endpoint no longer include text typed into `contenteditable` editors, `<textarea>`/`<input>` controls or native `<select>` option labels; element names and labels are kept.
- An empty or whitespace-only `JEV_MODEL` or `--model ""` now counts as unset, like the other decision settings, instead of sending an empty model name.
- `run()` and `resume()` (CLI `run`/`resume`, MCP `browser_run`/`browser_resume`) reject an unparsable `scope` with `INVALID_SELECTOR` before observing, instead of `RUN_FAILED`.
- A core keeps at most 32 paused continuations, dropping the least recently used, and drops a Page's continuations when that Page closes; a dropped ID fails with `CONTINUATION_NOT_FOUND`.
- When the selected tab is closed outside a `tabs` command, operations fail with the new `TAB_CLOSED` code, which says to pick another tab with `tabs` `select`, instead of `OPERATION_FAILED`. Jev does not switch tabs by itself.
- A pending `dialog` result now includes the `pageId` of the tab that opened it, matching `tabs` results.
- `downloads` `list` entries now include `navigation`, the tab's navigation generation when the download started, so downloads from different documents of one tab can be told apart.
- A core attached to a borrowed Page without `captureDialogs` no longer intercepts file choosers between its operations, so the caller's own chooser handling and a headed browser's native picker work as usual; choosers opened during a Jev operation are still held for `file_upload`.
- `screen` no longer fails with `SCREEN_FAILED` (`unknown`) when Chromium has not yet rendered a fresh page's first frame; it waits for the frame within the operation budget and reports `timeout` if it never arrives.
- A screenOnly session now recovers from a native dialog: it is reported once with `SCREEN_DIALOG_UNSUPPORTED` and dismissed, instead of failing every later screen call with `DIALOG_PENDING` until a restart.
- A screenOnly session now recovers from a new tab opened by the page, such as a `target="_blank"` link: it is reported once with `SCREEN_POPUP_UNSUPPORTED` and closed, instead of failing every later screen call while the tab stays open.
- `snapshot`, `observe`, `act`, `extract`, the semantic tools and `run` accept per-call `maxElements`, `maxTexts` and `maxCandidates` (clamped to 1000 / 2000 / 2000) and `exclude` CSS selectors, in the SDK, MCP and CLI (`--exclude`), so one large page no longer needs a new session with higher limits.
- `scope` also accepts a current snapshot or `semantic_locate` ref, limiting observation to that element in its own frame; an expired ref fails with `STALE_TARGET`.

## 0.12.2

- A screen observation is no longer invalidated by `history.replaceState` or `history.pushState` calls that keep the current URL, so frameworks that call history.replaceState with the current URL, e.g. on scroll, no longer make the next input fail with `STALE_SCREEN`.

## 0.12.1

- A screen `scroll` now captures after the scroll settles, including smooth scrolling, instead of racing the wheel. The returned image no longer shows the unscrolled page, and the next input with its `observationId` no longer fails with `STALE_SCREEN`.
- The screen journal `header` row's `startedAt` now reports when the session was created instead of the later time the first row was written.
- Documented that a `target="_blank"` link opens a tab a screen-only session cannot see.

## 0.12.0

- Breaking: `JEV_API_KEY` and `TYPESAFE_API_KEY` are sent only to hosted Jev at `https://api.typesafe.ai`. A custom `baseURL` / `JEV_BASE_URL` is authenticated only by an explicit `apiKey` option or the new `JEV_ENDPOINT_API_KEY`, a key is never sent over plain HTTP to a non-loopback host (`CONFIG`), and the upstream SDK's `TYPESAFE_BASE_URL` no longer redirects hosted keys. See `docs/migration.md`.
- Empty or whitespace-only API key variables count as unset, so `JEV_API_KEY=` with a custom endpoint no longer fails with a `CONFIG` error that asks for the endpoint already configured.
- An explicit `apiKey` no longer appears when a `JevBrowser` is inspected, logged or serialized with `JSON.stringify`.
- Numeric input values echoed by the page are redacted from goal requests and results, like string values.
- Persistent sessions no longer corrupt multibyte UTF-8 text in command bodies larger than one stream chunk, such as long Japanese text sent to `storage` or `type`.
- The SDK no longer loads Playwright Test at runtime. A project whose own `@playwright/test` differs from the bundled Playwright version can pass its test `page` to `JevBrowser` instead of failing with `Requiring @playwright/test second time` and `No tests found`.
- Native `assert` raises errors from reading its target, such as `AMBIGUOUS_TARGET` when a selector matches several elements, instead of reporting them as `ASSERTION_FAILED`. Mismatches still fail with `ASSERTION_FAILED` after polling, and a Playwright wait that times out early under a shorter Page default timeout keeps polling within the assertion window.
- Moved `dom-accessibility-api` to development dependencies because it ships only inside the DOM bundle, and stopped packing the unused unbundled `dist/dom.js`.
- A wizard run that stops before its first verified save now returns a `continuation` when earlier steps carried applied inputs, so `resume()` can add a missing value or finish after a step budget instead of restarting from a view whose fields are already hidden. Resume still requires the unchanged paused view (`CONTINUATION_CONTEXT_CHANGED` otherwise) and final result verification.
- A borrowed Page keeps Playwright's default dialog dismissal outside Jev operations. The caller's own `page.click()` on a button that opens `confirm()` no longer hangs, and later Jev operations no longer fail with `DIALOG_PENDING`. Jev still holds dialogs that open during its operations. Added `captureDialogs: true` to also hold dialogs between operations; `JevBrowser.launch()`, the CLI and MCP keep that behavior by default.
- `console_messages`, `network_requests` and `downloads` `list` report the selected tab unless `allTabs: true` is passed, and their entries carry a `pageId` that matches `tabs` results. Downloads have stable `id`s for `save` and `cancel`, and an `index` addresses the selected tab's list. `file_upload` without a target uses only a chooser opened on the selected tab, and a tab's pending chooser is dropped when it navigates.
- Operations now end at their `timeoutMs` budget even when page work ignores cancellation, such as a script that never yields. About one second after the deadline or cancellation the caller gets the error and the Page is free for the next operation. `close()` no longer waits indefinitely for such work: it closes owned browsers and contexts after the same grace and never closes borrowed ones.
- An action that completes just as its deadline passes or its signal aborts is now returned as executed instead of being reported as cancelled.
- Breaking: an exhausted budget now fails with `TIMEOUT` instead of `CANCELLED`; an aborted caller signal or `close()` still fails with `CANCELLED`. `JevBrowser` operations reject with `BrowserError` instead of raw Playwright errors and keep the original as `cause`, which is never serialized. See `docs/migration.md`.
- Added the error codes `TARGET_OBSCURED` (a covering element blocked a click that was never delivered, previously `ACTION_INTERRUPTED`), `AMBIGUOUS_TARGET`, `INVALID_SELECTOR`, `NAVIGATION_FAILED` and `BROWSER_LAUNCH_FAILED` (which names the `jev-browser install` command for a missing browser build). `BrowserError` and CLI/MCP error JSON gain a `retryable` flag, messages include a sanitized first line of the underlying error, and the `BrowserErrorCode` union type is exported.
- Documented that `run` and `resume` default to a 60-second budget and that the constructor `timeoutMs` is also the timeout of each Jev HTTP request.
- A capture interrupted by navigation is retaken at most twice after the new document reaches `domcontentloaded`, and a child frame removed during a capture is omitted. Snapshots, `observe`, `act`, `extract` and semantic observation no longer surface a raw Playwright error for either case; a page that keeps navigating fails with `STALE_SNAPSHOT`. Retries stay within the operation's `timeoutMs` and stop when its `signal` aborts.
- Displayed text longer than 700 characters is kept as its first 700 characters with `truncated: true` instead of being silently dropped, and counts toward `maxTexts`. A truncated text is decision context only: extraction never copies it, semantic source discovery never binds it and run readback never compares against it.
- An explicit `scope` that matches no element in any frame fails with `SCOPE_NOT_FOUND` in `snapshot`, `observe`, `act`, `extract` and the semantic locate, compare and assert methods, instead of returning an empty observation. `run` and `resume` keep their existing stop behavior. See `docs/migration.md`.
- Screen validation errors name the action and each failing field, in the message and in `details.issues`. Rejections by the shared core, including MCP `browser_screen` calls after the browser has started, also return the current `observationId`. The MCP `browser_screen` fields describe which actions need them. `scroll` treats an omitted wheel delta as 0, and `wait` no longer requires an `observationId`.
- Screen requests rejected before any capture or input keep the latest observation usable. This covers invalid arguments, policy denials, old IDs, out-of-image coordinates, unsupported viewport transforms and screen-only command denials. Previously any of these forced another look.
- Only main-frame navigations invalidate a screen observation; a child frame navigating no longer does. After an input, or before a look, capture waits up to 5 seconds for a started main-frame navigation to commit and reach DOMContentLoaded. A navigation during capture retakes the capture once instead of returning `STALE_SCREEN`, and results add `navigated`. A further navigation during that retake returns `STALE_SCREEN`, whichever capture step it interrupts.
- `SCREEN_FAILED` and `SCREEN_INTERRUPTED` add a sanitized `details.reason` (`timeout`, `cancelled`, `navigation`, `page-closed`, `page-crashed`, `dialog` or `unknown`), and SDK callers get the underlying error as `cause`. While no current observation exists, `back`, `forward` and `reload` may omit `observationId`, so repeated capture failures are no longer a dead end.
- A native file chooser is reported once with `SCREEN_FILE_CHOOSER_UNSUPPORTED`, and later screen calls continue on the same page instead of failing permanently.
- The screen journal starts with a `header` row recording the jev-browser, Playwright and browser versions, the viewport and redacted launch options. Each journaled frame adds `sha256`, `width` and `height`. Existing fields are unchanged.
- Added `--viewport WxH`, `--reduced-motion`, `--color-scheme` and `--locale` to the CLI and MCP server, plus `--options-file FILE` for JSON launch and context options (`launchOptions`, `contextOptions`, `storageState`, profile and endpoint fields). Explicit flags win over the file, and invalid fields are reported by name.
- The MCP server runs tool calls one at a time in arrival order, so parallel calls wait instead of returning `BUSY`. Cancellation and an explicit `timeoutMs` include the wait; `browser_close` is not queued.
- A failed lazy MCP launch is no longer cached, and a crashed or disconnected browser is replaced on the next tool call instead of failing every later call. Screen-only sessions still end after a failed startup or a lost browser.
- Documented that `browser_snapshot` and other read-only tools replace short-lived refs and any pending observe plan, although they do not change the page.
- MCP tool input schemas now describe their arguments, including rules JSON Schema cannot express without top-level combinators, such as exactly one of `instruction` or `planId` for `browser_act` and exactly one of `fields` or `schema` for `browser_extract`. `browser_screen` is unchanged. Descriptions add about 13 KB to `tools/list`.
- CLI and MCP integer command arguments, such as `timeoutMs`, `maxSteps`, `frame` and tab or download indexes, now accept at most 2147483647 instead of advertising `Number.MAX_SAFE_INTEGER`. Larger timeouts previously passed validation but overflowed Node timers and cancelled the operation after about 1 ms.

## 0.11.0

- Added `jev-browser install [chromium|firefox|webkit] [--dry-run]`, which installs the browser build for the Playwright version this package bundles. A consumer that pins a different Playwright no longer needs to resolve this package's Playwright CLI by hand.

## 0.10.0

- Breaking: removed the `@tontoko/jev-browser/pi` export and adapter. Use the shared SDK, CLI or MCP surfaces, including the opt-in `screenOnly` mode. See `docs/migration.md`.
- Builds clear generated output first, so stale files cannot enter a package. Tagged releases are published from CI after all platform jobs pass.

## 0.9.0

- Added a shared `screen` command for actual viewport PNGs and native coordinate, focused keyboard, scroll and history input. Each action returns the resulting images and an observation ID; input consumes the latest observation, and navigation or viewport changes require another look.
- Added immutable `screenOnly` / `--screen-only` sessions. Shared dispatch denies every command except `screen` and `close`, and restricted MCP sessions expose only those tools. No DOM, ARIA, selectors, arbitrary navigation, source, storage or network reads are available through this interface.
- Added the optional `@tontoko/jev-browser/pi` extension. Trusted setup fixes the initial URL and browser options before the actor starts; Pi receives only native viewport image blocks and bounded action metadata through two tools. Documentation shows a fresh Pi process with explicit system instructions and tools, without inherited repository context.
- Bounded frame sequences preserve normal animation and report actual capture times. Persistent sessions and combined input/capture avoid additional Jev inference or a separate screenshot call after each input; screen operations make no Jev model requests.
- Saved viewport files and a mechanical action journal retain observed outcomes, including rejected or uncertain actions, without duplicating image bytes or typed text in the journal. Cancellation never replays an input or silently starts a replacement browser.
- Screen pointer input maps image coordinates through verified Chromium viewport scale, including mobile pages without viewport metadata. Unsupported transforms fail explicitly before input. Captures, viewport reads and history navigation honor cancellation, and closing a restricted MCP or Pi session is final.
- Added real-browser boundary, stale-observation, adapter and installed-package regressions. Existing functional and semantic verification APIs remain available to the trusted caller.

The restricted command interface is not an operating-system sandbox. Trusted SDK callers still own the Page and source-aware APIs. Observation IDs bind a sequence and browser state; they do not freeze animation or application layout. Native dialogs, popups and file choosers are explicit capture limitations. UX judgment and independent outcome verification belong to the caller; successful browser input does not establish usability or durable application success.

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
