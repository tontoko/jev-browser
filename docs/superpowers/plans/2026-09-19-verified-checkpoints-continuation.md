# Verified Checkpoints and Continuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend one-instruction goals across multiple independently verified commits and add same-session resume without replaying verified or uncertain commits.

**Architecture:** Refactor commit verification into evidence + stage classification, add a tiny internal checkpoint ledger/duplicate guard in `runGoal`, and let `JevBrowser` own opaque in-memory continuation state. CLI/MCP remain adapters over the same core.

**Tech Stack:** TypeScript, Node.js 22+, Playwright, existing Jev `DecisionEngine`, Zod, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-19-verified-checkpoints-continuation-design.md`

## Global Constraints

- Public material is product-neutral OSS; no private adopter/application context.
- Browser mutations stay serial; no mutation retries.
- Checkpoints require independently grounded/local evidence.
- Final caller assertions are distinct from intermediate checkpoint verification.
- Unknown commits reconcile read-only before any further mutation.
- Continuations are session-local and opaque; literal values never appear in public continuation payloads.
- No workflow DAG/DSL, distributed scheduler, second planner model, or new runtime dependency.
- Existing policy hooks, cancellation, Playwright ownership, semantic assertions, and deterministic assertions remain unchanged.

---

### Task 1: Separate commit evidence from final-goal classification

**Files:**
- Modify: `src/completion.ts`
- Modify: `src/types.ts`
- Modify: `src/runner.ts`
- Test: `test/checkpoints.test.mjs`

**Interfaces:**
- Produces internal `CommitReadback { verification, stage }`.
- Produces public `GoalCheckpoint` and `RunResult.checkpoints`.
- `runGoal` continues after a verified `continue` checkpoint instead of returning.

- [x] Write a failing two-commit fixture test where the first fresh record is verified but the model stage answer is `continue`; assert the run executes a second Save rather than returning after the first.
- [x] Run `npm run build && node --test test/checkpoints.test.mjs` and confirm RED.
- [x] Refactor `verifyReadback` so local record/evidence validation occurs independently from a `final | continue | rejected` classification.
- [x] Add `GoalCheckpoint` and ordered `checkpoints` to `RunResult`.
- [x] Teach `runGoal` to append a checkpoint and continue on `continue`.
- [x] Run checkpoint + existing single-commit tests and confirm GREEN.
- [x] Commit: `feat: add verified goal checkpoints`.

### Task 2: Track checkpointed inputs and prevent duplicate commits

**Files:**
- Modify: `src/bindings.ts`
- Modify: `src/runner.ts`
- Test: `test/checkpoints.test.mjs`

**Interfaces:**
- Internal input state distinguishes checkpointed paths from current-stage applied paths.
- Internal deterministic commit signature guards duplicate verified submissions.

- [x] Write failing tests: stage-1 controls disappear after checkpoint but paths remain satisfied; stage-2 failure does not recreate stage 1; same commit selected twice submits once.
- [x] Run focused tests and confirm RED.
- [x] Add checkpointed-path handling without exposing literal values.
- [x] Add deterministic commit signature from URL + grounded target/form semantics + stage input paths.
- [x] Re-arm duplicate guard only after a meaningful non-commit effect or a different signature.
- [x] Run focused + goal integrity tests and confirm GREEN.
- [x] Commit: `fix: prevent verified commit replay across goal stages`.

### Task 3: Keep final assertions at the final boundary

**Files:**
- Modify: `src/runner.ts`
- Test: `test/checkpoints.test.mjs`
- Test: `test/goal.test.mjs`

**Interfaces:**
- `expect` evaluates only when a verified checkpoint is classified final.
- `until` remains read-only and authoritative but cannot be replaced by model completion.

- [x] Write failing three-stage test with a final assertion that is false after checkpoints 1/2 and true after checkpoint 3; assert it is not invoked as a failing final gate early.
- [x] Run and confirm RED.
- [x] Remove early final `expect` evaluation from intermediate stages; invoke it only at final boundary.
- [x] Preserve existing caller-`until` regressions from PR #8.
- [x] Run checkpoint + goal + regression tests and confirm GREEN.
- [x] Commit: `fix: separate checkpoint and final goal verification`.

### Task 4: Session-local continuation and resume

**Files:**
- Modify: `src/types.ts`
- Modify: `src/browser.ts`
- Modify: `src/runner.ts`
- Test: `test/resume.test.mjs`

**Interfaces:**
- Public `GoalContinuation { id, reason, pendingEffect? }`.
- `JevBrowser.resume(id, options)`.
- Private continuation map stores original instruction, local values, checkpoints, checkpointed paths, budgets, and optional unknown-commit reconciliation state.

- [ ] Write failing test: stage 1 checkpoint succeeds, stage 2 stops for missing input, result contains opaque continuation but no literal values.
- [ ] Write failing test: `resume(id,{values:{missing:'x'}})` continues from stage 2 and does not resubmit stage 1.
- [ ] Write failing test: changing a checkpointed path rejects with `CONTINUATION_CONFLICT`.
- [ ] Run and confirm RED.
- [ ] Implement private continuation storage in `JevBrowser` and internal runner seed/result material.
- [ ] Merge resume values with stored local values, enforcing checkpoint conflicts.
- [ ] Remove continuation on final completion and core close.
- [ ] Run resume tests and existing lifecycle tests; confirm GREEN.
- [ ] Commit: `feat: resume stopped goals within one browser session`.

### Task 5: Unknown-effect read-only reconciliation

**Files:**
- Modify: `src/runner.ts`
- Modify: `src/browser.ts`
- Test: `test/resume.test.mjs`

**Interfaces:**
- Continuation state can retain pre-commit inventory and current-stage input state.
- Resume reconciles before mutations when `pendingEffect === 'commit'`.

- [ ] Write failing test where save server commits but response/browser observation is interrupted; first result is `effect-unknown`.
- [ ] Assert resume discovers the now-visible result, creates checkpoint, and proceeds without another POST.
- [ ] Write failing test where result stays absent; resume returns `effect-unknown` and POST count remains one.
- [ ] Run and confirm RED.
- [ ] Persist minimum read-only reconciliation state and call checkpoint verification before entering normal action loop.
- [ ] Do not permit mutation while reconciliation remains unresolved.
- [ ] Run resume/checkpoint regressions and confirm GREEN.
- [ ] Commit: `fix: reconcile unknown commits before resume mutations`.

### Task 6: CLI/MCP parity and installed-package proof

**Files:**
- Modify: `src/commands.ts`
- Modify: `src/cli-options.ts`
- Modify: `src/cli.ts` only if help text requires it
- Modify: `scripts/check-package.mjs` or add focused installed-resume helper
- Test: `test/resume-adapters.test.mjs`

**Interfaces:**
- Shared `resume` command with `continuationId` and optional nested `values`.
- MCP `browser_resume`.
- Persistent CLI session required for continuation.

- [ ] Write failing CLI/MCP adapter tests against one shared core.
- [ ] Confirm one-shot/fresh-core resume returns `CONTINUATION_NOT_FOUND`.
- [ ] Add command schema/dispatch and read/write annotations (resume is not read-only).
- [ ] Extend installed tarball check to prove SDK/persistent CLI/MCP continuation path.
- [ ] Run adapter and package checks; confirm GREEN.
- [ ] Commit: `feat: expose goal resume through CLI and MCP`.

### Task 7: Neutral docs, real-Jev matrix, and release gate

**Files:**
- Create: `docs/goal-continuation.md`
- Create: `test/live-resume.mjs`
- Modify: `README.md`
- Modify: `README.ja.md`
- Modify: `docs/api.md`
- Modify: `SECURITY.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`

**Interfaces:**
- Product-neutral public continuation/checkpoint contract.
- Opt-in real-Jev synthetic checkpoint/resume suite.

- [ ] Add neutral contacts/orders/reservations fixture with three independent commits and local server-side submission oracle.
- [ ] Add interrupted second-commit reconciliation fixture and duplicate-submit assertions.
- [ ] Run real-Jev suite and retain raw evidence outside repo.
- [ ] Document same-session boundary, unknown-effect rule, final assertion boundary, and exact non-guarantees.
- [ ] Scan shipped docs/examples for private adopter/application terms.
- [ ] Run `npm run check`, `check:examples`, `check:package`, runtime audit, existing real-Jev suites and new resume suite.
- [ ] Require exact-head six-platform CI and post-merge main CI before release.
- [ ] Publish evidence/tarball only after tested/merged Git-tree identity is proven.
