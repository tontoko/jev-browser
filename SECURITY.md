# Security and data boundaries

## Reporting

Report vulnerabilities privately using the repository's Security → Report a vulnerability feature. Do not put real tokens, customer data, authentication state, traces, or exploit targets in public issues. Ordinary reproducible bugs can use synthetic fixtures in Issues. No response-time SLA is promised.

## Trusted caller, untrusted page

This package is a local automation tool, not a browser sandbox, a network firewall, or an authorization service. Run it under a least-privilege account, use isolated browser contexts and synthetic data, and keep it away from untrusted multi-tenant callers. Browsers can reach local networks and authenticated services. Page content is untrusted: the prompt labels it as data, but that is not a proof against prompt injection.

Jev can choose only operations supplied by the runtime. This prevents generated selectors/commands, not incorrect choices among legitimate candidates. `allowAction` controls AI-selected actions. `allowCommand` controls native commands and the native primitives selected by the goal runtime, including dialog responses. They do not constrain direct SDK `page` access, website scripts, redirects, or browser networking. A policy must return literal `true` to permit a guarded operation.

## What goes to the configured decision endpoint

Natural-language instructions, observed page URL/title, visible semantic text, element names, context, options, href evidence, action history and available input binding names may be sent to the configured decision endpoint. Hosted Jev is the default; `baseURL` / `JEV_BASE_URL` can redirect the same System One wire format to another trusted endpoint. Custom endpoints may log or retain data independently of this package. Explicit input values in `values` are withheld, but input echoed into page text, labels, option values, link query strings, or instructions can still contain secrets. This is not a general redaction filter. Quoted input is already part of the instruction and is not secret from the provider.

`locateSemantic` sends the caller description. `compareSemantic` / `assertSemantic` send the caller-provided expected semantic meaning whenever local exact comparison cannot settle the result, together with the selected grounded actual evidence. Using semantic comparison on a secret expected literal therefore explicitly exposes that literal to the configured provider. Prefer deterministic/native/Playwright assertions when a sensitive fact can be checked locally.

Native operations, screenshots, assertions, navigation, and tool discovery do not call Jev. Screenshots, console output, storage exports and traces can contain sensitive content. The TypeSafe SDK is configured with logging off. Single-operation decisions default to no retries; a goal may retry a read-only decision through the SDK up to `decisionRetries` (default 2, maximum 2), within its operation budget. Browser mutations are never retried by that transport policy. API responses are validated before being used. No credentials or API keys are stored by the package on behalf of the provider; keys are read from environment/configuration. Consult the provider's current data policy before using customer data.

## Files and profiles

Native uploads default to the current working directory as their read root; use a dedicated `--file-root` for tighter access. Explicit launch options such as `--storage-state` and `--user-data-dir` grant access to the specified profile. Use test profiles, not your daily browser profile.

Artifacts default to `.jev-browser/artifacts`. Traversal, existing output paths and symlinked intermediate directories are refused. Inputs are resolved before checking allowed roots. These checks do not defend against a malicious local process running as the same OS user. Do not place secrets or build credentials in file roots exposed to an automation client.

## Sessions and code evaluation

Named CLI sessions listen only on loopback and require a randomly generated bearer token. Their descriptor files and directories are private on POSIX systems. Browser-origin HTTP requests are refused. Keep `JEV_SESSION_DIR` private and within the same trusted account; the token must never be published. Windows access additionally depends on the user's filesystem ACLs.

An unavailable session does not cause a browser action to be replayed. A dead worker descriptor can be reclaimed by `open` only after the owning process is no longer present. Live or unidentifiable processes are never killed during recovery. Incomplete or damaged metadata may require manual cleanup after verifying no session is running.

`--allow-evaluate` / `allowEvaluate` enables caller-authored code in the browser realm and init scripts. It is off by default and is not a security sandbox. No native command evaluates arbitrary Node-side code. Trusted SDK users have normal Playwright access and can write Node code in their own application.

## Cancellation, refs and completion

Mutation attempts consume AI plans; failures are not automatically retried. Snapshot refs are bound to the observed node and checked before use. Native select expectations also retain the observed option index/label/value identity, so a different option inserted at the same index is not treated as the old semantic choice. ARIA combobox option clicks are restricted to a unique visible enabled option inside the popup declared by the bound control and are rechecked after authorization. Their validation and the eventual browser event are not one atomic transaction. A cancellation can stop a pending action, but cannot roll back a click, request, upload or submission that already happened. Inspect state before deciding whether to retry.

Goals may also report `complete / ui-readback` after selecting a fresh result record and comparing its observed values locally. The result distinguishes caller checks, inferred UI evidence, readback fields and unobserved fields. A matching UI is not proof of database durability or exactly-once execution. Known string echoes are redacted in goal requests/results without changing protocol IDs; this remains a best-effort filter, not a general data-loss-prevention boundary. Normal confirm/alert responses use current dialog identity and both authorization hooks; a model judgment is not an authorization service.

Semantic assertions are a separate, explicit model-based verification mode. They retain grounded evidence, the source-selection score, final semantic score, comparison threshold and source threshold. `minSourceConfidence` defaults to the effective `minConfidence`; lowering it is an explicit caller policy choice. Low-confidence source selection, low-confidence comparison, and insufficient-evidence results are inconclusive rather than passing. Confidence is not authorization, end-to-end correctness calibration, or a probability of assertion truth. When exact truth is available, deterministic Playwright/native assertions remain the stronger oracle.

## Continuation ownership and unknown effects

Continuations retain copied input values and reconciliation evidence in the current core's memory only. Public IDs contain no input literals. Resume requires the original Page/origin and unchanged observation scope. Existing values and their object structure cannot be overwritten, including by replacing a leaf with an object. Closing the core or completing the continuation deletes its ID; there is no durable cross-process recovery.

Pending commit metadata is recorded at the execution-start boundary. Cancellation or a provider failure afterward retains a partial result instead of silently restarting the task. A pending save is reconciled through the same read-only verification path as ordinary readback before later mutations are allowed. A verified action signature remains blocked across unrelated actions and resume; this is a conservative browser guard, not server idempotency or exactly-once delivery.

Intermediate `continue` requires an identified successful stage and locally checked result evidence. `incomplete` does not authorize a later save. When caller `until` and `expect` are both configured, neither can bypass the other. Authorization hooks still run for resumed effects and assertions. Direct caller Page access, page scripts and changes in account/tenant context remain outside a universal transaction guarantee.

## Live semantic assertions and diagnostic data

Semantic comparisons report captured snapshot evidence. Semantic assertions re-read selected sources before returning, marking changed/disappeared evidence inconclusive. This check is not atomic with every page process or subsequent caller action and is not database truth. A caller's real Locator can explicitly read visible text, native values, checked state or one attribute; it must belong to the same Page and respect caller scope. These selected values and expected meanings are sent to the endpoint only when semantic inference is needed. Exact comparisons work without provider configuration.

Resolved assertion failures carry `semantic.results` and `semantic.expected`, including old/current evidence and confidence thresholds. Named sessions, CLI and MCP preserve this payload; existing authorization protects the session, not the contents of an exported log. Do not upload report attachments containing real customer data. The optional Playwright matcher never treats an inconclusive result as a successful negative assertion and never retries unchanged evidence to seek a favorable model answer.
