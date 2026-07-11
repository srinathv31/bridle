# The Build/QA Harness — a guide for AI agents joining it

You are an AI agent working on a project that uses this multi-agent build/QA harness. This document
explains the **mental model, the four roles, how to fit your current task into one, and the
disciplines that bind all of them.** Read it before you start.

The harness is **stack-agnostic.** It ships as a folder you copy into any repo — Next.js, FastAPI,
Go, Rails, anything. Nothing here assumes a package manager, a language, or a file extension. Every
stack-specific value (which command lints, which files are source, how ids are spelled, whether
there's a browser to drive) comes from one manifest: **`harness.config.json`**. When this guide says
"the configured lint verb," it means `harness.config.json` → `runner.lint`; the scripts read it for
you. Run them as `node codex-workflow-harness/scripts/<name>.mjs`.

If you read only one sentence, read this: **every quality gate here has at least one detector that
does not share the subject's failure mode.** "Compiled" ≠ "works." "Reported" ≠ "true." A claim
without a re-runnable artifact is a hypothesis, not a result — including claims made by QA agents,
and by you.

---

## 1. The mental model

A build is decomposed into **phases** (`P0`, `P1`, …), each containing **work-items** (`W0.1`,
`W4.2`, …). The exact id spelling is config-driven (`ids.checklistItem` / `ids.phaseLabel`); the
default `W<phase>.<n>` / `P<phase>` scheme is just the example.

- **Work-items within a phase run in parallel only when their file sets don't overlap**, sequential
  when they depend on each other. That overlap is decided **mechanically** by
  `node codex-workflow-harness/scripts/phase-items.mjs <Pid>`, which reads each item's _Files this item creates /
  edits_ list and computes real overlap — it does **not** trust a brief's self-reported
  "Parallel-safe" line.
- **Phases are merge barriers.** You do not advance past a phase until it is complete _and QA-passed_
  — proven by `node codex-workflow-harness/scripts/phase-guard.mjs <Pid>` exiting 0.

Four roles, each a separate agent. **Keep them separate** — the agent that writes code must never be
the one that certifies it; they share blind spots.

| Role             | Does                                                                                                        | Never does                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **Planner**      | Decomposes a brief into `work-phases.md`, `contracts.md`, and one `work-item-<id>.md` per chunk             | Implements anything                     |
| **Orchestrator** | Dispatches executors + QA, supervises heartbeats, gates phase transitions                                   | Writes production code                  |
| **Executor**     | Implements **exactly one** work-item, scoped to its brief; maintains a heartbeat at `<statusDir>/<id>.json` | Advances phases; certifies its own work |
| **QA**           | Validates a **finished** phase, read-only, produces a defect list; runs `qa-check` on its own report        | Edits production code                   |

The plan lives in **`<planDir>`** (`harness.config.json` → `planDir`, default `docs/redesign`):

- **`work-phases.md`** — the phase table, the architectural rules, and the progress checklist.
- **`contracts.md`** — the typed surfaces between work-items (so parallel items build against an
  agreed interface without reading each other's code).
- **`work-item-<id>.md`** — one self-contained brief per chunk; the entire prompt for one executor.

---

## 2. The tooling — scripts, each a detector with teeth

All are plain Node, runnable from any agent runtime or CI. **Exit code is the contract** — automate
on it; don't parse prose.

| Command                                                      | What it checks                                                                                                                                                        |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node codex-workflow-harness/scripts/phase-items.mjs <Pid>`                 | Deterministic plan reader: emits each item's file set and computes parallel-safety from **real file-set overlap**, overriding any brief's self-reported claim.        |
| `node codex-workflow-harness/scripts/precheck.mjs <id>`                     | Legal-dispatch guard, run **before** spawning: refuses a missing brief, an already-`[x]` item, an unmet `Depends on:`, or a phase with incomplete/unguarded upstream. |
| `node codex-workflow-harness/scripts/run-gate.mjs [--build] [--no-runtime]` | Whole-repo detector gate: runs the configured `lint` / `typecheck` / `test` verbs (+ `build` with `--build`) then the **runtime verifier**. One structured verdict.   |
| `node codex-workflow-harness/scripts/qa-check.mjs <report>`                 | Mechanical evidence check on a QA report: cited screenshots / `file:line` must resolve; file-attributed quotes must appear verbatim in the file.                      |
| `node codex-workflow-harness/scripts/phase-guard.mjs <Pid>`                 | Merge barrier: a phase is done only when **every item is `[x]`** AND a phase QA report exists that itself passes `qa-check`.                                          |
| `node codex-workflow-harness/scripts/subagent-status.mjs`                   | Heartbeat reader: flags a `running` subagent with a stale `lastBeat` as STUCK; carries handoff state.                                                                 |
| `node codex-workflow-harness/scripts/hook-selftest.mjs`                     | Feeds the configured lint/format hooks a known-bad fixture; fails if a hook is dead or a no-op.                                                                       |

### The runtime verifier is pluggable

"Does the built thing actually _work_ when exercised" has a different shape per stack, so `run-gate`
delegates it to a **verifier** selected by `harness.config.json` → `runtime.verifier`:

- **`"web"`** — drives a real browser: loads each configured route, exercises every interactive
  control, and re-probes responsiveness **out-of-band** to catch a page that rendered fully but
  **froze on the first click**. (This is the failure the harness was built around — a frozen-but-
  rendered page is byte-identical to a healthy one in a DOM snapshot.)
- **`"none"`** — a no-op for projects with no runtime surface (a pure library, say). Reports SKIPPED.
- **a path** — your own adapter (e.g. an `"api"` verifier that asserts an endpoint answers with a
  contract-shaped body, or a `"cli"` verifier that runs a command and checks its exit). Verifiers
  live in `codex-workflow-harness/verifiers/`; see `codex-workflow-harness/verifiers/README.md`.

Browser freeze-detection is **one instance** of the general idea. Throughout this guide, "the runtime
verifier passes" means whatever `run-gate` selected for this project — only web apps invoke the
browser.

Plus the live **lint/format hooks** (`harness.config.json` → `hooks.*`): on edit, the configured lint
hook **blocks** on an error and **surfaces** warnings as context. Scaffold is excluded at the config
level, so any finding on a non-scaffold file is real — never dismiss it as "scaffold noise."

---

## 3. How to fit YOUR task into the harness

First decide which role you are. The task framing tells you.

### You're given a design/spec to break down → you are the **Planner**

Produce `work-phases.md` (phases, parallel/sequential mode, dependency list, progress checklist),
`contracts.md` (the exact typed surfaces), and one `work-item-<id>.md` per chunk. (Templates for all
three live in `codex-workflow-harness/templates/`.)

- Every **UI** work-item's acceptance criteria **must** include a runtime-verifier criterion phrased
  generally: _"every interactive control responds and the route stays live; the configured runtime
  verifier passes."_ For a web project that means the browser freeze-canary; for an API project, the
  api verifier — same sentence, different adapter.
- Phrase every criterion so it's checkable against an **artifact**, not a subjective "looks right."
- Keep parallel items' _Files this item creates / edits_ sets genuinely **disjoint** —
  `phase-items.mjs` will catch and serialize any overlap, so a "Parallel-safe: yes" line that shares
  a file just becomes a wasted serialization.
- Hand off; do not implement.

### You're running the build → you are the **Orchestrator**

You build each phase, gate the barrier, and never write production code. Per phase, the pipeline is:

> **read the plan** (`phase-items.mjs <Pid>`) → **build** (dispatch executors — parallel iff file
> sets are proven disjoint, else serial) → **ONE whole-repo gate** (`run-gate.mjs`, against a single
> running app, with a bounded fix loop) → **QA in a separate agent** + `qa-check` → **verify the
> barrier** (`phase-guard.mjs <Pid>`).

The reliability rules you enforce:

- `node codex-workflow-harness/scripts/precheck.mjs <Pid>` **before** launching a phase. Red precheck = do not
  launch.
- Watch the run via heartbeats: poll `node codex-workflow-harness/scripts/subagent-status.mjs` on an interval. A
  STUCK subagent (stale `lastBeat`) or a missed deadline → **kill and resume once** (cheap); still
  stuck → **escalate to a human.** Never an unbounded wait, never a silent infinite retry.
- Parallel dispatch happens **only** when `phase-items.mjs` proves the file sets disjoint — a brief's
  self-reported "parallel-safe" claim does not override real overlap.
- Run the gate **once** against a single running app — don't let each executor start its own and
  contend for the port.
- After the verdict, independently re-run `phase-guard.mjs <Pid>` (don't trust a self-reported
  verdict). Advance only on exit 0, then `precheck.mjs P<next>`.

### You're assigned one work-item ID → you are the **Executor**

Read the brief end-to-end plus everything in its _Inputs to read_ block.

- Run `node codex-workflow-harness/scripts/hook-selftest.mjs` once at session start — a dead hook means no inline
  protection.
- **Write your heartbeat:** `<statusDir>/<id>.json` with `state:"running"`; bump `lastBeat`/`step`
  at each milestone; keep `criteriaDone`/`filesTouched` current. (`<statusDir>` =
  `harness.config.json` → `statusDir`.)
- Stay **scoped to the brief's file list.** Honor every _Out of scope_ bullet and the architectural
  rules in `work-phases.md`. Match `contracts.md` verbatim. If anything is ambiguous, **pause and
  ask** — don't guess; set `state:"blocked"` with a `note`.
- Verify with the configured **lint / typecheck / test** verbs. For any UI item, **actually exercise
  every control** (drive it, not a presence check), then confirm the runtime verifier passes. A
  FROZEN/BROKEN verdict is a defect in **your** work — fix it; do not blame tooling. _(Under a
  per-phase gate, the orchestrator runs the runtime verifier once against a single app — run static
  self-checks yourself, but don't start a second app and contend for the port.)_
- Check a box only with a concrete artifact behind it (command + real output, screenshot,
  `file:line`). Flip `[x]` in `work-phases.md`, set `state:"done"`. Don't advance phases.

### You're validating a finished phase → you are **QA**

**Read-only on production code.** Legs: static checks (the configured typecheck/build), the **runtime
verifier (never skipped)**, interactive checks that drive every control, integration seams, and a
visual diff where relevant.

- A FROZEN/BROKEN runtime verdict is a **critical defect** — never downgrade it to "a tooling
  limitation," and never accept a bare `curl`/HTTP 200 as proof a client surface is alive.
- Every claim in your report cites ground truth. Quote files **verbatim** with `path:line`. Before
  handing off, run `node codex-workflow-harness/scripts/qa-check.mjs <your-report>` — a non-zero exit means a
  citation is missing or a quote is confabulated; fix the report first.
- Never conclude "the tool is broken" without a **positive control** proving it works on a healthy
  subject right now.
- Classify each defect by severity. The merge barrier blocks on the severities in
  `harness.config.json` → `gate.blockOn` (default `["critical","major"]`) — **major defects block,
  not just critical.**

---

## 4. The disciplines that bind all roles

1. **Evidence-or-reject.** Every load-bearing claim — a PASS, a FIXED, a checked box — cites a
   re-runnable artifact (command + real output, `file:line`, or a screenshot that exists). A bare
   assertion does not gate progress. This applies to a gate's own verdict too: re-run `phase-guard`
   rather than trusting the value it returns.
2. **Quotes are verbatim and sourced.** Never reconstruct a quote from memory or paraphrase into
   quotation marks. `qa-check.mjs` enforces this mechanically.
3. **Exercise interactive surfaces, don't just load them.** The worst failures hide behind the first
   click. "It rendered" is not the claim "it works."
4. **No tooling-excuse without a positive control.** A hang is an app failure until proven otherwise;
   an HTTP 200 is never client-side health evidence.
5. **Keep QA separate from execution.** The agent that wrote the code shares its blind spots.
6. **A phase isn't done because boxes are checked** — it's done when `phase-guard` passes (boxes **+**
   a QA artifact that itself passes `qa-check`).
7. **Heartbeat or be replaced.** A subagent with no fresh `lastBeat` is indistinguishable from a hung
   one; keep your status file current. Supervision is bounded: stuck → resume once → escalate.
8. **Ground truth overrides self-report for dispatch, too.** Parallel-safety is computed from real
   file-set overlap (`phase-items.mjs`), not from a brief's claim.
