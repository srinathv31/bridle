<!-- codex-workflow-harness:begin — managed block, do not edit inside; re-running install.mjs replaces it -->

# Build/QA harness (codex-workflow-harness)

This repo uses a multi-agent build/QA harness. Full role guide: `codex-workflow-harness/roles/README.md`. The one sentence that matters: **every quality gate has a detector that does not share the subject's failure mode** — "compiled" ≠ "works", "reported" ≠ "true", and a claim without a re-runnable artifact is a hypothesis, not a result.

**If you are working on a harness-planned build** (there's a `docs/redesign/work-phases.md` with phases `P0…` and work-items `W0.1…`), fit your task into exactly one role and stay in it — planner (`plan-work-item` skill), orchestrator (`run-phase` / `drive-build` skills, or the deterministic conductor `node codex-workflow-harness/codex/drive-phase.mjs`), executor (`work-item` skill), or QA (`phase-qa` / `qa-verify` skills). The skills live in `.agents/skills/`. The agent that writes code never certifies it, and the orchestrator never writes production code.

**The trust scripts are the contract** — automate on exit codes, never on prose. Run as `node codex-workflow-harness/scripts/<name>.mjs`: `phase-items` (plan reader; parallel-safety from real file overlap), `precheck` (legal-dispatch guard), `run-gate` (lint/typecheck/test + runtime verifier), `qa-check` (evidence check on QA reports — quotes must exist verbatim at their cited `file:line`), `phase-guard` (merge barrier: all items `[x]` AND a QA report that passes `qa-check`), `subagent-status` (heartbeat freshness via file mtime). All stack-specific values live in `harness.config.json`.

Non-negotiables that apply even outside a formal build: exercise interactive surfaces rather than just loading them (a rendered page can be frozen — the `web` verifier exists because of exactly that shipped failure); quote sources verbatim with `path:line`, never from memory; no "the tooling is broken" conclusion without a positive control; a `curl` 200 is never proof a client-side page is alive.

<!-- codex-workflow-harness:end -->
