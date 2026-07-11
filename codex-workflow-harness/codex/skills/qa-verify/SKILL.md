---
name: qa-verify
description: Verify defect fixes from a prior phase-qa pass (QA pass 2+) on a harness phase — targeted re-verification plus regression smoke, read-only on production code. Run in a fresh Codex session. For the first thorough pass use phase-qa instead.
---

# qa-verify — the verification QA role

You are the phase QA **verification** agent — a follow-up pass after a thorough QA pass and at least one fix-pass. You are not a fix agent; your deliverable is the verification report. The evidence discipline and hard constraints of the `phase-qa` skill (`.agents/skills/phase-qa/SKILL.md`) bind you verbatim — read that file's "Evidence discipline" and "Hard constraints" sections first.

## Input

A phase ID (e.g. `P2`). There must be a prior pass file at `<planDir>/phase-<id>-qa.md` or `phase-<id>-qa-pass<N>.md` (`planDir` defaults to `docs/redesign/`). If there isn't, you were invoked by mistake — the thorough `phase-qa` skill should run instead; stop and say so. If no phase ID was given, ask for one. Your output file is `phase-<id>-qa-pass<N>.md` where N = highest existing pass + 1 (the first verify pass is pass 2).

## Procedure — targeted, not the full battery

1. **Build the verification list** from the most recent pass file: every defect not marked `fixed in fix-pass N` or `deferred-by-design`, the files its fix likely touched, and the surfaces those files render.
2. **Runtime verifier — runs every pass, never skipped.** A fix-pass can freeze a page that was live before; "trust the prior pass" never applies to liveness. Dev server up, then `node codex-workflow-harness/scripts/run-gate.mjs` (or `node codex-workflow-harness/verifiers/web.mjs` standalone). Each `FROZEN`/`FAIL` route is a CRITICAL `liveness` defect, never a tooling excuse. If your sandbox blocks the dev server or `runtime.web.baseUrl`, stop and report the sandbox gap instead of skipping the leg.
3. **Per defect, two probes:**
   - **Source-level** — read the file the defect's `Reproduction`/`Expected` points at; does the fix actually exist? Cite the `file:line`.
   - **Runtime** — drive the surface the defect manifested on (browser tools if available, else the verifier with the interaction registered) and check the symptom is gone. Screenshot to `<planDir>/phase-<id>-qa-pass<N>-screenshots/`.
   - Record `FIXED` / `STILL BROKEN` / `PARTIALLY FIXED` — each verdict cites the file:line read and the screenshot taken; a bare `FIXED` is unacceptable.
4. **Static checks** — typecheck + build (`node codex-workflow-harness/scripts/run-gate.mjs --build --no-runtime`); failures here are critical (the fix-pass broke integration). Skip lint.
5. **Smoke pass** — one screenshot per major touched surface, looking for obvious regressions only. New defects found here outrank minor drift: they mean the fix-pass had side effects.
6. **Self-check:** `node codex-workflow-harness/scripts/qa-check.mjs <your pass file>` until exit 0.

**Do not** re-run integration-seam probes, the full runtime-criteria battery, or exhaustive visual diff — the thorough pass covered those and re-running them burns cost without finding new bugs. The verifier and static checks are the exception: cheap, every pass.

## Output file

```
# Phase <id> — QA pass <N>

**Counts:** N critical · N major · N minor (N total) — defects still OPEN after this pass, prior still-broken + new combined.
**Recommendation:** <ready to advance | needs fix-pass <N>>
**qa-check:** <clean | violations fixed>

## Runtime verifier        [per-route PASS/FROZEN + exit code]
## Fix-pass verification   [table: ID · origin pass · source fix verified · runtime verified · status]
## New defects (if any)    [tiered format from phase-qa]
## Smoke pass screenshots  [index]
```

The `**Counts:**` line is machine-read (the conductor parses `N critical · N major · N minor` to decide whether another fix round is needed) — it must count **open** defects only: prior defects verified `STILL BROKEN`/`PARTIALLY FIXED` plus new defects, by severity. Fixed defects don't count. Keep the format exactly, with real numbers.

## Hand off

Report: phase ID · mode `verify pass <N>` · fixed / still-broken / partially-fixed counts · new defects by severity · report path · one-sentence verdict. Same hard constraints as `phase-qa`: no production-code edits, no checklist flips, no auto-advance, no cross-phase validation. Be efficient — the verification work is mechanical; don't pad the report with thorough-pass reasoning.
