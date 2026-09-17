# Security and data boundaries

## Reporting

Report vulnerabilities privately using the repository's Security → Report a vulnerability feature. Do not put real tokens, customer data, authentication state, traces, or exploit targets in public issues. Ordinary reproducible bugs can use synthetic fixtures in Issues. No response-time SLA is promised.

## Trusted caller, untrusted page

This package is a local automation tool, not a browser sandbox, a network firewall, or an authorization service. Run it under a least-privilege account, use isolated browser contexts and synthetic data, and keep it away from untrusted multi-tenant callers. Browsers can reach local networks and authenticated services. Page content is untrusted: the prompt labels it as data, but that is not a proof against prompt injection.

Jev can choose only operations supplied by the runtime. This prevents generated selectors/commands, not incorrect choices among legitimate candidates. `allowAction` controls AI-selected actions; `allowCommand` separately controls explicit native commands. They do not constrain direct SDK `page` access, website scripts, redirects, or browser networking. A policy must return literal `true` to permit a guarded operation.

## What goes to Jev

Natural-language instructions, observed page URL/title, visible semantic text, element names, context, options, href evidence, action history and available input binding names may be sent to the configured TypeSafe endpoint. Explicit input values in `values` are withheld, but input echoed into page text, labels, option values, link query strings, or instructions can still contain secrets. This is not a general redaction filter. Quoted input is already part of the instruction and is not secret from the provider.

Native operations, screenshots, assertions, navigation, and tool discovery do not call Jev. Screenshots, console output, storage exports and traces can contain sensitive content. The TypeSafe SDK is configured with logging off and no automatic retry. API responses are validated before being used. No credentials or API keys are stored by the package on behalf of the provider; keys are read from environment/configuration. Consult the provider's current data policy before using customer data.

## Files and profiles

Native uploads default to the current working directory as their read root; use a dedicated `--file-root` for tighter access. Explicit launch options such as `--storage-state` and `--user-data-dir` grant access to the specified profile. Use test profiles, not your daily browser profile.

Artifacts default to `.jev-browser/artifacts`. Traversal, existing output paths and symlinked intermediate directories are refused. Inputs are resolved before checking allowed roots. These checks do not defend against a malicious local process running as the same OS user. Do not place secrets or build credentials in file roots exposed to an automation client.

## Sessions and code evaluation

Named CLI sessions listen only on loopback and require a randomly generated bearer token. Their descriptor files and directories are private on POSIX systems. Browser-origin HTTP requests are refused. Keep `JEV_SESSION_DIR` private and within the same trusted account; the token must never be published. Windows access additionally depends on the user's filesystem ACLs.

An unavailable session does not cause a browser action to be replayed. A dead worker descriptor can be reclaimed by `open` only after the owning process is no longer present. Live or unidentifiable processes are never killed during recovery. Incomplete or damaged metadata may require manual cleanup after verifying no session is running.

`--allow-evaluate` / `allowEvaluate` enables caller-authored code in the browser realm and init scripts. It is off by default and is not a security sandbox. No native command evaluates arbitrary Node-side code. Trusted SDK users have normal Playwright access and can write Node code in their own application.

## Cancellation, refs and completion

Mutation attempts consume AI plans; failures are not automatically retried. Snapshot refs are bound to the observed node and checked before use. Their validation and the eventual browser event are not one atomic transaction. A cancellation can stop a pending action, but cannot roll back a click, request, upload or submission that already happened. Inspect state before deciding whether to retry.

Only deterministic assertions or a caller-supplied read-only predicate establish verified completion. Confidence is not authorization, calibration of end-to-end correctness, or a test oracle.
