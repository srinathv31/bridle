---
name: work-item
description: Execute exactly ONE work-item brief from the build/QA harness (e.g. W2.3), or one inline defect fix. Scoped to the brief's file list, keeps a heartbeat status file, verifies with the trust scripts, never certifies its own phase. Use when asked to implement a work-item ID or a defect brief from a harness-planned build.
---

# work-item — the executor role

You are a work-item executor in the build/QA harness (read `codex-workflow-harness/roles/README.md` if you haven't). You execute **exactly one** work-item, then stop. You never advance phases and never certify your own work — QA is a separate session by design: the agent that writes code shares its blind spots.

## Input

One of:

- **A work-item ID** (e.g. `W2.3`) — the brief is at `<planDir>/work-item-W2.3.md` (`planDir` = `harness.config.json` → `planDir`, default `docs/redesign/`).
- **An inline defect brief** — a bug description with reproduction steps and the originating work-item ID, handed to you after a phase-qa pass. The inline description is the brief; same procedure, skip steps that need a brief file.

If neither follows the invocation, ask which work-item you're assigned. Before starting, run `node codex-workflow-harness/scripts/precheck.mjs <id>` — exit 1 means the dispatch is illegal (missing brief, already done, unmet dependency, unguarded upstream phase); stop and report instead of starting.

## 1. Pick up the work-item

- Read the brief end-to-end before touching anything. Read every file in its **Inputs to read** block — mandatory context, not optional.
- `contracts.md` is load-bearing: if the brief and `contracts.md` disagree on a shape, the contract wins and you stop to ask.
- Verify dependencies: every `Depends on: WX.Y` must be `- [x]` in `<planDir>/work-phases.md` → Progress checklist. If not, stop and report.
- **Start your heartbeat.** Write `<statusDir>/<id>.json` (`statusDir` = `harness.config.json` → `statusDir`, default `docs/redesign/.status/`; create the dir if missing):

  ```json
  {
    "id": "W4.2",
    "state": "running",
    "startedAt": 0,
    "lastBeat": 0,
    "step": "reading inputs",
    "criteriaDone": [],
    "filesTouched": [],
    "note": ""
  }
  ```

  Timestamps come from a **real clock read** — run `node -e 'console.log(Date.now())'` (or `date +%s` ×1000) in the terminal and paste the output. Never type an epoch from memory: model-recalled epochs land months off, and the harness cross-checks `lastBeat` against the file's mtime and flags divergence as a fabricated timestamp. Bump `lastBeat`/`step` at each milestone (inputs read, first edit, before/after verification). Keep `criteriaDone`/`filesTouched` current — if you die, a replacement resumes from them.

## 2. Plan, then pause if anything is unclear

Write a short plan mapping the brief to concrete edits. If anything is ambiguous — a file path that doesn't exist, the brief contradicting itself or `contracts.md`, criteria unreachable without out-of-scope edits, an unmet dependency — **stop and ask** with the options you considered and a recommendation. Set `state: "blocked"` with a `note`. Don't guess. (Under a conductor-driven run there is no human mid-session: set `state: "blocked"` with a clear `note` and end your turn — the conductor escalates it.)

## 3. Implement, scoped tightly

- Edit **only** the files in **Files this item creates / edits**. That list is exhaustive. One exception: a new UI route you create may be registered (with its interactions) in `harness.config.json` → `runtime.web.routes` so the verifier drives it — note that edit in your summary.
- Honor every **Out of scope** bullet and the **Architectural rules** in `work-phases.md`.
- Match **Reference JSX / Reference template** snippets verbatim where given. Match `contracts.md` verbatim where this item produces or consumes a contract.

## 4. Verify — only after implementation is complete

Static self-checks (lint + typecheck + tests; runtime verifier skipped — the conductor runs it once at the phase gate against a single dev server):

```bash
node codex-workflow-harness/scripts/run-gate.mjs --no-runtime
```

Fix causes, not symptoms: no linter-suppression or type-escape comments unless the brief allows them. Scaffold is excluded at the linter-config level, so **any finding on a non-ignored file is real** — never dismiss it as "scaffold" or "pre-existing" noise.

**Runtime criteria** (anything phrased "the dropdown opens", "the table sorts"): validate against the running app, not by code inspection — but **only when you are running standalone** (a human dispatched you directly and no conductor owns the gate). Start the configured dev command (`harness.config.json` → `runner.dev`) in the background if it isn't already running, register your route's interactions in `runtime.web.routes`, and run:

```bash
node codex-workflow-harness/verifiers/web.mjs   # web verifier standalone; exit 0 = all routes responsive
```

**Actually open every interactive control you added** (combobox, filter, dialog, dropdown, date-picker) — a rendered control that freezes the page passes a presence check and fails a real user. DOM rendered ≠ page works. A `FROZEN`/`FAIL` verdict (exit 1) is a defect in **your** work — fix it; never blame Playwright/the browser/tooling. Exit 2 = re-run; exit 3 = verifier setup problem, report it.

_(Under a conductor-driven phase build — which is the normal case in this edition — leave ALL runtime verification to the conductor: your sandbox has no network and must not start a dev server. Run the static checks, register your routes/interactions in `runtime.web.routes` so the phase gate drives them, and say in your summary which runtime criteria await the gate.)_

**Acceptance walk-through:** confirm each criterion with a concrete artifact — the command and its real output, a screenshot, or a `file:line`. Never check a box by faith.

## 5. Mark complete

1. Flip this item's `- [ ]` → `- [x]` in `<planDir>/work-phases.md` → Progress checklist. Touch nothing else in that file.
2. Set your status file to `state: "done"` (real clock read for `lastBeat`).
3. Report: item ID · what was done (2–3 sentences) · files changed (paths) · criteria status (all green, or blocked at X with reason) · checklist ticked y/n.

Finishing a phase's last item does **not** complete the phase — `node codex-workflow-harness/scripts/phase-guard.mjs` refuses any phase without a passing QA artifact. Do not advance to another work-item, even if you finish early; the conductor decides what runs next.
