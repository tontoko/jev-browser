# Contributing

Use Node.js 22.15+ and the locked dependencies. Do not send production data to a live model test.

```sh
npm ci
npx playwright install chromium
npm run check
npm run check:examples
npm run check:package
```

A behavior change needs a regression test that fails before the fix. Tests use real Playwright browsers and either a deterministic decision engine or a local TypeSafe-format HTTP service. Mock only the model decision boundary, not the browser outcome. `npm run test:live` is explicit opt-in and needs a Jev key; default CI has no provider credentials.

Keep CLI and MCP as adapters over the shared schema/dispatcher and core. Prefer Playwright's existing behavior over custom retries, selector engines, workflow DSLs and defensive machinery. A model opinion must not become a passing assertion. Do not add automatic mutation retries. New native commands need schema validation, authorization coverage, transport coverage and documentation. Preserve borrowed resource ownership.

For Firefox/WebKit checks, install the desired engine and set `JEV_BROWSER=firefox` or `JEV_BROWSER=webkit`. A small number of Chromium-specific connection checks also require Chromium. Public CI uses hosted runners, never a maintainer's development machine for untrusted pull requests.

Submit a focused pull request explaining the user-visible problem, reproducer and verification. Do not include `.env`, cookies, screenshots of private applications, local absolute paths, generated archives or traces. See SECURITY.md for private reports. Contributions are provided under the project's Apache-2.0 license.
