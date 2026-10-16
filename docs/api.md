# API reference

## SDK construction and lifecycle

`new JevBrowser({ page, ...options })` borrows a Playwright Page. `await JevBrowser.launch(options)` launches or attaches. `close()` disposes only resources owned by the instance; async disposal is supported. It gives an in-flight operation about one second to unwind, then closes owned resources anyway; borrowed ones are never closed. Do not operate a Page concurrently from another core or external writer. Concurrent operations on one core return `BUSY`; the MCP server queues its own tool calls instead.

Options include:

- Provider: `apiKey`, `model`, `baseURL`, `fetch` and `timeoutMs`. Environment fallbacks are `JEV_API_KEY` / `TYPESAFE_API_KEY`, `JEV_ENDPOINT_API_KEY`, `JEV_MODEL`, `JEV_BASE_URL`. The hosted default (`https://api.typesafe.ai`) requires an API key, and `JEV_API_KEY` / `TYPESAFE_API_KEY` are used only for that origin. A custom `baseURL` may be keyless and must expose TypeSafe-compatible `POST /v1/systemone` request/response envelopes; it is authenticated only by an explicit `apiKey` or `JEV_ENDPOINT_API_KEY`. A key is sent only over HTTPS or to a loopback host (`localhost`, `127.0.0.0/8`, `[::1]`). A key for plain HTTP to another host, or a `baseURL` that is not an HTTP(S) URL, fails with `CONFIG` when the decision engine is created (for `JevBrowser`, at the first AI operation). Empty or whitespace-only key, model and URL settings (including `--model ""`) are unset. The upstream SDK's `TYPESAFE_BASE_URL` is not used.
- Observation: `maxElements` (120), `maxTexts` (160), `maxCandidates` (250). Limits fail explicitly instead of silently excluding action candidates. A displayed text longer than 700 characters is kept as its first 700 characters with `truncated: true` and counts toward `maxTexts`; it is decision context only, never a copied extraction value, bound semantic evidence or run readback. Link `href` sources have their own budget of the same size, so a page full of links does not crowd displayed text out of `maxTexts` (a snapshot can therefore hold up to twice `maxTexts` text entries). `scope` narrows a particular observation; `recordsScope` identifies repeated records but does not itself remove unrelated page text. A `scope` that matches no element in any frame fails with `SCOPE_NOT_FOUND` in `snapshot`, `observe`, `act`, `extract` and the semantic locate/compare/assert methods; `run` and `resume` keep their stop behavior. Observation is read-only: a capture interrupted by navigation is retaken at most twice after the new document reaches `domcontentloaded`, a child frame removed during a capture is omitted, and a page that keeps navigating fails with `STALE_SNAPSHOT`. Retries spend the operation's `timeoutMs` and stop on its `signal`; they never extend the budget.
- Decision requests: `act`, `observe` and `run` leave link URLs out of their decision state; `extract` and semantic evidence keep them. `frame` is omitted for the main frame (0) on the wire; every other field is sent as observed. Every decision request, including `act`/`observe`, has a 128 KiB budget; an `act`/`observe` request above it fails with `OBSERVATION_LIMIT` before any provider call (hosted Jev rejects such requests anyway). Hosted Jev limits input tokens rather than bytes, so it can reject a smaller request too: dense pages such as tables of short cells and links reach its limit well below 128 KiB (a 35-row table with a link per row, about 77 KB), while prose-heavy requests near 128 KiB are accepted. That rejection (HTTP 400 `max_tokens_exceeded`) also fails with `OBSERVATION_LIMIT` (not retryable) from every decision path. Narrow `scope`, use `exclude`, or lower the observation limits.
- Per-call observation: `snapshot`, `observe`, `act`, `extract`, the semantic locate/compare/assert methods and `run` accept `maxElements`, `maxTexts` and `maxCandidates` for that call only, overriding the constructor limits in either direction. Per-call values are clamped to 1000 elements, 2000 texts and 2000 candidates; a non-positive or non-integer value fails with `INVALID_ARGUMENT`. `exclude: string[]` (at most 64 CSS selectors) leaves the matching subtrees, including open shadow content under a matched host, out of that observation, like Stagehand's `ignoreSelectors`; it is a noise filter, not a privacy boundary, because a surrounding row or form context string can still mention excluded text. The same fields are MCP tool properties, and CLI `--max-elements`/`--max-texts`/`--max-candidates` (also session defaults at `open`) and repeatable `--exclude CSS` apply to observing commands. `resume` cannot change them.
- `scope` also accepts a current `snapshot` or `locateSemantic` ref (`r…_e…_…`, optionally `ref:`-prefixed) in those methods: observation is limited to that element and its descendants in its own frame. An expired ref, or one from an earlier observation, fails with `STALE_TARGET` and is never read as a CSS selector. `run` and `resume` accept only a CSS scope, because a goal changes the page (`INVALID_ARGUMENT`).
- Launch: `browser` (`chromium`, `firefox`, `webkit`; environment `JEV_BROWSER`), `headless`, `launchOptions`, `contextOptions`, `storageState`, `userDataDir`, `cdpEndpoint`, `wsEndpoint`, `cdpHeaders`. Choose at most one profile/CDP/WebSocket mode. An attached browser's first existing context is borrowed, and `contextOptions` or `storageState` with one fail with `CONFIG`. `cdpHeaders` are sent on CDP (`connectOverCDP`) and WebSocket (`connect`) attach only (for example Cloudflare Browser Run `Authorization`); they are redacted from screen evidence and omitted from the session options hash like `apiKey`. CDP requires Chromium; PDF requires Chromium. Context options include ordinary Playwright locale, viewport, device, permissions and HTTP credentials settings.
- Files: `fileRoots` (default: the working directory), `outputDir`. Native uploads/artifacts use these boundaries. The CLI and MCP server grant no upload root unless `--file-root` is given. Explicit launch/profile paths are independently granted by the caller.
- Guard callbacks: `allowAction(plan, operation)` for Jev actions, `allowCommand(command, operation)` for native operations. Both require literal `true`. `operation` has `signal` and remaining `timeoutMs`. These callbacks do not restrict direct Page access or create a network sandbox.
- `allowEvaluate`: enables caller-authored page evaluation and init scripts. Disabled by default. No Node-side evaluation command exists.
- `captureDialogs`: holds `alert`, `confirm`, `prompt` and `beforeunload` dialogs for `handle_dialog`, and file choosers for `file_upload`, even when they open between operations. `launch()`, and therefore the CLI and MCP server, defaults to `true`. A borrowed Page defaults to `false`: Jev holds only dialogs that open while one of its operations runs, and Playwright's default dismissal applies to the caller's own Page actions.
- `vision`: opt-in image understanding for `screenDecide`, either `{ baseURL, model, apiKey?, timeoutMs?, fetch? }` for an OpenAI-compatible Chat Completions endpoint (HTTPS, or HTTP to a loopback host; otherwise `CONFIG` at construction) or your own `ImageUnderstanding` adapter. No environment variable is read by the SDK and no Jev key is reused. CLI/MCP: `--vision-base-url` and `--vision-model` together, key from `JEV_VISION_API_KEY` only, fixed when a session opens. See [image understanding](image-understanding.md).
- `screenFollowPopups`: requires `screenOnly` (otherwise `CONFIG`). A new tab the observed page opens becomes the observed page instead of being reported with `SCREEN_POPUP_UNSUPPORTED` and closed; the opener stays open, and observation returns to it when the followed tab closes. Screen results that switched pages carry `pageSwitched: 'popup' | 'opener'`. See [following new tabs](screen-review.md#following-new-tabs).
- `screenOnly`: fixes CLI/MCP/shared dispatch to `screen`, `screen_decide` and `close` for the session lifetime. Direct caller Page access remains trusted. `allowCommand` additionally receives `{command:'screen',request}` for screen operations; existing allowlists still need to permit it explicitly.

Per-operation `signal`, `timeoutMs` and `scope` are available where relevant. The default operation budget is 30 seconds, and 60 seconds for `run` and `resume`. A constructor `timeoutMs` replaces both defaults and is also the timeout of each Jev HTTP request, which is 15 seconds when it is omitted. A per-operation `timeoutMs` sets only that operation's budget. An exhausted budget fails with `TIMEOUT`; an aborted caller `signal` or `close()` fails with `CANCELLED`. Page evaluation has no Playwright timeout, so work stuck in a hung renderer is abandoned about one second after the deadline or cancellation and the Page is released for the next operation. A result that settles before that is returned even if the deadline passed meanwhile, so an executed action is not reported as cancelled. Cancellation does not roll back completed effects. User-supplied callbacks and custom decision engines must honor the signal and remain bounded.

## Main methods

| Method | Result and purpose |
| --- | --- |
| `goto(url, options?)` | `{url}`; HTTP(S) navigation through the native dispatch |
| `snapshot(options?)` | URL/title, elements, source texts, records, scroll and truncation metadata; no Jev call |
| `observe(instruction, {values?, ...options}?)` | One `ActionPlan` or `null`; no mutation |
| `act(instructionOrPlan, options?)` | `executed` or pending `dialog`, plan and URL |
| `extract(instruction, zodSchema, options?)` | `{data, evidence, snapshotId, decision?, decisions?}` |
| `locateSemantic(description, options?)` | `SemanticTarget`; grounded current ref + evidence + confidence, no generated selector |
| `compareSemantic(request, options?)` | `SemanticComparisonResult`; deterministic short-circuit or confidence-aware semantic comparison |
| `compareSemanticBatch(requests, options?)` | `SemanticComparisonResult[]`; independent source/comparison questions share decision frontiers |
| `assertSemantic(request, options?)` | same result on pass; throws distinct failed/inconclusive semantic assertion errors |
| `run(instruction, {values?, expect?, until?, ...options}?)` | `{status, reason, steps, inputs, effects, usage, verification?, checkpoints?, continuation?}`; verified multi-stage goal |
| `resume(continuationId, {values?, timeoutMs?, signal?}?)` | Same-session continuation; unknown saves reconcile read-only before authorized later work |
| `agent(defaults?).execute(instructionOrOptions)` | Same run result, same core loop |
| `native(command, options?)` | Typed command union; mechanical operation without a model |
| `screenshot(options?)` | Viewport PNG Buffer |
| `screen(request, options?)` | Viewport images, physical inputs, observation IDs and actual timestamps; no DOM/URL metadata. See [screen review](screen-review.md). |
| `screenDecide({questions, state?, capture?}, options?)` | `{decision, evidence}`; opt-in, needs `vision`. One `look` capture, one image description, one decision from that text. Sends no input; `evidence.observationId` is the current screen observation. See [image understanding](image-understanding.md). |
| `close()` | Disposes references/listeners, closes owned resources; waits at most about one second for an in-flight operation |

`observe` plans are local and single-use. `act(plan)` and `act({id: plan.id})` use the internally retained action, not fields supplied by the caller. A new AI observation, snapshot or navigation can invalidate a plan. Native snapshot refs may survive several operations as long as the original node and its meaning still match; a new snapshot replaces the reference set. Right before the effect (after `allowAction`/`allowCommand`), a plan or ref is re-checked against the Page, document, frame and `scope` it was observed in; a target that moved outside them fails with `STALE_TARGET`. Use a fresh snapshot after `STALE_TARGET`.

Single-action `act`/`observe` inputs can be explicit named string `values`, or quoted strings copied verbatim from the instruction. `run` additionally accepts nested JSON values and preserves JSON Pointer paths in input coverage. See [goal-runtime.md](goal-runtime.md) for its separate data and completion contract. Explicit values take precedence; they are not generated by Jev. Current quote syntax is ASCII double quotes, Japanese corner quotes and curly double quotes. Use named values for complex escaping or secrets.

## Extraction

Schemas can be scalar roots, objects with scalar fields, nested objects, or arrays of observed records. Scalar strings, numbers, booleans, compatible enums, optional and nullable scalar fields are supported. Arbitrary object unions, recursive schemas, dates, defaults, catch fallbacks, value-changing transforms and generated prose are not supported. Extract exact large integers as strings.

Use `recordsScope` for tables/cards with non-semantic markup. Nested record arrays follow actual nested DOM records. A value is copied from the selected source and validated; it is never freely generated. Each array item is restricted to one record's sources. For separate unrelated objects on the same page, narrow `scope` or make separate calls.

`evidence` is keyed by field path: field names and array indexes joined with `.` (`invoices.0.total`), a scalar root as `value`, and array items of scalars as `<path>.<index>.value`. A literal `.` or `\` inside a field name is escaped with `\` (`{'a.b': …}` is `a\.b`, while `{a: {b: …}}` is `a.b`), so each key splits back into its field names; an empty field name is an empty segment.

Evidence uses dotted object paths and zero-based record indices, such as `invoices.0.total`. Scalar roots use `value`. Scalar array items use `0.value`. Evidence contains original text, surrounding context, frame, source ID and copied value; hrefs also identify the `href` attribute. A missing required source is `EXTRACTION_MISSING`. Data violating the final schema is `EXTRACTION_SCHEMA`. An empty record set is `[]` unless the schema requires a minimum count.

The CLI/MCP accepts exactly one of `fields` (simple scalar definitions) or `schema` (JSON Schema). SDK callers use Zod directly. The JSON Schema conversion follows the installed Zod implementation; unsupported constructs are rejected.

## Semantic verification

Semantic verification is separate from native/Playwright assertions. Use exact assertions when the browser exposes exact truth; use semantic comparison when equivalence itself requires language understanding.

```ts
const result = await browser.compareSemantic({
  actual: { description: 'Current plan' },
  expected: 'Professional annual plan',
  minConfidence: 0.8,
});
```

`actual` is either `{description}`, a current `{ref}`, a `SemanticTarget` returned by `locateSemantic`, or SDK-only `{locator, property?, attribute?}` using a real Playwright Locator. Description-based actuals are first bound to one grounded observed source. A definition-list `term` is treated as a field label, not the field value. No semantic comparison can use a model-generated selector or an unobserved source.

Results contain `status` (`passed | failed | inconclusive`), model `choice` (`equivalent | different | insufficient_evidence`), final comparison `confidence`, separate `sourceConfidence`, comparison `threshold`, `sourceThreshold`, grounded `evidence`, provenance `source` (`deterministic | semantic`), and semantic usage metrics. `minConfidence` defaults to `0.8`; `minSourceConfidence` defaults to the effective comparison threshold. Both must be within `[0,1]`. A semantic assertion passes only when every model-dependent link needed for the assertion clears its own threshold: grounded-source selection and, when required, the semantic comparison. If source selection is already below `sourceThreshold`, comparison is skipped and the result is `insufficient_evidence` / `inconclusive`. Exact comparison itself is reported as deterministic and makes no second model call, while `sourceConfidence` still exposes source-selection uncertainty.

`confidence` is a Jev decision score, **not** a calibrated probability of correctness. `assertSemantic` throws `SEMANTIC_ASSERTION_FAILED` for a sufficiently confident `different` result and `SEMANTIC_ASSERTION_INCONCLUSIVE` for low confidence or insufficient evidence. An inconclusive result never passes.

`compareSemanticBatch` observes once when source discovery is needed. Independent source questions share one frontier and independent unresolved comparisons share the next. Usage reports `requests`, `questions`, `serialDecisionDepth`, token counts, `providerMs`, `observationMs`, and local `verificationMs`. Transport chunks forced by the 64-question / 128 KiB limits remain one dependency depth when they can run concurrently.
The same aggregate batch `usage` is attached to each item returned by `compareSemanticBatch()` for result-shape consistency; it must be counted once, not summed across items.

See [semantic-verification.md](semantic-verification.md) for the verification model, privacy boundary, calibration discipline and examples.

## Native command groups

All accept `{command: name, ...args}` in `native()`, `--args JSON` in CLI, and `browser_<name>` in MCP. A target is a snapshot `ref` or a caller-authored Playwright selector in `target`; `frame` is optional. `element` is an optional human-readable description, not a selector.

| Group | Commands |
| --- | --- |
| Navigation | `navigate`, `navigate_back`, `navigate_forward`, `reload` |
| Input | `click`, `type`, `hover`, `drag`, `press_key`, `select_option`, `check`, `fill_form`, `mouse` |
| Synchronization | `wait_for`, `assert` |
| Browser structure | `tabs`, `frames`, `resize`, `handle_dialog` |
| Files | `file_upload`, `downloads`, `take_screenshot`, `pdf` |
| Inspection | `console_messages`, `network_requests`, `evaluate` |
| State/test setup | `storage`, `cookies`, `storage_state`, `trace`, `route`, `init_script` |

In the CLI and MCP server, `cookies`, `storage` and `storage_state` need `--caps storage`, `route` needs `network`, `trace` needs `trace`, and `evaluate` and `init_script` need `evaluate`; otherwise the MCP tool is not listed and the CLI returns `CAPABILITY_DISABLED`. `createMcpServer(core, { capabilities })` applies the same filter; without `capabilities` it registers every tool. SDK `native()` is not gated.

Examples:

```ts
await browser.native({ command: 'type', target: 'input[name=email]', text: 'user@example.invalid' });
await browser.native({ command: 'select_option', target: 'select', values: ['pro'] });
await browser.native({ command: 'check', target: 'input[type=checkbox]', checked: true });
await browser.native({ command: 'wait_for', text: 'Saved' });
await browser.native({ command: 'assert', target: 'h1', property: 'text', expected: 'Saved' });
await browser.native({ command: 'tabs', action: 'new', url: 'https://example.com' });
await browser.native({ command: 'trace', action: 'start' });
await browser.native({ command: 'trace', action: 'stop', filename: 'trace.zip' });
```

Assertions support `visible`, `hidden`, `enabled`, `text`, `value`, `checked`, `count`, `url`, `title`. They poll within the operation budget, up to five seconds, and fail with `ASSERTION_FAILED` when the value does not match in time. Errors from reading the target, such as `AMBIGUOUS_TARGET` when a selector matches several elements, propagate as errors rather than `ASSERTION_FAILED`. Text assertions compare exact `textContent`. Native `select_option` replaces the selection set as Playwright does. Without `by`, each string matches an option value or label; `by: 'value'` matches values exactly and `by: 'label'` labels only. A string with no matching option waits until the operation budget ends and fails with `TIMEOUT`. AI `select`/`deselect` candidates preserve unrelated multiselect choices.

A dialog result must be handled with `handle_dialog` before other operations. Its `dialog` carries `id`, `type`, `message`, `defaultValue` and the `pageId` of the tab that opened it. `console_messages`, `network_requests` and `downloads` `list` report the selected tab; pass `allTabs: true` to include every tab of the context. Each entry carries a `pageId`, which matches the `pageId` in `tabs` results for the same session. This telemetry is Page-scoped, not core-scoped: console messages, page errors and requests are emitted by the Page, whichever code caused them, so several cores sharing one Page (only one operates at a time, the others fail with `BUSY`) each record every event of that Page from the time they attached, including ones caused by another core's operation or the caller's own code. Each core keeps its own buffers and `pageId` numbering, and `clear: true` empties only that core's buffer, so it works as a per-core read cursor. To attribute events to one core, give it its own Page. `downloads` supports `list`, `save`, `cancel`; `save` and `cancel` take a stable download `id`, or an `index` into the selected tab's current list, and a chosen output filename. The list keeps the 100 newest downloads, so an index can move to another download while an id cannot; an `allTabs` list reports ids only. Each download also carries `navigation`, the navigation generation of its tab when it started: it increases with every main-frame navigation, so downloads started by different documents of one tab can be told apart. File upload can use a file input target, or a chooser opened on the selected tab. Navigating that tab discards its pending chooser. Jev listens for file choosers only while it holds dialogs: during its own operations, and between them when `captureDialogs` is set (the default for `launch()`, the CLI and MCP). Such a chooser is intercepted, so a headed browser does not show the native file picker. On a borrowed Page without `captureDialogs`, a chooser your own code opens is left to Playwright and is not available to `file_upload`; open it through a Jev operation (for example a native `click`) instead. Screenshots support `type`, `fullPage`, target and output filename. Cookie/state/console/trace results may contain secrets.

## Errors and automation

`JevBrowser` operations reject with `BrowserError`. Its `code` is stable: codes are never renamed or removed, and the exported `BrowserErrorCode` type lists them. `retryable` is true only when repeating the same call unchanged may succeed and cannot repeat an effect of the failed attempt, for example `BUSY`, `STALE_SNAPSHOT`, a transient `PROVIDER_ERROR`, or a `TIMEOUT` before any action started. It is false once an action has started. Jev Browser itself never retries a failed call; it only retakes a read-only observation interrupted by navigation, within the same budget. `cause` keeps the original Playwright or provider error for local diagnostics. CLI/MCP errors are `{code, message, retryable, partial?, semantic?}` and never include `cause` or provider response bodies.

| Code | Meaning |
| --- | --- |
| `TIMEOUT` | The operation's `timeoutMs` budget, or a caller timeout signal, ran out. The message says whether an action had started. |
| `CANCELLED` | The caller's `signal` aborted, or `close()` ran during the operation. |
| `TARGET_OBSCURED` | Another element intercepts pointer events over the target, and Playwright's call log shows the action was never delivered. Dismiss the covering element, then observe again. |
| `AMBIGUOUS_TARGET` | A caller selector matched several elements under Playwright strict mode. Use a more specific selector or a snapshot ref. |
| `INVALID_SELECTOR` | A caller selector or `scope` could not be parsed. `run()` and `resume()` check `scope` before observing, so no partial result is attached. |
| `TAB_CLOSED` | The selected tab was closed, for example by the page or the caller's own code. Jev does not switch tabs by itself: use `tabs` with action `list`, then `select` (or `new`). Screen tools report a closed Page as `SCREEN_FAILED` with reason `page-closed` instead. |
| `NAVIGATION_FAILED` | Navigation, back, forward or reload failed, for example on a DNS or connection error. |
| `BROWSER_LAUNCH_FAILED` | Launching or attaching to a browser failed. A missing browser build names the `jev-browser install` command. |
| `OBSERVATION_LIMIT` | The observation or decision request is too large: an observation was truncated, a decision request exceeds its 128 KiB budget, or hosted Jev rejected the request as over its input token limit (HTTP 400 `max_tokens_exceeded`, after the provider call). Not retryable unchanged: narrow `scope`, use `exclude`, or lower `maxElements`/`maxTexts`/`maxCandidates`. |
| `PROVIDER_ERROR` | The decision provider failed. Retryable only for transport failures, HTTP 408, 429 and 5xx; other responses, such as HTTP 400 or 401, are not. Provider response bodies are withheld. |
| `ACTION_INTERRUPTED`, `ACTION_FAILED` | An AI-planned action started and did not finish normally. It may have changed the page. |
| `OPERATION_FAILED` | Any other unexpected local failure. |

Messages for mapped Playwright failures add the first line of the underlying error, capped at 200 characters, with URL credentials, query and fragment removed. Messages thrown by page code during evaluation are withheld. Other stable codes distinguish configuration, unsupported schemas, missing candidates/evidence, stale refs/plans, failed assertions, denied capabilities, and session failures.

Some errors add sanitized machine-readable `details`, which CLI/MCP errors include. Screen validation errors list the failing `issues`, and screen capture failures state a `reason`. See [screen review](screen-review.md#freshness-and-failures).

A native/AI command returning `executed` means the operation ran, not that the business workflow succeeded. Goal execution can also establish UI readback by comparing a fresh result record with actual supplied values. Inspect the verification source and unobserved fields; this does not prove database durability. Never treat confidence or the absence of an exception as a passed E2E assertion.

Downloads are reported after the browser emits a download event. A click returning does not imply a download has started. In SDK workflows, register `page.waitForEvent('download')` before clicking; native clients can inspect the current download list in a later command. Whether a resource is rendered or downloaded depends on browser behavior and the response MIME/Content-Disposition headers.

## Goal continuation

See [goal-continuation.md](goal-continuation.md) for checkpoint evidence, final assertions, immutable inputs, same-Page/origin/scope ownership and unknown-effect reconciliation. SDK, persistent CLI `resume` and MCP `browser_resume` share one runner. A thrown `BrowserError.partial` may contain the continuation; inspect it rather than re-running the original task.

## v0.7 semantic refinements

- `locateSemanticBatch(descriptions, options)` returns reusable targets from one retained observation.
- `assertSemanticBatch(requests, options)` applies the same confidence policy as compare, then re-reads sources before returning. It rejects an empty assertion batch.
- `compareSemantic*` returns snapshot evidence; `assertSemantic*` returns only after a live re-read or throws with changed/inconclusive evidence. `freshness` is `snapshot`, `verified` or `changed`.
- SDK Locator properties are `text` (default), `value`, `checked`, `attribute` (explicit attribute name). The source must be uniquely visible within the current Page and optional scope.
- `@tontoko/jev-browser/playwright` exports `semanticMatchers(core)` for the caller's existing `expect.extend`.
- CLI/MCP batch commands are read-only. `semantic_compare_batch` / `semantic_assert_batch` return `{results,usage}` and support global or per-item thresholds. `semantic_locate_batch` returns `{targets}`.
- `BrowserError.semantic` preserves `{results,expected}` through process boundaries; provider bodies and credentials are never attached. Result `models` retains named inference provenance; `model` is omitted for incomplete/mixed attribution.

See [semantic-verification.md](semantic-verification.md) for precise property, freshness, negation and data disclosure semantics.

### Permitted native selection interpretation

`RunOptions.semanticInputs?: Record<string, number>` maps explicitly disclosed JSON Pointer input paths to confidence thresholds. It is accepted through all run adapters. Default named inputs remain exact/local. `RunResult.blockers` explains grounded missing fields or unresolved supplied selections; `unresolved-input` is distinct from `missing-input`. `RunInput.resolution` records semantic option interpretation and `RunVerification.semanticInputs` identifies readback relying on it. See [observed input resolution](observed-input-resolution.md) for privacy, confidence, and native-only boundaries.
