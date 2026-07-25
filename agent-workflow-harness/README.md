# agent-workflow-harness

A portable trust layer for **multi-agent builds**, packaged as its own repo you reuse across
projects. It makes a fleet of AI coding agents produce verifiable work instead of plausible-sounding
work, by putting a **mechanical detector behind every claim** — and it stands up in any repo with
**one command**.

**Targets Claude Code first.** `install.mjs` vendors the kit, installs the skills/agents/workflow
into your project's `.claude/`, wires the lint/format hooks into `settings.json`, and writes a
config — so you drive a build with `/drive-build auto` exactly like the reference project did. The
trust layer underneath (plain Node scripts) is runtime-neutral and also runs in CI or any other
agent harness.

> If you read one thing: **every quality gate here has at least one detector that does not share
> the subject's failure mode.** "Rendered" ≠ "alive." "Reported" ≠ "true." A claim without a
> re-runnable artifact is a hypothesis — including claims made by QA agents and by the orchestrator
> itself.

This kit is the generalized form of a harness that was built around a real failure: a multi-agent
build shipped a page that **froze the instant you opened a filter**, and every signal the agents
read (DOM rendered, 0 console errors, clean build, 200s) said PASS. Two root causes, two backbones:

- **Backbone A — runtime truth.** Agents perceive a page through a snapshot/console/network log,
  none of which encodes _responsiveness_. There was no sense organ for "alive." → the **runtime
  verifier** (pluggable; `web` = a freeze-canary that drives every control and re-probes the main
  thread).
- **Backbone B — agent-claim truth.** Agent reports are unreliable; the original audit even
  _confabulated_ a lint quote that never existed. → **`qa-check`** greps every cited quote/artifact
  against ground truth, and **`phase-guard`** won't call a phase done until a QA report exists that
  itself passes `qa-check`.

---

## What's in the box

```
agent-workflow-harness/          # this repo — clone once, reuse everywhere
  install.mjs                    # ← the ONE command: stands the harness up in a target project
  harness.config.example.json    # the template install.mjs copies to <target>/harness.config.json
  harness.config.schema.json     # JSON Schema: every field documented
  lib/
    config.mjs                   # resolves the manifest; turns app-agnostic scripts into yours
    hook-runner.mjs              # stack-agnostic engine behind the lint/format hooks
  scripts/                       # the portable trust layer — plain Node, exit code is the contract
    phase-items.mjs              # deterministic plan reader; dep-chain groups + parallel-safety from REAL file overlap
    precheck.mjs                 # refuses an illegal dispatch before spawning an agent
    run-gate.mjs                 # whole-repo gate: runner verbs + the runtime verifier, one verdict
    qa-check.mjs                 # greps a QA report's claims against ground truth
    phase-guard.mjs              # the merge barrier: items [x] AND a QA report that passes qa-check
    subagent-status.mjs          # heartbeat reader; flags stuck agents
    hook-selftest.mjs            # proves the lint/format hooks actually have teeth
  verifiers/                     # the pluggable runtime-truth layer (see verifiers/README.md)
    index.mjs · web.mjs · none.mjs
  hooks/                         # lint-check.sh + format-on-write.sh (thin wrappers → hook-runner)
  roles/README.md                # the guide an AI agent reads to find its role + the disciplines
  templates/                     # work-phases / contracts / work-item / defect-ledger skeletons the planner fills in
  claude/                        # the Claude Code binding pack → installed into <target>/.claude/
    skills/  (init-harness · plan-work-item · work-item · orchestrate · run-phase · drive-build · phase-qa · polish-qa)
    agents/  (work-item-executor · phase-qa · phase-qa-verify)
    workflows/execute-phase.js   # the deterministic per-phase engine
    settings.hooks.json          # the PostToolUse hook snippet merged into settings.json
```

After install, the **target project** gets: `agent-workflow-harness/` (the vendored kit),
`harness.config.json` (at its root), `.claude/{skills,agents,workflows}` + merged hooks, and a
`docs/redesign/` plan dir seeded with templates. The **scripts are the portable trust layer**; the
**claude/** pack is the Claude Code binding that tells an agent _when_ to run them.

---

## The mental model (30 seconds)

A build is decomposed into **phases** (`P0, P1, …`), each holding **work-items** (`W0.1, W4.2, …`).
Items in a phase run **parallel** when their file sets are genuinely disjoint, **serial** when they
aren't — and that's decided **mechanically** by `phase-items`, not by a brief's self-report. Phases
are **merge barriers**: you don't advance until the phase is complete _and_ QA-passed (`phase-guard`).

Four roles, kept separate — **the agent that writes code never certifies it**:

| Role             | Produces / does                                                            | Never does                     |
| ---------------- | -------------------------------------------------------------------------- | ------------------------------ |
| **Planner**      | the plan files (`work-phases.md`, `contracts.md`, `work-item-*.md`)        | implement anything             |
| **Orchestrator** | dispatches executors + QA, gates transitions on the detectors              | write production code          |
| **Executor**     | implements one work-item; keeps a heartbeat at `statusDir/<id>.json`       | advance phases; certify itself |
| **QA**           | validates a finished phase read-only; emits a defect list + `qa-check`s it | edit production code           |

Full role guide with per-role script cookbook: [`roles/README.md`](roles/README.md).

---

## Install into a project — one command

> Full guide — including how to make this its own git repo and call it from anywhere
> (`npx github:…`, global install, or a shell alias) — is in **[INSTALL.md](INSTALL.md)**.

Clone this repo once, then from anywhere run the installer against your target project:

```bash
git clone <this-repo> ~/agent-workflow-harness
cd ~/my-project
node ~/agent-workflow-harness/install.mjs              # installs into the current dir
# or: node ~/agent-workflow-harness/install.mjs --target ~/my-project
```

It is **idempotent** (re-run to update) and does all of this:

1. **Vendors the kit** → `<project>/agent-workflow-harness/` (scripts, lib, verifiers, hooks, …).
2. **Installs the Claude Code bindings** → `<project>/.claude/skills` (8), `.claude/agents` (3),
   `.claude/workflows/execute-phase.js`.
3. **Merges the lint/format hooks** into `<project>/.claude/settings.json` (preserves your existing
   settings; never duplicates).
4. **Writes `<project>/harness.config.json`** from the template, **autodetecting** your package
   manager's `lint`/`typecheck`/`test`/`build`/`dev` verbs (pnpm/npm/yarn, and starter guesses for
   Python/Go/Rust/Ruby). Won't overwrite an existing config without `--force`.
5. **Creates the plan dir** (`docs/redesign/`, seeded with `work-phases`/`contracts`/`defect-ledger`
   templates) and **gitignores** the status dir.

Then **review `harness.config.json`** — the installer gets you 90% there, but confirm:

- `runner.*` — the autodetected verbs match your scripts.
- `runtime.verifier` — `web` for a browser UI (fill `runtime.web.routes` with your routes +
  interactions), `none` for a library/service/CLI, or a path to your own adapter
  ([`verifiers/README.md`](verifiers/README.md)). **Playwright is only invoked when `verifier: "web"`.**
- `source.extensions` — **add your language's extensions** if non-JS. ⚠️ The one trap: `qa-check`
  only checks citations whose extension is listed (fail-open otherwise).
- `hooks.{lint,format}` — your linter/formatter command + a `selftest` fixture it's guaranteed to
  react to (the one irreducibly per-stack value).

Finally: `npm i -D playwright-core` if you use the `web` verifier, then **restart Claude Code** so it
picks up the new skills/agents/workflow.

The plan files (`work-phases.md`, `contracts.md`, `work-item-*.md`) are authored fresh per project by
the Planner — **your business logic lives there; the harness never needs to know it.**
Business-logic portability is free; only tech-stack verbs/paths move.

### Drive a build (Claude Code)

```
/plan-work-item   <your feature brief>     # Planner → produces the plan files
/drive-build auto                          # autonomous conductor: phase → gate → QA → barrier → next
# or /run-phase P1                         # manual, one phase at a time with a human at each barrier
```

### Quick verify it's wired

```bash
node agent-workflow-harness/scripts/hook-selftest.mjs       # are the lint/format hooks alive?
node agent-workflow-harness/scripts/phase-items.mjs P1      # parses your plan? item list + overlap
node agent-workflow-harness/scripts/phase-guard.mjs         # every completed phase has passing QA?
```

---

## The scripts — exit code is the contract

Automate on the exit code; don't parse prose. Run them as `node agent-workflow-harness/scripts/<name>.mjs`.

| Script              | What it checks                                                                                                         | Exit codes                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `phase-items <Pid>` | the phase's items, file sets, `isUI`, dep-chain dispatch `groups`, and `parallelizable` from **real file-set overlap** | `0` parsed · `2` setup                   |
| `precheck <id>`     | refuses an illegal dispatch: missing brief, item already `[x]`, unmet deps, unguarded upstream phase                   | `0` safe · `1` blocked · `2` setup       |
| `run-gate`          | runs `runner.{lint,typecheck,test}` (+`--build`) and the runtime verifier; one structured verdict                      | `0` pass · `1` fail · `2` verifier setup |
| `qa-check <report>` | cited screenshots/`path:line` resolve; file-attributed quotes actually appear in the file                              | `0` clean · `1` violation · `2` usage    |
| `phase-guard [Pid]` | a phase is done only when every item is `[x]` **and** its QA report passes `qa-check`                                  | `0` guarded · `1` unguarded · `2` setup  |
| `subagent-status`   | reads `statusDir/<id>.json` heartbeats; flags a `running` agent with a stale `lastBeat` as STUCK                       | `0` healthy · `1` stuck · `2` malformed  |
| `hook-selftest`     | feeds the lint/format hooks a known-bad fixture; fails if a hook is a dead no-op                                       | `0` alive · `1` dead · `2` setup         |

---

## What's portable vs. what you adapt

| Layer                                       | Files                                                       | Porting effort                                             |
| ------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| **Trust core** (plan-file logic)            | `phase-items`, `precheck`, `phase-guard`, `subagent-status` | none — config only                                         |
| **Evidence check**                          | `qa-check`                                                  | config only — but **you must add your source extensions**  |
| **Gate orchestration**                      | `run-gate`, `lib/config.mjs`, `lib/hook-runner.mjs`         | config only                                                |
| **Editor hooks**                            | `hooks/*.sh` + `hook-selftest`                              | swap linter/formatter command + selftest fixture in config |
| **Runtime truth** (the genuinely hard part) | `verifiers/*`                                               | reuse `web`/`none`, or write a ~40-line adapter per stack  |

The one concept that doesn't reduce to a string swap is **runtime truth** — "does it work when
exercised." On web that's freeze detection; on an API it's a request/response probe; on a CLI it's
spawn-and-assert. That's why it's a **plugin**, not a config value.

### Model tiers are aliases, on purpose

The Claude-edition agents declare a **tier alias** (`model: opus`, `model: sonnet`), never a full
model ID. Two reasons: a new Opus release then needs no kit change, and the kit stays installable on
older CLIs that can't resolve a newer full ID at all. Don't "fix" these to pinned IDs — the churn is
the bug being avoided.

The cost is real and accepted: the alias tracks the latest recommended model in its tier, so the
model behind your QA gate can shift under a milestone on a CLI bump. If one milestone needs a frozen
gate, pin the full ID **in the installed copy** (`.claude/agents/phase-qa.md`) after install, and
leave the kit on the alias.

The Copilot edition is the exception — its `model:` must match your model-picker name exactly, so
those are full names and do need a bump per release.

---

## Four hardenings baked in (vs. the original)

1. **Major defects block the barrier.** `gate.blockOn` defaults to `["critical","major"]`. In the
   original, only `critical` blocked, so a major load-bearing defect could pass an autonomous
   barrier on the conductor's judgment alone. Now the policy is explicit and mechanical.
2. **Line-drift no longer reads as fabrication.** `qa-check` now distinguishes a quote that's
   **absent from the file** (`CONFABULATED_QUOTE`, hard fail) from one that's **present but at a
   drifted line** (`STALE_CITATION`, warning). A mid-phase fix that shifts a cited line used to
   trip the confabulation gate and cost a cycle; now it's a non-fatal "bump the line ref."
3. **Heartbeat freshness is kernel truth, not self-report.** The P7–P9 live run caught every
   executor hand-typing plausible-looking `lastBeat` epochs that were off by a **year** (file
   mtimes proved the items really ran in parallel, seconds apart). `subagent-status` now runs
   staleness math on the status file's **mtime** — which the kernel stamps and an agent can't
   fabricate — and flags a wildly divergent `lastBeat` as a fabricated-timestamp warning. The
   executor brief now mandates real clock reads (`$(date +%s)000`) for the informational fields.
4. **A down server is SETUP, not FROZEN.** The web verifier now preflights the base URL; a
   connection-refused server returns `SETUP` (exit 3) instead of marking every route `FROZEN`
   (exit 1). "Start the dev server" and "the app froze" demand different fixes, so they must be
   different verdicts.

---

## The disciplines (they bind every role)

1. **Evidence-or-reject** — every PASS/FIXED/checked-box cites a re-runnable artifact. Re-run the
   detector; don't trust a self-reported verdict (the orchestrator re-runs `phase-guard` itself).
2. **Quotes are verbatim and sourced** — `qa-check` enforces it mechanically.
3. **Exercise interactive surfaces, don't just load them** — the worst failures hide behind the
   first click.
4. **No tooling-excuse without a positive control** — a hang is an app failure until proven
   otherwise; an `INCONCLUSIVE`/`SETUP` verifier result fails loud, it doesn't pass.
5. **Keep QA separate from execution** — the agent that wrote the code shares its blind spots.
6. **A phase isn't done because boxes are checked** — it's done when `phase-guard` passes.
7. **Heartbeat or be replaced** — a `running` agent with no fresh `lastBeat` is indistinguishable
   from a hung one. Supervision is bounded: stuck → resume once → escalate.
8. **Ground truth overrides self-report for dispatch too** — parallel-safety is real file-set
   overlap (`phase-items`), never a brief's claim.
