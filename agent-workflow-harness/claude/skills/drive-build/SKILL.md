---
name: drive-build
description: Drive a multi-phase redesign build to completion — spawn a fresh per-phase build for each phase via the execute-phase workflow, supervise it with a watchdog (heartbeat + deadline + bounded recovery), and advance across merge barriers automatically. Autonomous conductor (option B). Use for greenfield or low-touch builds where phases should run hands-off; it stops dead at any failed or stuck phase. Never inlines phase work and never edits production code.
---

# Drive a multi-phase build (autonomous conductor — option B)

Take a plan from `plan-work-item` and drive it phase by phase to completion: spawn a fresh build for each phase, supervise it, and advance across the merge barriers — without a human spinning up each phase. This is the speed path for greenfield work. It still stops dead at any failed or stuck phase; **auto never means skip the gate.**

For phases you want to review closely, use `run-phase` (manual) instead.

## Modes

Parse from the invocation (default `auto`):

- **auto** — advance past every `phase-guard`-passing phase automatically; stop only on failure or a stuck phase.
- **supervised** — same supervision, but pause at each barrier and summarize for the user's go-ahead before advancing.

Optional range: `from P<n>` / `to P<n>` (default: lowest open phase → last phase in the plan dir's work-phases.md, default `docs/redesign/work-phases.md`).

## Context discipline — this is what keeps you lean

You are a **thin driver**. Hold ONLY the phase checklist and each phase's compact verdict. **Never** pull phase transcripts, full QA reports, or large source files into your own context — that defeats the per-phase isolation that motivated this design. Each phase's heavy lifting lives inside its `execute-phase` workflow run, whose agents have their own fresh contexts; only the verdict bubbles up. That is how you can drive a 10-phase build without your context growing past a handful of verdicts.

## The loop (per phase)

1. **Precheck.** `node agent-workflow-harness/scripts/precheck.mjs <Pn>`. Exit `1` → **STOP + escalate** (report the blockers; do not launch).

2. **Launch in background.** `Workflow({ name: 'execute-phase', args: '<Pn>' })`. Record the returned `runId`. The workflow notifies you on completion — you are **not** blocked waiting on it.

3. **Supervise — the watchdog.** While the run is in flight, never wait blindly:
   - Poll the phase heartbeat on an interval — `node agent-workflow-harness/scripts/subagent-status.mjs` (reads the status dir, `harness.config.json` → `statusDir`, default `docs/redesign/.status/`). Schedule the next check with `ScheduleWakeup` (~270s to stay cache-warm; tighter for small phases).
   - Fresh beats / completion still pending → keep waiting.
   - **STUCK** — `subagent-status` exits `1` (a `running` item whose `lastBeat` is stale), or no completion past the per-phase wall-clock cap → kill the run (`TaskStop` on the `runId`) and **resume once**: `Workflow({ name: 'execute-phase', args: '<Pn>', resumeFromRunId: <runId> })` (the cached prefix makes the re-run cheap). Still stuck after one resume → **STOP + escalate**. Never silently re-spawn in a loop.
   - **Wall-clock cap** per phase (default ~30 min) exceeded → **STOP + escalate**.

4. **On verdict — verify, then decide.**
   - Independently run `node agent-workflow-harness/scripts/phase-guard.mjs <Pn>` (do not trust the verdict's self-reported `guarded`).
   - **guarded** → _auto_: advance to the next phase (back to step 1). _supervised_: summarize and pause for the user's go-ahead.
   - **BLOCKED with questions** — `stoppedAt: "build"` with a non-empty `questions` map means executors hit ambiguity they refused to guess through. Try to answer each question yourself from the plan artifacts ONLY (`contracts.md`, the architectural rules in `work-phases.md`, the item's brief — bounded reads; no source spelunking). If every question has a defensible answer, relaunch FRESH with the answers threaded in: `Workflow({ name: 'execute-phase', args: { phase: '<Pn>', attempt: <verdict.attempt + 1>, answers: { '<itemId>': '<answer>' } } })`. Completed items are already ticked and skip automatically; the answers are injected into the blocked executors' prompts, so the same ambiguity cannot block twice. At most **one** answered relaunch per phase — a second blocked verdict, or any question the plan artifacts can't answer, → **STOP + escalate** with the questions verbatim (when the user answers, relaunch the same way with their answers).
   - **not guarded** / `stoppedAt: "build"` without questions / `stoppedAt: gate|qa` / unresolved blocking defects (any severity in `harness.config.json` → `gate.blockOn`, default `["critical","major"]`) → **STOP + escalate.** The merge barrier is absolute; never advance past an unguarded phase, even in auto.

5. **Done** when the last in-range phase is guarded. Summarize the whole run: phases guarded, total items merged, anything deferred.

## Invariants (never violate)

- **No unbounded wait.** Every wait has a deadline; you wake, check the heartbeat, and decide.
- **No silent infinite retry.** Stuck → at most one resume; blocked → at most one answered relaunch — then escalate.
- **The barrier is absolute.** Auto advances only past a `phase-guard`-passing phase. Unguarded or stuck → halt and page the human.
- **Don't inline phase work.** Launch workflows; read verdicts. Keep your context to the checklist + verdicts.
- **Gates are self-bounding.** The runtime verifier (`harness.config.json` → `runtime.verifier`) returns a verdict in seconds even on a fully frozen page, so a freeze can never hang you — if a phase stalls, it is a real stuck agent, treat it as one.

## Hard rules

- Never edit `src/` yourself; the workflow's executors do that.
- A phase is done only when `phase-guard` passes.
- **Escalation = stop and report clearly**: which phase, which item, its last heartbeat `step`, and what blocked. Don't guess past it.
