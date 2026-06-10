---
name: drive-build
description: "Drive multiple phases to completion in one session — run-phase per phase, auto-advance through guarded barriers, stop dead on any failure. For small builds; prefer /run-phase with a fresh session per phase on long ones."
agent: harness-orchestrator
argument-hint: "auto | supervised, optionally 'from P<n>' / 'to P<n>' (default: auto, lowest open phase → last phase)"
---

Drive a multi-phase build to completion without a human spinning up each phase. This is the speed path; **auto never means skip the gate** — it stops dead at any failed, stuck, or unguarded phase.

⚠️ **Copilot reality check before you start.** Unlike the Claude Code original, every phase here runs inside _this_ chat session — there is no detached per-phase workflow with its own context. Long builds will hit context compaction and the per-session request budget. Mitigations are built into the loop below, but for builds of more than ~3 phases, recommend the user run `/run-phase` per phase in fresh sessions instead, and proceed only if they still want this.

## Modes and range

Parse from the invocation text (default `auto`): **auto** advances past every guarded barrier automatically; **supervised** pauses at each barrier, summarizes, and waits for the user's go-ahead. Optional `from P<n>` / `to P<n>` bound the range (default: lowest open phase → last phase in `work-phases.md`).

## Context discipline — what keeps this viable

You are a thin driver. Hold ONLY the phase checklist and each phase's compact verdict (guarded y/n, items merged, rounds used, open defects). Never pull QA reports, subagent transcripts, or source files into your context — the subagents have their own. If you notice your context was compacted, **re-derive state from disk before acting**: `node copilot-workflow-harness/scripts/phase-guard.mjs` (no args sweeps all phases) tells you exactly which phases are already guarded; resume from the first unguarded one.

## The loop (per phase in range)

1. **Precheck:** `node copilot-workflow-harness/scripts/precheck.mjs <Pn>` — exit 1 → STOP + escalate.
2. **Run the phase** exactly per the `/run-phase` procedure (steps 2–6 of `.github/prompts/run-phase.prompt.md`): plan read → executor subagents (parallel iff proven disjoint) → one whole-repo gate with ≤2 fix rounds → QA in a separate subagent with ≤2 rounds → `phase-guard`.
3. **On the verdict** — independently re-run `node copilot-workflow-harness/scripts/phase-guard.mjs <Pn>`:
   - **Guarded** → record the compact verdict. _auto_: advance to the next phase (back to 1). _supervised_: summarize and pause for go-ahead.
   - **Not guarded / stopped at gate or QA / blocking defects open** → **STOP + escalate.** The barrier is absolute, even in auto.
4. **Stuck executor** (stale heartbeat per `node copilot-workflow-harness/scripts/subagent-status.mjs`, mtime is the trust anchor) → one re-dispatch with its handoff state → still stuck → STOP + escalate. Never a silent retry loop.
5. **Done** when the last in-range phase is guarded. Summarize the run: phases guarded, items merged, fix/QA rounds used, anything deferred.

## Invariants

- No unbounded wait, no silent infinite retry: stuck → one resume → escalate.
- The merge barrier is absolute — it blocks on `harness.config.json` → `gate.blockOn` (default critical + major).
- Don't inline phase work: dispatch subagents, read verdicts. You have no edit tool; keep it that way behaviorally too.
- Escalation = stop and report clearly: which phase, which item, its last heartbeat `step`, what blocked, what was tried.
