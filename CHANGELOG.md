# Changelog

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
