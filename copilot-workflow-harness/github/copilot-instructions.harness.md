<!-- copilot-workflow-harness:begin — managed block, do not edit inside; re-running install.mjs replaces it -->

# Build/QA harness (copilot-workflow-harness)

This repo uses a multi-agent build/QA harness. Full role guide: `copilot-workflow-harness/roles/README.md`. The one sentence that matters: **every quality gate has a detector that does not share the subject's failure mode** — "compiled" ≠ "works", "reported" ≠ "true", and a claim without a re-runnable artifact is a hypothesis, not a result.

**If you are working on a harness-planned build** (there's a `docs/redesign/work-phases.md` with phases `P0…` and work-items `W0.1…`), fit your task into exactly one role and stay in it — planner (`/plan-work-item`), orchestrator (`/run-phase`, `/drive-build`), executor (`/work-item`), or QA (`/phase-qa`, `/qa-verify`). The agent that writes code never certifies it.

**The trust scripts are the contract** — automate on exit codes, never on prose. Run as `node copilot-workflow-harness/scripts/<name>.mjs`: `phase-items` (plan reader; parallel-safety from real file overlap), `precheck` (legal-dispatch guard), `run-gate` (lint/typecheck/test + runtime verifier), `qa-check` (evidence check on QA reports — quotes must exist verbatim at their cited `file:line`), `phase-guard` (merge barrier: all items `[x]` AND a QA report that passes `qa-check`), `subagent-status` (heartbeat freshness via file mtime). All stack-specific values live in `harness.config.json`.

Non-negotiables that apply even outside a formal build: exercise interactive surfaces rather than just loading them (a rendered page can be frozen — the `web` verifier exists because of exactly that shipped failure); quote sources verbatim with `path:line`, never from memory; no "the tooling is broken" conclusion without a positive control; a `curl` 200 is never proof a client-side page is alive.

<!-- copilot-workflow-harness:end -->
