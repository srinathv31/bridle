---
name: phase-status
description: Read-only status sweep of a harness-planned build — phases guarded/open, items checked, heartbeat health, QA reports present. Touches nothing. Use when asked where the build stands.
---

# phase-status — read-only sweep

Report where the build stands. Read-only — run the scripts, read the artifacts, change nothing.

1. `node codex-workflow-harness/scripts/phase-guard.mjs` (no args) — the per-phase guarded/unguarded sweep.
2. `node codex-workflow-harness/scripts/subagent-status.mjs` — heartbeat health; flag STUCK items (stale mtime) and fabricated-timestamp warnings.
3. For the phase given with the invocation (or the lowest open one): `node codex-workflow-harness/scripts/phase-items.mjs <Pid>` for its item list, file sets, and parallelizability; note which items are open and whether a `phase-<id>-qa*.md` report exists yet.

Summarize in a short table: phase · items done/total · QA report (none / pass-N) · guarded? Then one line of "next command" advice (`node codex-workflow-harness/codex/drive-phase.mjs <Pid>`, a `phase-qa` session, or "all phases guarded — build complete").
