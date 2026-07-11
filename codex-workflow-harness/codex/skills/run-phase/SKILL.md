---
name: run-phase
description: Build exactly ONE harness phase end-to-end (dispatch → gate → QA → barrier), then stop for human review. Re-entrant — re-invoke any time to continue a phase from wherever it stands. Prefers the deterministic drive-phase conductor; degrades to multi-session orchestration when it can't run.
---

# run-phase — the orchestrator role

Build **one** phase end-to-end and stop at the merge barrier. A human reviews every barrier — you never advance to the next phase. You are the conductor, not a builder: you never write production code, and every gate has a detector that does not share the subject's failure mode — including you.

This procedure is **re-entrant**: every step starts by checking the artifacts on disk, so re-invoking it after an interruption (context compaction, a manual multi-session detour, a closed session) resumes from the right stage instead of redoing work. The scripts' exit codes, not the conversation, carry the state.

## 0. Prefer the deterministic conductor

This edition ships a mechanical orchestrator — it runs this whole procedure deterministically, spawning one `codex exec` session per work-item (parallel when `phase-items` proves the file sets disjoint) and a separate one for QA, with bounded fix loops and the barrier check built in:

```bash
node codex-workflow-harness/codex/drive-phase.mjs <Pn>
```

Run it from the terminal. It needs to reach the model API from its child sessions, so if your sandbox blocks network for spawned commands, don't fight it — tell the user to run that exact command from their own terminal, then stop. Only orchestrate manually (steps 1–7 below) when the user explicitly asks for an in-session run.

## 1. Resolve the target and precheck

Use the phase ID given with the invocation. If none, read `<planDir>/work-phases.md` (`planDir` = `harness.config.json` → `planDir`, default `docs/redesign/`) and pick the lowest-numbered phase with any `- [ ]` item. Then:

```bash
node codex-workflow-harness/scripts/precheck.mjs <Pn>
```

Exit 1 → **stop**: report the blockers (unguarded upstream phase, missing brief, …). Never launch on red.

## 2. Read the plan deterministically

```bash
node codex-workflow-harness/scripts/phase-items.mjs <Pn>
```

Trust its JSON verbatim — items, file sets, `isUI`, and the overlap-computed `parallelizable`. Do not reinterpret it. A brief's self-reported "Parallel-safe: yes" never overrides the computed answer. List the open (un-checked) items. If none are open, skip to step 4.

## 3. Build — one executor session per open item, never inline

You have no subagent tool in-session; the executors run as **separate Codex sessions**, and you must not inline their work — the separation is load-bearing, not procedural decoration. Print for the user the exact commands to run, one fresh session per open item (side by side if `parallelizable`), then stop and tell them to re-invoke `run-phase <Pn>` when the items are done:

```
codex "$work-item W2.1 — implement this work-item per the skill"
codex "$work-item W2.2 — implement this work-item per the skill"
```

(Each executor reads its brief at `<planDir>/work-item-<id>.md`, keeps a heartbeat at `<statusDir>/<id>.json`, runs static self-checks only, and ticks its checklist box.)

On re-entry, check `node codex-workflow-harness/scripts/subagent-status.mjs` and the checklist ticks. The status file's **mtime** is the trust anchor; a hand-typed `lastBeat` that diverges from it is flagged as fabricated. A `blocked` item or a STUCK heartbeat → **one** re-dispatch with its `criteriaDone`/`filesTouched` handoff state; still stuck → stop and escalate to the user. Never an unbounded wait, never a silent retry loop.

Do not proceed while any item in the phase is still `- [ ]`.

## 4. Gate — ONE whole-repo detector pass

If the phase has UI items: the configured dev command (`harness.config.json` → `runner.dev`) must be serving `runtime.web.baseUrl` — one server for the whole gate, never one per executor. If your sandbox can't start or reach it, hand the user the command to run and re-enter afterward. Then:

```bash
node codex-workflow-harness/scripts/run-gate.mjs            # lint + typecheck + test + runtime verifier
# phases with no UI items may use --no-runtime
```

- Exit 0 → proceed to QA.
- Exit non-zero → attribute each failure to its owning work-item by file path (from step 2's file map) and hand out **one fix dispatch per failing item** (a `work-item` session with an inline defect brief: the failing command, exit code, offending file, output excerpt; "a failing runtime verifier is a real defect in the app — fix the root cause, do not blame the tool"). Re-run the gate after the fixes return. **Max 2 fix rounds**; still red → stop and report `stoppedAt: gate`.

## 5. QA — in a separate session, plus the confabulation check

Determine the pass number: no `<planDir>/phase-<Pn>-qa.md` yet → first pass, the **`phase-qa`** skill; otherwise → **`qa-verify`**. QA always runs in a **fresh Codex session** — never inline here; the separation is the point. Print the command for the user:

```
codex "$phase-qa P2 — run the thorough QA pass per the skill"
```

When QA returns (re-entry): re-run `node codex-workflow-harness/scripts/qa-check.mjs <report>` yourself and read the report's `**Counts:**` line. Blocking defects (severities in `gate.blockOn`, default critical + major) → one fix dispatch per defect (inline brief from the defect's Observed/Expected/Reproduction), then re-QA in verify mode. **Max 2 QA rounds**; blockers still open → stop and report `stoppedAt: qa`.

## 6. The barrier

```bash
node codex-workflow-harness/scripts/phase-guard.mjs <Pn>
```

Trust the exit code, not anyone's summary — including the executors' and QA's. The barrier is absolute: a phase is done only when `phase-guard` exits 0 (every item `[x]` AND a QA report that itself passes `qa-check`).

## 7. Report, then STOP

Summarize: guarded yes/no · items merged · gate fix rounds and QA rounds used · open defects (if any) · paths to the diff and `<planDir>/phase-<Pn>-qa.md`. Then stop — do not precheck or launch the next phase. Recommend a **fresh session** (or the conductor) for the next phase — context hygiene: each phase gets a clean context.

## Hard rules

One invocation = one phase. Red precheck = no launch. A phase is done only when `phase-guard` exits 0. Never edit production code. Never run executor or QA work inline in this session. Hold only the phase checklist and compact verdicts in context — never full QA reports or source files; if your context is compacted mid-phase, re-derive state from disk (`phase-items`, `subagent-status`, `phase-guard`) before acting. `stoppedAt: gate|qa` is a defect report, not a pass. Escalation = stop and report clearly: which phase, which item, its last heartbeat `step`, what blocked, what was tried.
