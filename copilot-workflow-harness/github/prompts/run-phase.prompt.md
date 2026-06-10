---
name: run-phase
description: "Build exactly ONE phase end-to-end (dispatch → gate → QA → barrier), then stop for human review. Re-entrant: re-invoke it any time to continue a phase from wherever it stands."
agent: harness-orchestrator
argument-hint: "phase id, e.g. P2 (omit to pick the lowest open phase)"
---

Build **one** phase end-to-end and stop at the merge barrier. A human reviews every barrier — you never advance to the next phase. Your standing rules are in your agent file; this is the procedure.

This procedure is **re-entrant**: every step starts by checking the artifacts on disk, so re-invoking `/run-phase P2` after an interruption (context compaction, a manual multi-session detour, a closed window) resumes from the right stage instead of redoing work.

## 0. Resolve the target

Use the phase ID given after the command. If none, read `<planDir>/work-phases.md` (`planDir` = `harness.config.json` → `planDir`, default `docs/redesign/`) and pick the lowest-numbered phase with any `- [ ]` item.

## 1. Precheck

```bash
node copilot-workflow-harness/scripts/precheck.mjs <Pn>
```

Exit 1 → **stop**: report the blockers (unguarded upstream phase, missing brief, …). Never launch on red.

## 2. Read the plan deterministically

```bash
node copilot-workflow-harness/scripts/phase-items.mjs <Pn>
```

Trust its JSON verbatim — items, file sets, `isUI`, and the overlap-computed `parallelizable`. Do not reinterpret it. List the open (un-checked) items. If none are open, skip to step 4.

## 3. Build — one executor subagent per open item

Dispatch each open item to a subagent running the **`work-item-executor`** agent, with this assignment (fill in the ID):

> Implement work-item `<id>` following your agent instructions. Read the brief at `<planDir>/work-item-<id>.md` end-to-end plus everything in its "Inputs to read" block; match `contracts.md` verbatim; stay strictly inside its "Files this item creates / edits" list and "Out of scope" bullets. Maintain your heartbeat at `<statusDir>/<id>.json`. Run STATIC self-checks only (`node copilot-workflow-harness/scripts/run-gate.mjs --no-runtime`) — do NOT start a dev server; runtime verification happens once at the phase gate. If the brief is ambiguous, set state "blocked" with a note instead of guessing.

- `parallelizable: true` → dispatch the open items concurrently. `false` → strictly serial, in dependency order.
- After each return, check `node copilot-workflow-harness/scripts/subagent-status.mjs` and the checklist tick. A `blocked` item or an executor that returned without finishing → apply your bounded-recovery rule (one re-dispatch with handoff state, then stop and escalate).
- **No subagent tool?** Print the exact `/work-item <id>` commands for the user to run in separate chat sessions (side by side if parallelizable), tell them to re-invoke `/run-phase <Pn>` when the items are done, and stop.

Do not proceed while any item in the phase is still `- [ ]`.

## 4. Gate — ONE whole-repo detector pass

If the phase has UI items: start the configured dev command (`harness.config.json` → `runner.dev`) in a **background terminal** if it isn't already serving, and wait until `runtime.web.baseUrl` responds. Then:

```bash
node copilot-workflow-harness/scripts/run-gate.mjs            # lint + typecheck + test + runtime verifier
# phases with no UI items may use --no-runtime
```

- Exit 0 → proceed to QA.
- Exit non-zero → attribute each failure to its owning work-item by file path (from step 2's file map) and dispatch **one fix subagent per failing item** (work-item-executor, inline defect brief: the failing command, exit code, offending file, output excerpt; "a failing runtime verifier is a real defect in the app — fix the root cause, do not blame the tool"). Re-run the gate after the fixes return. **Max 2 fix rounds**; still red → stop and report `stoppedAt: gate`.

## 5. QA — in a separate agent, plus the confabulation check

Determine the pass number: no `<planDir>/phase-<Pn>-qa.md` yet → first pass, dispatch a subagent on the **`phase-qa`** agent; otherwise → dispatch **`phase-qa-verify`**. Assignment: the phase ID, and "write the report per your agent instructions; run `node copilot-workflow-harness/scripts/qa-check.mjs` on it until clean before returning."

**No subagent tool?** Tell the user to run `/phase-qa <Pn>` (or `/qa-verify <Pn>`) in a **fresh chat session** and then re-invoke `/run-phase <Pn>`. Never run QA inline in this session — the separation is the point.

When QA returns: re-run `node copilot-workflow-harness/scripts/qa-check.mjs <report>` yourself and read the defect list. Blocking defects (severities in `gate.blockOn`, default critical + major) → dispatch one fix subagent per defect (inline brief from the defect's Observed/Expected/Reproduction), then re-QA (verify mode). **Max 2 QA rounds**; blockers still open → stop and report `stoppedAt: qa`.

## 6. The barrier

```bash
node copilot-workflow-harness/scripts/phase-guard.mjs <Pn>
```

Trust the exit code, not anyone's summary — including your own subagents'.

## 7. Report, then STOP

Summarize: guarded yes/no · items merged · gate fix rounds and QA rounds used · open defects (if any) · paths to the diff and `<planDir>/phase-<Pn>-qa.md`. Then stop — do not precheck or launch the next phase. Recommend the user start a **fresh chat session** for `/run-phase P<n+1>` (context hygiene: each phase gets a clean context, like a fresh per-phase workflow run).

## Hard rules

One invocation = one phase. Red precheck = no launch. A phase is done only when `phase-guard` exits 0. You are the conductor, not a builder — never edit production code. `stoppedAt: gate|qa` is a defect report, not a pass.
