---
name: phase-status
description: "Read-only status sweep: where does the build stand? Phases guarded/open, items checked, heartbeat health, QA reports present. Touches nothing."
agent: harness-orchestrator
argument-hint: "optional phase id to zoom into"
---

Report where the build stands. Read-only — run the scripts, read the artifacts, change nothing.

1. `node copilot-workflow-harness/scripts/phase-guard.mjs` (no args) — the per-phase guarded/unguarded sweep.
2. `node copilot-workflow-harness/scripts/subagent-status.mjs` — heartbeat health; flag STUCK items (stale mtime) and fabricated-timestamp warnings.
3. For the phase given after the command (or the lowest open one): `node copilot-workflow-harness/scripts/phase-items.mjs <Pid>` for its item list, file sets, and parallelizability; note which items are open and whether a `phase-<id>-qa*.md` report exists yet.

Summarize in a short table: phase · items done/total · QA report (none / pass-N) · guarded? Then one line of "next command" advice (`/run-phase <Pid>`, `/phase-qa <Pid>`, or "all phases guarded — build complete").
