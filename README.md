# Jev Browser

**Parallel semantic decisions. Deterministic Playwright effects. Explicit verification provenance.**

Jev Browser combines native Playwright operations with [Jev](https://typesafe.ai) decisions over actual page elements. Use it instead of a Playwright MCP/CLI setup for browser automation, and instead of Stagehand for DOM-grounded `act`, `observe`, structured `extract`, and bounded agent workflows.

Native operations and assertions run **without an AI key**. Natural-language operations use the official TypeSafe SDK. Jev chooses supplied candidates; it does not generate executable JavaScript or selectors. The project is Apache-2.0 licensed; the hosted Jev service and model weights are not included.

[日本語](README.ja.md) · [Migration guide](docs/migration.md) · [API](docs/api.md) · [Semantic verification](docs/semantic-verification.md) · [Security](SECURITY.md) · [Verification](docs/verification.md)

## Install

Node.js **22.15 or newer**. Download the package from [GitHub Releases](https://github.com/tontoko/jev-browser/releases), then install it into your project:

```sh
npm install --save-dev ./tontoko-jev-browser-0.5.0.tgz
npx playwright install chromium
```

Or build from source:

```sh
git clone https://github.com/tontoko/jev-browser.git
cd jev-browser
npm ci
npx playwright install chromium
npm run build
node dist/cli.js --help
```

The release tarball includes compiled JavaScript, declarations, the DOM bundle, documentation, and examples. There is no postinstall browser download and no requirement for a global browser daemon. The package is distributed on GitHub Releases; a registry publication is not implied.

## One request, a complete creation task

```ts
const result = await browser.run(
  'Open the new customer form, fill all supplied details, and Save. Do not send a marketing email.',
  { values: {
      customer: { name: 'Example Customer', email: 'customer@example.invalid' },
      account: { plan: 'Professional annual', region: 'Japan' },
  } },
);
```

`run` owns form discovery, parallel field-binding questions, serial native inputs, relevant waits, onward steps and ordinary save confirmations. It checks current input values before a commit, then looks for a new result record and compares its values locally. Long native selects are resolved only when their semantics are needed; exact named values stay local. Standards-associated ARIA comboboxes are handled as bounded open/filter → owned-option → verified-selection interactions. Crowded pages can narrow themselves to a semantic form/result region instead of transmitting a truncated whole page. It does not call the model after every field. Existing native tools and single-action `act` remain available.

Read `result.status`, `verification` and `inputs`: `complete / ui-readback` identifies UI evidence, not a database durability guarantee. `unobserved` explicitly lists fields not shown after saving. A model's done opinion alone is never completion. Add `expect` assertions or an SDK `until` predicate for application-specific acceptance criteria. A failed/uncertain save is not replayed.

Try the self-contained local HTTP example with synthetic records:

```sh
JEV_API_KEY=... npm run example:goal
# Prefer your secret store or Node --env-file over a literal key in shell history.
```

CLI and MCP use the same goal contract; there is no separate agent implementation:

```sh
npx jev-browser run --session work --args - <<'JSON'
{"instruction":"Add a new contact, fill all supplied fields and Save.","values":{"contact":{"name":"Example Contact","email":"contact@example.invalid"}}}
JSON
```

For MCP, send the same JSON to `browser_run`. See [goal execution and boundaries](docs/goal-runtime.md).

## CLI: persistent browser, independent commands

```sh
npx jev-browser open https://example.com --session work
npx jev-browser snapshot --session work
# Use the ref returned by snapshot, or a caller-authored Playwright selector:
npx jev-browser click 'a' --session work
npx jev-browser take_screenshot --args '{"filename":"page.png","fullPage":true}' --session work
npx jev-browser close --session work
```

A named session survives separate CLI invocations. Its authenticated loopback endpoint is stored in a private directory, names are scoped to the working directory, and an idle session expires after 30 minutes. `open` defaults to session `default`; commands without `--session` reuse that session when it exists. `--url` without `--session` runs in a fresh browser.

Every command accepts `--args JSON`, and `--args -` reads arguments from stdin. `session` is also available as a JSONL pipe for tools that keep stdin open. All results are JSON. Exit status is `0` for command success, `1` for errors/assertion failures, and `2` for a stopped/unverified agent or a pending dialog.

```sh
npx jev-browser fill 'input[name=email]' 'user@example.invalid' --session work
npx jev-browser assert --args '{"target":"input[name=email]","property":"value","expected":"user@example.invalid"}' --session work
```

For natural-language operations, set `JEV_API_KEY` or `TYPESAFE_API_KEY`:

```sh
npx jev-browser act 'Fill the Name field with "Alice Example"' --session work
npx jev-browser act 'Fill the email field with email' \
  --values '{"email":"user@example.invalid"}' --session work
npx jev-browser extract 'Read the invoice total' \
  --fields '{"total":{"type":"number","description":"Total, not subtotal"}}' --session work
```

Explicit `values` are kept out of decision payloads. Quoted values are copied verbatim from the caller's instruction, which itself is sent to Jev. Page text and page-echoed input can contain private data: see [the data boundary](SECURITY.md).

## MCP: native and natural-language tools

After installing the tarball, configure your MCP client:

```json
{
  "mcpServers": {
    "jev-browser": {
      "command": "node",
      "args": ["/absolute/project/node_modules/@tontoko/jev-browser/dist/mcp-stdio.js"],
      "env": { "JEV_API_KEY": "YOUR_KEY" }
    }
  }
}
```

The environment entry is unnecessary for native operations. Prefer your client's secret store over putting real keys into committed JSON. Browser launch is lazy: tool discovery does not start a browser.

`browser_snapshot` provides refs for `browser_click`, `browser_type`, and other native tools. `browser_act`, `browser_observe`, `browser_extract`, and `browser_run` use the **same core** as the SDK. Native `browser_assert` verifies facts without asking a model. Tools also cover tabs, frames, dialogs, uploads/downloads, screenshots, PDF, mouse/keyboard, storage, cookies, routing, traces, console messages, and request metadata.

## SDK: existing Playwright Page and assertions

```ts
import { test, expect } from '@playwright/test';
import { JevBrowser } from '@tontoko/jev-browser';
import { z } from 'zod';

test('save a name', async ({ page }) => {
  await page.setContent(`
    <label>Name<input></label>
    <button onclick="document.querySelector('h1').textContent='Saved'">Save</button>
    <h1>Pending</h1>
  `);
  const browser = new JevBrowser({ page });
  try {
    await browser.act('Fill the Name field with name', { values: { name: 'Alice' } });
    await browser.act('Click Save');
    await expect(page.getByRole('heading')).toHaveText('Saved');
    const result = await browser.extract('Read the heading', z.object({ title: z.string() }));
    expect(result.data.title).toBe('Saved');
    expect(result.evidence.title.text).toBe('Saved');
  } finally {
    await browser.close(); // does not close the borrowed Page/context/browser
  }
});
```

`JevBrowser.launch()` owns its resources. Chromium, Firefox, WebKit, persistent profiles, CDP, and Playwright WebSocket connections are supported. The SDK exposes `browser.page`, so native Playwright assertions, locators, fixtures and application-specific verification remain available.

### Semantic locate and confidence-aware assertions

Use deterministic Playwright/native assertions whenever exact browser truth is available. When the UI expresses the same meaning with different wording, semantic verification is explicit rather than silently mixed into deterministic assertions:

```ts
const target = await browser.locateSemantic('The control that manages the current subscription');
await browser.native({ command: 'click', ref: target.ref });

const result = await browser.compareSemantic({
  actual: { description: 'Current subscription plan' },
  expected: 'Professional annual subscription',
  minConfidence: 0.8,
});

await browser.assertSemantic({
  actual: { description: 'Billing state' },
  expected: 'Paid',
  minConfidence: 0.9,
});
```

Semantic comparison returns grounded evidence, `passed | failed | inconclusive`, the comparison `confidence`, the separate `sourceConfidence`, and both thresholds. `minConfidence` defaults to `0.8`. `minSourceConfidence` defaults to the effective `minConfidence`, but can be tuned separately when source-selection scores have a different distribution. **Confidence is a Jev decision score, not a probability that the assertion is correct.** Low-confidence and insufficient-evidence outcomes never pass. A below-threshold source stops there instead of spending a second comparison request. Exact grounded equality likewise short-circuits locally without a second semantic comparison call.

Independent assertions can use `compareSemanticBatch()`: source discovery is one decision frontier and unresolved comparisons another, so more independent fields increase questions before they increase serial decision depth. Results expose `serialDecisionDepth`, provider/token usage, `providerMs`, `observationMs`, and local `verificationMs`. See [Semantic verification](docs/semantic-verification.md).

CLI commands `semantic_locate`, `semantic_compare`, and `semantic_assert` and MCP tools `browser_semantic_locate`, `browser_semantic_compare`, and `browser_semantic_assert` use the same SDK core.

### Structured extraction, grounded by record

```ts
const result = await browser.extract(
  'Read open invoices, preserving table order',
  z.object({ invoices: z.array(z.object({ number: z.string(), total: z.number() })) }),
  { recordsScope: 'tbody tr' },
);
// result.data.invoices, result.evidence['invoices.0.total']
```

Nested objects and arrays are supported. Every array item comes from an observed row/card, and its fields are selected only from that record's text. `recordsScope` selects the records; otherwise semantic rows, list items and articles are used. Values and hrefs retain source evidence. Missing required values fail instead of being invented. Unsafe integers should be extracted as strings. Schema defaults, catch fallbacks, generated summaries, and value-changing transforms are not extraction operations.

### Bounded agent, deterministic completion

```ts
const result = await browser.agent({
  maxSteps: 8,
  until: async page => page.getByText('Saved', { exact: true }).isVisible(),
}).execute({
  instruction: 'Enter name in the Name field and save',
  values: { name: 'Alice' },
});
expect(result.status).toBe('complete');
```

`agent().execute()` delegates to `run()`. An SDK `until` returning literal `true`, or a supplied `expect` assertion, produces caller-verified completion once requested inputs are covered. It should promptly return `false` while work remains. Without caller checks, a fresh matching result record can produce `complete / ui-readback` with explicit evidence coverage. Model-only completion stays `unverified`. Prompt/ambiguous dialogs, missing inputs and budgets stop explicitly. Mutation failures are never automatically retried; see `error.partial` before deciding what to do next.

## Scope and migration

This is a **functional alternative**, not a binary-compatible re-export of Microsoft or Browserbase packages. Tool configuration, CLI flags, SDK types, and result envelopes have documented differences. [The migration guide](docs/migration.md) maps the supported workflows and remaining boundaries.

The AI layer is DOM/ARIA-based. Native HTML controls, very long select lists, open shadow roots, child frames, and standards-associated ARIA comboboxes are covered by the shared core. Native screenshots and coordinate mouse operations are available to an outer vision-capable client, but Jev does not infer Canvas coordinates or invent text from images. Arbitrary widget conventions without a grounded ownership/value signal, cloud session infrastructure, browser extensions, generated summaries, and arbitrary Node-side MCP code execution are not part of this package. Explicit page evaluation is off by default; trusted SDK callers already have the full Playwright Page.

## Verify and contribute

```sh
npm run check
npm run check:examples
npm run check:package
# Explicit real-provider tests, synthetic pages only:
npm run test:live
npm run test:live:semantic
```

Default tests use real browsers, deterministic injected choices, and local HTTP fixtures. Live tests are opt-in and never run against production accounts. See [CONTRIBUTING.md](CONTRIBUTING.md) and [the verification record](docs/verification.md).
