---
name: drive-build
description: Drive multiple harness phases to completion — the conductor per phase, auto-advance through guarded barriers, stop dead on any failure. Prefers the deterministic drive-phase conductor in --auto mode; never skips a gate.
---

# drive-build — multi-phase orchestration

Drive a multi-phase build to completion without a human spinning up each phase. This is the speed path; **auto never means skip the gate** — it stops dead at any failed, stuck, or unguarded phase.

## Prefer the conductor

The deterministic conductor drives the whole range itself — one phase at a time, each in fresh `codex exec` sessions, stopping dead at any unguarded barrier:

```bash
node codex-workflow-harness/codex/drive-phase.mjs --auto              # lowest open phase → last phase
node codex-workflow-harness/codex/drive-phase.mjs --auto --from P1 --to P4
```

Run it from the terminal. If your sandbox blocks network for spawned commands, hand the user that exact command to run from their own terminal and stop. Supervised cadence (a human at each barrier) = run `node codex-workflow-harness/codex/drive-phase.mjs <Pn>` once per phase instead, reviewing between runs — that is the recommended default for anything non-trivial.

## If you must drive it in-session

Parse mode and range from the invocation text (default `auto`): **auto** advances past every guarded barrier automatically; **supervised** pauses at each barrier, summarizes, and waits for the user's go-ahead. Optional `from P<n>` / `to P<n>` bound the range (default: lowest open phase → last phase in `work-phases.md`).

**Context discipline — what keeps this viable.** You are a thin driver. Hold ONLY the phase checklist and each phase's compact verdict (guarded y/n, items merged, rounds used, open defects). Never pull QA reports, executor transcripts, or source files into your context. If you notice your context was compacted, **re-derive state from disk before acting**: `node codex-workflow-harness/scripts/phase-guard.mjs` (no args sweeps all phases) tells you exactly which phases are already guarded; resume from the first unguarded one.

The loop (per phase in range):

1. **Precheck:** `node codex-workflow-harness/scripts/precheck.mjs <Pn>` — exit 1 → STOP + escalate.
2. **Run the phase** exactly per the `run-phase` skill (steps 1–6 of `.agents/skills/run-phase/SKILL.md`): plan read → executor sessions (parallel iff proven disjoint, never inline) → one whole-repo gate with ≤2 fix rounds → QA in a separate session with ≤2 rounds → `phase-guard`.
3. **On the verdict** — independently re-run `node codex-workflow-harness/scripts/phase-guard.mjs <Pn>`:
   - **Guarded** → record the compact verdict. _auto_: advance to the next phase (back to 1). _supervised_: summarize and pause for go-ahead.
   - **Not guarded / stopped at gate or QA / blocking defects open** → **STOP + escalate.** The barrier is absolute, even in auto.
4. **Stuck executor** (stale heartbeat per `node codex-workflow-harness/scripts/subagent-status.mjs`, mtime is the trust anchor) → one re-dispatch with its handoff state → still stuck → STOP + escalate. Never a silent retry loop.
5. **Done** when the last in-range phase is guarded. Summarize the run: phases guarded, items merged, fix/QA rounds used, anything deferred.

## Invariants

- No unbounded wait, no silent infinite retry: stuck → one resume → escalate.
- The merge barrier is absolute — it blocks on `harness.config.json` → `gate.blockOn` (default critical + major).
- Don't inline phase work: dispatch sessions, read verdicts. Never edit production code.
- Escalation = stop and report clearly: which phase, which item, its last heartbeat `step`, what blocked, what was tried.
