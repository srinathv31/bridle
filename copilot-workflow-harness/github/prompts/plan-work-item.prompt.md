---
name: plan-work-item
description: "Decompose a feature brief, spec, or design URL into the harness plan files: work-phases.md, contracts.md, and one work-item brief per chunk."
agent: harness-planner
argument-hint: "the feature brief, spec path, or design URL to decompose"
---

Decompose the brief given after the command into the harness plan files, following your agent instructions end-to-end: read the brief in full, recon the codebase's integration surface, **post the dependency-graph sketch and wait for confirmation**, then produce `work-phases.md`, `contracts.md`, and one `work-item-<id>.md` per chunk in the plan dir, verify internal consistency, and hand off.

If no brief follows the command, ask for one (a prose description, a spec file path, or a design URL) before doing anything else. Do not implement anything; when the plan is ready, point the user at `/run-phase P0` in a fresh chat session.
