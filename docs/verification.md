# Verification

Release checks are executable, not inferred from a build passing. See the CI workflow on the exact release commit and the release notes for the final results.

## Layers

- `npm run check`: TypeScript build, DOM bundle, real browser regressions, injected decision tests, local HTTP provider fixtures, CLI subprocesses, MCP wire exchanges, and named-session authorization tests.
- `npm run check:examples`: strict checking of public-package Playwright Test examples.
- `npm run check:package`: builds the real tarball, installs it into an isolated consumer, exercises the installed SDK with native Playwright assertions, uses independent installed CLI commands through a persistent session, and talks to the installed MCP stdio executable through the official client. No provider key is required.
- `npm run test:live`: explicit real Jev tests on synthetic local pages. It includes Japanese duplicate labels, inputs, invoices, absent actions, multistep registration, frames, shadow DOM, a single prompt-injection fixture, quoted inputs, filtered record extraction and a named CLI session.

Offline success does not establish model accuracy. Live fixture success does not establish accuracy on arbitrary websites or comprehensive injection resistance. No comparative cost/latency advantage over Stagehand or Microsoft tools is claimed.

## Regression discovered during integration

Public element refs received per-observation nonces to prevent accidental reuse against replacement nodes. Passing those same nonces to Jev caused the multistep registration fixture to refill completed fields and hit the step budget. A failing offline contract and real-provider failure trace isolated the problem. The fix retains nonce-bound refs for execution but uses stable local labels in model state and history. No threshold override, fallback model, larger step budget or hidden retry was added.

Other regressions cover cancellation followed by a late click, truthy-but-false completion/policy objects, schema-generated values, native form partial mutation on invalid arguments, reference reuse, interrupted/sequential dialogs, symlink boundaries, mixed checkbox state, multiselect drift and unsafe numeric rounding.

## Review boundary

An independent Codex review was attempted during preparation but stopped at the account's usage limit before reviewing source. No independent-model approval is claimed. Release confidence comes from direct source review and executed checks. Provider/model versions and observed runs belong in the release notes; do not substitute results from a previous local prototype.
