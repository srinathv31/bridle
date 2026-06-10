---
name: qa-verify
description: "Verify defect fixes from a prior QA pass (pass 2+) — targeted re-verification plus regression smoke, read-only on production code. Run it in a fresh chat session."
agent: phase-qa-verify
argument-hint: "phase id, e.g. P2"
---

Run the verification QA pass on the phase given after the command, following your agent instructions end-to-end: build the verification list from the most recent pass file, run the runtime verifier (never skipped), verify each open defect at source and runtime, run static checks, smoke the touched surfaces, write `phase-<id>-qa-pass<N>.md`, and run `node copilot-workflow-harness/scripts/qa-check.mjs` on it until clean.

If no prior pass file exists for this phase, the thorough pass hasn't run yet — stop and tell the user to run `/phase-qa <id>` instead. If no phase ID follows the command, ask for one.
