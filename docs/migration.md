# Migrating browser automation

Jev Browser is a functional alternative, not a drop-in alias for another package's JavaScript types, CLI flags or MCP schemas. The shared core is intentionally explicit about grounded data, ownership, authorization and verified completion.

## Playwright MCP

Change the MCP executable to `jev-browser-mcp` or the installed `dist/mcp-stdio.js`. Standard operation names are exposed as `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_fill_form`, `browser_tabs`, `browser_handle_dialog`, `browser_file_upload`, `browser_take_screenshot`, and other documented native tools. Discovery uses the official MCP protocol and is tested with the official client.

Take a new snapshot and use **this server's refs**, not refs from an old Playwright MCP connection. Native methods accept the human-readable `element` field, but actual targeting uses `ref` or `target`. `target` is a Playwright selector supplied by a trusted caller. Snapshot results are structured JSON rather than Microsoft's exact text format.

Use `browser_act` for natural-language action selection and `browser_assert` for deterministic verification. Tool cancellation propagates to the shared core. A pending dialog is explicit and can be handled in the next call.

Page-side `browser_evaluate` is available only with `--allow-evaluate`, and currently accepts a page function rather than a target-bound function. Arbitrary Node-side `browser_run_code` is deliberately not provided; write that orchestration in the SDK using `browser.page`. Browser extensions and proprietary service integration are not included; use CDP or a Playwright WebSocket endpoint when attaching to another browser.

## Playwright CLI

| Workflow | Jev Browser |
| --- | --- |
| Open a retained browser | `open URL --session work` |
| Read the page | `snapshot --session work` |
| Click/type by ref | `click REF`, `fill REF TEXT`, with `--session work` |
| Select/check/keyboard | `select REF VALUE`, `check REF`, `uncheck REF`, `press Enter` |
| Native arbitrary arguments | `COMMAND --args JSON` or `call COMMAND --args JSON` |
| Bounded natural-language workflow | `run INSTRUCTION --values JSON --max-steps N` |
| Verify outcome | `assert --args JSON`; failure exits nonzero |
| Retain state over a pipe | `session` with JSONL commands and optional request IDs |
| Inspect/close sessions | `sessions`, `close --session work` |

CLI output is always JSON (apart from help/version). Screenshots return image data and optionally save an artifact; use `take_screenshot --args '{"filename":"page.png"}'` to choose a file. Outputs stay inside the artifact directory. Flags and storage paths are not compatible with an existing Microsoft session descriptor. Retake snapshots during migration and close old sessions explicitly.

## Stagehand

```ts
const browser = new JevBrowser({ page });
await browser.act('Fill email with email', { values: { email: 'teacher@example.invalid' } });
const plan = await browser.observe('Click Save');
if (plan) await browser.act(plan);
const { data, evidence } = await browser.extract('Read rows', schema, { recordsScope: 'tbody tr' });
const result = await browser.agent({ maxSteps: 8, until: verify }).execute({ instruction: goal, values });
```

Use the existing Playwright Page/fixtures and keep ordinary `expect` assertions. A browser constructed with a Page does not own it. Natural-language input variables use `values`, not upstream `%variable%` templating. Explicit values stay local, while literal quoted text is already visible in the prompt.

`observe` returns a single plan or null, rather than an array of reusable actions. Plans are single-use. `extract` returns `data` together with evidence, snapshot and decision metadata. Its contract is copying observed facts, not generating summaries. Nested objects, scalar roots and arrays of actual DOM rows/cards are available; record scopes preserve cross-field coherence within each row.

The agent is a bounded observation/decision/action loop. It does not include Browserbase infrastructure, Stagehand's cache/replay service, cloud session billing, or arbitrary model-generated code. Use a native selector after an initial observation when no further model decision is needed. A model's completion opinion stays unverified; pass a deterministic `until` or run explicit assertions.

## Visual-only pages and large pages

Screenshot and mouse-coordinate tools are available to an outer vision-capable agent. Jev itself is not an image model in this integration, so standalone autonomous Canvas/image interpretation is not claimed. Closed shadow roots are not inspectable by the DOM layer.

For large pages, narrow `scope` or raise the explicit limits. `recordsScope` identifies repeated rows but is not a whole-page text filter. The runtime refuses truncated decision inventories rather than pretend all choices were observed.

## Upstream references

- [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp)
- [Microsoft Playwright CLI](https://github.com/microsoft/playwright-cli)
- [Stagehand act](https://docs.stagehand.dev/v4/basics/act)
- [Stagehand extract](https://docs.stagehand.dev/v4/basics/extract)

Compare against the versions you actually deploy; upstream interfaces change independently of this project.
