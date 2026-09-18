# Modern controls and honest evaluation implementation plan

**Goal:** Preserve the one-instruction SDK/CLI/MCP workflow on long native lists and standards-based custom comboboxes, without input paths embedded into the app under test.

**Architecture:** Use existing native primitives and policy boundaries. Keep all option identities locally; defer a long list's semantic choice until its control is selected. Named input matching resolves exact native options locally. Custom comboboxes are small controlled interactions: open/filter, inspect only the associated popup, select a unique exact label, verify the value and closure. Never treat typed search text alone as a completed selection.

**Scope:** This is the first independently releasable part of the approved comparison roadmap. Multiple independent commits/resume, a generic visual agent and arbitrary custom-widget conventions remain later work, not silently claimed as completed.

**Global constraints:** No extra runtime dependencies or second LLM. No model-authored selectors/JavaScript. Preserve missing/ambiguous input handling, authorization callbacks, cancellation, step/request budgets and unknown-commit behavior. Keep real Page interoperability and all native tools.

## Tasks

- [ ] Reproduce 300+ native option overflow in a real browser; retain all original option identities and test end-of-list selection, disabled/duplicate labels and multi-select preservation.
- [ ] Add a bounded deferred selection resolver shared by `act` and `run`. Model state marks summarized options explicitly; selecting a named value must not require transmitting all options or crossing the candidate limit.
- [ ] Implement custom combobox binding through `aria-controls`/`aria-owns`, including portal and editable search variants. Every write goes through the same native executor. Select only a unique visible option belonging to the bound control; verify collapse/current value. Missing association, ambiguity, replacement, cancellation and denied policy must never reach Save.
- [ ] Add a new local HTTP fixture whose input names and IDs are opaque, labels differ from input paths, and saved result labels are human-readable. Independently validate the server's payload and submission count. Exercise genuinely different permutations; do not present regression tuning as unseen-site evaluation.
- [ ] Run old and new suites, all three installed interfaces, real Jev regression scenarios, and cross-platform CI. Review for unnecessary code and publish only a verified release. Update migration/runtime/verification documentation with exact bounds.

Native list selection uses bounded Choice questions with a no-match/ambiguous answer. Candidate partitioning does not discard a suffix of the list. An unresolved action is never executable. Custom selection confirmation is UI evidence, not proof that an arbitrary app persisted the data; final goal verification remains independent.

Design references: WAI-ARIA APG combobox pattern (https://www.w3.org/WAI/ARIA/apg/patterns/combobox/), the existing docs/goal-runtime.md contract, and the 2026-09-18 comparison audit.
