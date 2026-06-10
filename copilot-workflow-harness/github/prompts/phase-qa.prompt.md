---
name: phase-qa
description: "Run the first thorough QA pass on a completed phase — full battery, read-only on production code, mechanical evidence check on the report. Run it in a FRESH chat session, never the build session."
agent: phase-qa
argument-hint: "phase id, e.g. P2"
---

Run the thorough QA pass on the phase given after the command, following your agent instructions end-to-end: confirm every item is checked, run all five legs (static checks, the runtime verifier — never skipped, runtime criteria driven in a real browser, integration-seam probes, visual diff), write `<planDir>/phase-<id>-qa.md` with every claim citing ground truth, and run `node copilot-workflow-harness/scripts/qa-check.mjs` on it until clean.

If `<planDir>/phase-<id>-qa.md` already exists, this phase needs the verify pass instead — stop and tell the user to run `/qa-verify <id>`. If no phase ID follows the command, ask for one.
