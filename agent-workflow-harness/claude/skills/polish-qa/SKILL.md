---
name: polish-qa
description: Deep per-milestone QA sweep across shipped phases — exhaustive acceptance-criterion validation, edge-case integration states, detailed visual diff against the design source, and responsive drift. This is the polish half that the between-phase phase-qa functional gate deliberately skips. Use when a milestone of phases is guarded and the user wants a fidelity/edge-case audit (e.g. "run polish QA on P0–P3", pre-release hardening), NOT between phases. This skill is read-only — it does not modify production code.
---

# Polish-qa workflow

`phase-qa` gates each phase on function: _is the feature broken, or does it break something else?_ This skill is the other half, run once per milestone instead of per phase: spec fidelity, edge cases, and visual polish across everything shipped since the last polish pass. Splitting the two keeps the between-phase barrier fast enough for autonomous multi-phase runs while making sure the detailed battery still happens — later, batched, and against the integrated app instead of one phase at a time.

**This skill does not modify production code.** It reads, runs the app, observes, and reports. Defects go in the report; fixes are dispatched by the orchestrator or planned as a dedicated fix phase.

## 1. Scope the sweep

The invocation names the scope — a phase range (`P0–P3`), a list, or "everything since the last polish pass". If no scope is given:

- Find prior polish reports (`<planDir>/polish-qa-*.md`, `planDir` defaults to `docs/redesign/`; see `harness.config.json` → `planDir`) and take every **guarded** phase not covered by one.
- Only guarded phases are in scope (`node agent-workflow-harness/scripts/phase-guard.mjs` exits 0 for them). Polish QA on an unguarded phase produces noise — send that back through `phase-qa` first.

Read, for every phase in scope: the work-item briefs (`<planDir>/work-item-<id>.md`), `<planDir>/contracts.md`, the phase's `phase-<id>-qa*.md` reports (deferred/minor defects logged there are your starting checklist), and the design source each brief points at.

## 2. Evidence discipline

Same rules as `phase-qa` (see `.claude/skills/phase-qa/SKILL.md` §"Evidence discipline") — they are load-bearing here too:

1. **Evidence-or-reject.** Every PASS/FAIL cites a re-runnable artifact: a command **and its real output**, a `file:line`, or a screenshot path that exists on disk.
2. **Quotes are verbatim and sourced** — cite the source on the next line; never reconstruct from memory.
3. **No tooling-excuse without a positive control.** The runtime verifier is the control for browser hangs.

Before handing off, run `node agent-workflow-harness/scripts/qa-check.mjs <planDir>/polish-qa-<scope>.md` and fix the report until it exits 0.

## 3. The battery

Start the app once (`harness.config.json` → `runner.dev`). Say `use playwright mcp` before the first browser action. Screenshots go to `<planDir>/polish-qa-<scope>-screenshots/`.

### 3a. Acceptance-criterion matrix

For every runtime acceptance criterion in every in-scope work-item brief: navigate, drive the exact interaction the criterion describes, screenshot, record pass/fail with evidence. This is the exhaustive per-criterion walk that `phase-qa` deliberately skips — every control, every listed state, not just the primary flow.

### 3b. Integration seam edge cases

For each contract in scope, probe the states the functional gate skipped: **empty state, loading state, error state, large-data state**. Force them for real (empty DB result, throttled network, failing action, seeded bulk data) — do not infer from code shape.

### 3c. Detailed visual diff vs design source

For every screen in scope, compare the live render side-by-side with the design source: spacing, typography, color/token usage, missing interaction states (hover, focus, active, disabled), and responsive behavior at mobile and desktop viewports. Capture paired screenshots as evidence.

### 3d. Cross-phase regression sweep

Walk the integrated app across phase boundaries — flows that begin in one phase's surface and end in another's. Between-phase QA never sees these paths by design; this is the only place they get exercised.

## 4. Output

Write `<planDir>/polish-qa-<scope>.md` (e.g. `polish-qa-P0-P3.md`):

```
# Polish QA — <scope>

**Counts:** N critical · N major · N minor (N total).
**qa-check:** <clean | violations fixed before handoff>

[criterion matrix summary: per work-item pass/fail counts]
[seam edge-case summary table]
[visual diff summary: per screen, drift found y/n]
[cross-phase regression summary]
[screenshots index]
[defects ordered by severity]
```

Use `phase-qa`'s defect formats and severity guidance (critical = broken, major = functionally wrong, minor = cosmetic/edge-case). Expect most polish findings to be minor — that is normal and correct. A critical or major finding here means something slipped past a functional gate: flag it prominently, since it may indicate a `phase-qa` coverage gap worth fixing in that skill's route/interaction config.

**Polish defects do not block phase barriers.** They feed a fix backlog: recommend either dispatching work-item-executor fixes for the majors or planning a dedicated polish fix phase via `plan-work-item` for a large minor pile.

## What this skill does not cover

- Gating a phase — that's `phase-qa` + `phase-guard`. This skill runs after phases are already guarded.
- Fixing defects — orchestrator dispatches `work-item-executor`, or the user plans a fix phase.
- Writing or modifying any production code — read-only by design.
