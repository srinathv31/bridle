---
name: run-phase
description: Build exactly one redesign phase, then stop for human review. Manual conductor (option A) — invoked per phase; it dispatches/gates/QAs the phase via the execute-phase workflow, verifies phase-guard, reports, and stops at the merge barrier. Use when running a plan from plan-work-item one phase at a time with a human present at every barrier. Never advances phases itself and never edits production code.
---

# Run one phase (manual conductor — option A)

Build **one** phase end-to-end and hand the result back for review. This is the high-trust path: a human is present at every merge barrier. It runs the dispatch/gate/QA grind through the `execute-phase` workflow but **stops at the barrier** — it never advances to the next phase.

Use this for phases you want to scrutinize closely. For hands-off multi-phase runs, use `drive-build`.

## Steps

1. **Resolve the target phase.** Use the phase id the user gave (e.g. `P2`). If none was given, read the plan dir's work-phases.md (default `docs/redesign/work-phases.md`; the plan dir is `harness.config.json` → `planDir`) and pick the lowest-numbered phase that still has any `- [ ]` item.

2. **Precheck before launching.** Run `node agent-workflow-harness/scripts/precheck.mjs <Pn>` yourself. Exit `1` → **stop**: report the blockers (incomplete or unguarded upstream phase, missing brief, etc.) and do not launch. Never launch against a red precheck because "it's probably fine."

3. **Launch the phase build.** Call the Workflow tool:

   ```
   Workflow({ name: 'execute-phase', args: '<Pn>' })
   ```

   That single fan-out dispatches the executors, gates the phase once with `node agent-workflow-harness/scripts/run-gate.mjs` (configured lint/typecheck/test plus the runtime verifier, with a bounded fix loop), runs `phase-qa` in a **separate** agent, runs `node agent-workflow-harness/scripts/qa-check.mjs` on its report, and checks `phase-guard`. You get back a structured verdict.

4. **Independently verify the verdict.** Do not trust the workflow's self-report. Run `node agent-workflow-harness/scripts/phase-guard.mjs <Pn>` yourself and confirm exit `0`. (Evidence-or-reject applies to the workflow's own claims too.)

5. **Report, then STOP.** Summarize: guarded yes/no, items merged, attempts/fixes, any open defects. Point the user at the diff and the phase QA report in the plan dir (default `docs/redesign/phase-<Pn>-qa.md`). Append one row to `<planDir>/build-log.md`, creating it with this header if missing: `| date | phase | verdict | attempts | wall-min | items | stoppedAt | notes |` (real clock reads, not memory) — the build log is the cross-phase baseline that makes harness tuning measurable. Then **stop** — do not precheck or launch the next phase. The user advances by invoking `/run-phase` again for the next phase, or switching to `/drive-build`.

   **Blocked build:** a verdict of `stoppedAt: "build"` with a `questions` map means the executors hit ambiguity and stopped rather than guess. Surface each question to the user verbatim. When the user answers, relaunch the **same** phase fresh with the answers threaded in — `Workflow({ name: 'execute-phase', args: { phase: '<Pn>', attempt: <verdict.attempt + 1>, answers: { '<itemId>': '<answer>' } } })`. Completed items are already ticked and skip; the answers are injected into the blocked executors' prompts. (Re-running the same phase after answers is not phase-chaining — the one-invocation-one-phase rule is about advancing.)

## Hard rules

- **One invocation = one phase.** Never chain phases here.
- **Red precheck = no launch.**
- **A phase is done only when `phase-guard` passes** — boxes checked is not enough.
- **You are the conductor, not a builder** — never edit `src/` yourself; the workflow's executors do that.
- If the workflow returns `stoppedAt: gate` or `qa` (couldn't gate/clear defects), report that as a **defect to fix**, not a pass — and do not advance. `stoppedAt: "build"` with questions is the blocked-clarification path in step 5, not a defect.
