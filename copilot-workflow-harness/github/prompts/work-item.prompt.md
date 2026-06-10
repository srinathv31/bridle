---
name: work-item
description: "Execute one work-item brief (e.g. W2.3) — scoped implementation with heartbeat, static self-checks, and runtime verification. The manual dispatch path; also used in side-by-side sessions for parallel items."
agent: work-item-executor
argument-hint: "work-item id, e.g. W2.3 — or paste an inline defect brief"
---

Execute the work-item given after the command, following your agent instructions end-to-end: read the brief and its inputs, heartbeat at `<statusDir>/<id>.json`, implement strictly inside the brief's file list, verify with `node copilot-workflow-harness/scripts/run-gate.mjs --no-runtime` plus the runtime checks your agent file requires, tick the progress checklist, and report.

If what follows the command is a defect description instead of an ID, treat it as an inline defect brief per your agent instructions. If nothing follows, ask which work-item you're assigned. Before starting, run `node copilot-workflow-harness/scripts/precheck.mjs <id>` — exit 1 means the dispatch is illegal (missing brief, already done, unmet dependency, unguarded upstream phase); stop and report instead of starting.
