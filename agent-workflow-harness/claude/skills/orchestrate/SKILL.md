---
name: orchestrate
description: Entry point for driving a multi-agent redesign/feature build. Routes to the per-phase build engine (the execute-phase workflow) via one of two conductors — run-phase (manual, one phase at a time) or drive-build (autonomous, multi-phase with a watchdog). Use when running a plan produced by plan-work-item (docs/redesign/work-phases.md + work-item-*.md + contracts.md). It does not implement work-items, write production code, or run QA itself.
---

# Orchestrate — route to the right conductor

Orchestration is now performed by the **`execute-phase` workflow** (`.claude/workflows/execute-phase.js`), which builds ONE phase end-to-end deterministically: read the plan (`node agent-workflow-harness/scripts/phase-items.mjs`), dispatch executors (parallel only when their file sets are genuinely disjoint), run the whole-repo detector gate once against a single dev server, QA in a separate agent, and verify `phase-guard`. The dispatch/heartbeat/gate loop is no longer hand-driven in prose — the workflow runs it as code. **Pick a conductor; do not re-implement the loop here.**

- **`run-phase` (manual — option A)** — build ONE phase, verify `phase-guard`, then stop for human review. Use for phases you want to scrutinize closely; the human advances by invoking it again for the next phase.
- **`drive-build` (autonomous — option B)** — drive multiple phases to completion: spawn a per-phase build, supervise it with a watchdog (heartbeat + deadline + bounded resume + escalate), and advance across merge barriers. `auto` runs through green barriers and stops on any failure or stuck phase; `supervised` pauses at each barrier. Use for greenfield / low-touch builds.

Both share the same engine and the same guarantees: `precheck` before launch, the single whole-repo gate (`node agent-workflow-harness/scripts/run-gate.mjs` — configured lint/typecheck/test plus the runtime verifier), QA in a separate agent, `qa-check` on the report, and `phase-guard` as the absolute merge barrier. Neither edits `src/` — the workflow's executors do that.

## Invariants (unchanged — now enforced as code, not discipline)

- A phase is done only when `phase-guard` passes (every item `[x]` **and** a QA artifact that itself passes `qa-check`).
- Keep QA in a separate agent from the executors that built the phase.
- Red `precheck` = no dispatch. A stuck subagent gets bounded recovery, then escalation — never an unbounded wait.
- The merge barrier is absolute, even in `auto` mode. It blocks on every severity in `harness.config.json` → `gate.blockOn` (default `["critical","major"]`) — a MAJOR defect blocks advancement, not only a critical one.

## See also

- `.claude/workflows/execute-phase.js` — the per-phase engine.
- `.claude/skills/run-phase/SKILL.md` · `.claude/skills/drive-build/SKILL.md` — the two conductors.
- `node agent-workflow-harness/scripts/phase-items.mjs` — deterministic plan reader + overlap-based parallel decision.
