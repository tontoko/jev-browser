# Semantic Refinement Implementation Plan

**Goal:** Make semantic assertions current, composable with caller Playwright locators, diagnosable, and efficient through all three interfaces.
**Architecture:** Retain one browser core and existing typed decision engine. Snapshot comparisons remain snapshot comparisons. Live assertions re-read the actual bound sources and never retry unchanged evidence to obtain a favorable model answer. Use existing Playwright and MCP mechanisms; add no inference runtime or workflow framework.
**Tech Stack:** TypeScript, pinned Playwright, Node test runner, existing TypeSafe decision protocol.
**Spec:** Implements the approved v0.6.0 refinement audit and follow-up scope.

## Constraints
Product-neutral public materials; no adopter details. No mutation replay. Keep caller scope, cancellation, ownership, decision limits, and existing deterministic assertions. Model confidence is not a probability. Preserve evidence and source/comparison thresholds separately. No new production dependency.

## Review Focus
A source changes during model inference; a frame navigates or source is replaced; an unconfigured exact comparison; a mixed-model or partially unattributed frontier; a Locator outside current Page/scope; ambiguous Locator; unchanged low-confidence evidence; malformed batch inputs; private evidence serialization across session boundaries.

## Tasks
- [x] Pin eager initialization, A/B/A model attribution, source drift, and assertion error details with failing tests. Fix initialization lazily and retain all model identifiers without invented attribution.
- [x] Add optional retained text refs to observation and live source revalidation. Compare defaults to snapshot, assert to live. Re-read locally; changed evidence becomes explicitly inconclusive, never a stale pass. Keep the complete batch operation within one Page lease.
- [x] Add caller Locator/property inputs and safe current reads (text, value, checked, named attribute). Use same Page only and intersect explicit scope. Retain actual evidence, not locator implementation internals. Test delayed elements, frames, shadow DOM, duplicates, cancellation, and exact no-key paths.
- [x] Add semantic compare/assert batch commands through shared dispatcher; preserve structured assertion failures through SDK, CLI, MCP, and named sessions. Add installed-package checks and Playwright report example without inventing a new assertion framework.
- [x] Reduce repeated semantic candidate metadata, batch reusable semantic target discovery, and test source isolation, request sizes, and bounded serial depth. Do not cache old outcome decisions or weaken authority.
- [x] Add neutral search/filter/edit/readback workflows and separate tuning fixtures from deterministic held-out variants. Run focused, full, installed-package and live-provider checks. Report fixture results as fixtures, not universal accuracy or competitor superiority.
- [ ] Update docs, examples, API/release notes. Audit package contents. Publish only after exact-source CI and artifact verification.
