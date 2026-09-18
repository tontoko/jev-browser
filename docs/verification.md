# Verification

Release checks are executable, not inferred from a build passing. See the CI workflow on the exact release commit and the release notes for the final results.

## Layers

- `npm run check`: TypeScript build, DOM bundle, real browser regressions, injected decision tests, local HTTP provider fixtures, CLI subprocesses, MCP wire exchanges, and named-session authorization tests.
- `npm run check:examples`: strict checking of public-package Playwright Test examples.
- `npm run check:package`: builds the real tarball, installs it into an isolated consumer, exercises installed SDK/native/goal/semantic paths, uses independent persistent CLI commands, and talks to the installed MCP stdio executable through the official client. The semantic package check uses a deterministic synthetic provider; no real provider key is required.
- `npm run test:live`: explicit real Jev tests on synthetic local pages for grounded actions, extraction, adapters and goal execution.
- `npm run test:live:semantic`: explicit real Jev semantic-verification fixtures. It records grounded source, source confidence, semantic choice, final confidence/threshold outcome, decision depth and usage for neutral synthetic pages.

Offline success does not establish model accuracy. Live fixture success does not establish accuracy on arbitrary websites or comprehensive injection resistance. No comparative cost/latency advantage over Stagehand or Microsoft tools is claimed.

Semantic live fixtures distinguish expected direction from threshold outcome: a correct semantic direction below the configured confidence threshold is expected to remain `inconclusive`. Source-selection confidence is logged separately from comparison confidence. Neither score is presented as a probability of correctness. Candidate-order variants are regression evidence for grounding stability, not a statistical calibration study by themselves.

## Regression discovered during integration

Public element refs received per-observation nonces to prevent accidental reuse against replacement nodes. Passing those same nonces to Jev caused the multistep registration fixture to refill completed fields and hit the step budget. A failing offline contract and real-provider failure trace isolated the problem. The fix retains nonce-bound refs for execution but uses stable local labels in model state and history. No threshold override, fallback model, larger step budget or hidden retry was added.

Other regressions cover cancellation followed by a late click, truthy-but-false completion/policy objects, schema-generated values, native form partial mutation on invalid arguments, reference reuse, interrupted/sequential dialogs, symlink boundaries, mixed checkbox state, multiselect drift and unsafe numeric rounding.

## Review boundary

An independent Codex review was attempted during preparation but stopped at the account's usage limit before reviewing source. No independent-model approval is claimed. Release confidence comes from direct source review and executed checks. Provider/model versions and observed runs belong in the release notes; do not substitute results from a previous local prototype.

## Release preparation evidence (2026-09-17)

On commit `90c441cbcd28c42cea95cf43fc2a9ef4e9d07484`, the local full suite passed **133/133** without skips. The real-provider suite passed **16 cases three consecutive times (48/48)**, using `jev-1.13.0` and synthetic pages only. The installed-tarball SDK, native Playwright assertions, persistent CLI and MCP checks also passed. Those local results are not a substitute for the hosted matrix on the release commit.

Hosted verification runs Ubuntu with Node 22/24 and Chromium/Firefox/WebKit, plus macOS and Windows with Node 24 and Chromium. Each job builds, tests, checks the public examples and installs/exercises the real package. Pull requests use hosted runners without provider credentials. POSIX symlink tests are intentionally skipped on Windows; the portable upload-root test runs on every platform.

The first cross-platform runs exposed fixture assumptions: a Linux-only unshared-file path, an overly short cold-browser budget in an idle-time test, and a download fixture with no content type. The file test now creates an actual unshared temporary file on every platform. The idle gap still exceeds the command budget, while cold Firefox startup is no longer treated as a latency assertion. Downloads wait for the native event rather than sleep, and the server specifies `application/octet-stream`, as in Playwright's own [download fixtures](https://github.com/microsoft/playwright/blob/v1.63.0/tests/library/download.spec.ts). Browser-specific MIME/download behavior remains Playwright's responsibility; no test is made successful by hiding an empty download list.

A Gitleaks 8.30.1 scan of the commit history and runtime dependency audit reported no findings during preparation. Scanning is not a guarantee that all security issues are absent. Final release notes identify the exact CI run and distributed tarball checksum.
