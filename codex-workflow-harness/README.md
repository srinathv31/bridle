# codex-workflow-harness

A portable trust layer for **multi-agent builds**, packaged as its own repo you reuse across
projects — this is the **OpenAI Codex** edition of `agent-workflow-harness`. It makes AI coding
agents produce verifiable work instead of plausible-sounding work, by putting a **mechanical
detector behind every claim** — and it stands up in any repo with **one command**.

**Targets the Codex CLI (and the Codex IDE extension for interactive roles).** The headless
`codex exec` mode is what makes this edition special: orchestration is a **deterministic Node
conductor** (`codex/drive-phase.mjs`) that spawns one Codex session per work-item and per QA pass
— the loop that had to be prose in the Copilot edition is real code again, like the Claude Code
original. The trust layer underneath (plain Node scripts) is runtime-neutral and identical to the
other editions; only the binding pack differs.

> If you read one thing: **every quality gate here has at least one detector that does not share
> the subject's failure mode.** "Rendered" ≠ "alive." "Reported" ≠ "true." A claim without a
> re-runnable artifact is a hypothesis, not a result — including claims made by QA agents and by
> the orchestrator itself.

The kit is the generalized form of a harness built around a real failure: a multi-agent build
shipped a page that **froze the instant you opened a filter**, while every signal the agents read
(DOM rendered, 0 console errors, clean build, 200s) said PASS. Two backbones came out of it:

- **Backbone A — runtime truth.** The **runtime verifier** (pluggable; `web` = a freeze-canary
  that drives every control and re-probes the main thread out-of-band). Plain Node +
  `playwright-core` — it does **not** need an MCP server.
- **Backbone B — agent-claim truth.** **`qa-check`** greps every cited quote/artifact in a QA
  report against ground truth, and **`phase-guard`** won't call a phase done until a QA report
  exists that itself passes `qa-check`.

---

## What's in the box

```
codex-workflow-harness/          # this repo — clone once, reuse everywhere
  install.mjs                    # ← the ONE command: stands the harness up in a target project
  harness.config.example.json    # template install.mjs copies to <target>/harness.config.json
  harness.config.schema.json     # JSON Schema: every field documented
  lib/                           # config resolution + the stack-agnostic hook engine
  scripts/                       # the portable trust layer — plain Node, exit code is the contract
    phase-items.mjs              # deterministic plan reader; parallel-safety from REAL file overlap
    precheck.mjs                 # refuses an illegal dispatch before work starts
    run-gate.mjs                 # whole-repo gate: runner verbs + the runtime verifier, one verdict
    qa-check.mjs                 # greps a QA report's claims against ground truth
    phase-guard.mjs              # the merge barrier: items [x] AND a QA report that passes qa-check
    subagent-status.mjs          # heartbeat reader (file mtime is the trust anchor); flags stuck items
    hook-selftest.mjs            # proves the lint/format hooks actually have teeth
  verifiers/                     # the pluggable runtime-truth layer (web.mjs · none.mjs · README.md)
  hooks/                         # lint-check.sh + format-on-write.sh (used by hook-selftest; optional live wiring)
  roles/README.md                # the guide an AI agent reads to find its role + the disciplines
  templates/                     # work-phases / contracts / work-item skeletons the planner fills in
  codex/                         # the Codex binding pack
    drive-phase.mjs              # ★ the deterministic conductor: codex exec per item/QA, gates in code
    skills/                      # → installed into <target>/.agents/skills/ (repo-scoped, versioned)
      init-harness · plan-work-item · run-phase · work-item · phase-qa · qa-verify · drive-build · phase-status
    AGENTS.harness.md            # managed block merged into <target>/AGENTS.md
    config.harness.toml          # → <target>/.codex/config.toml (sandbox + approval defaults)
  PREFLIGHT.md                   # first-run validation checklist per machine
```

After install, the **target project** gets: `codex-workflow-harness/` (the vendored kit, conductor
included), `harness.config.json`, `.agents/skills/` (8 skills), the managed block in `AGENTS.md`,
`.codex/config.toml`, and a seeded `docs/redesign/` plan dir. The **scripts are the portable trust
layer**; the **codex/** pack is the binding that tells an agent — or the conductor — _when_ to run
them.

---

## The mental model (30 seconds)

A build is decomposed into **phases** (`P0, P1, …`), each holding **work-items** (`W0.1, W4.2, …`).
Items in a phase run **parallel** when their file sets are genuinely disjoint, **serial** when they
aren't — decided **mechanically** by `phase-items`, never by a brief's self-report. Phases are
**merge barriers**: you don't advance until the phase is complete _and_ QA-passed (`phase-guard`).

Four roles, kept separate — **the agent that writes code never certifies it**:

| Role             | Codex binding                                                                     | Never does                     |
| ---------------- | --------------------------------------------------------------------------------- | ------------------------------ |
| **Planner**      | `plan-work-item` skill (interactive session)                                      | implement anything             |
| **Orchestrator** | `codex/drive-phase.mjs` — a script, not a model (skills `run-phase`/`drive-build` wrap it) | write production code |
| **Executor**     | `work-item` skill, spawned as `codex exec` (workspace-write, **no network**)      | advance phases; certify itself |
| **QA**           | `phase-qa` / `qa-verify` skills, spawned as `codex exec` (+network for localhost) | edit production code           |

## How orchestration maps onto Codex

The Claude Code edition drives each phase through a deterministic workflow engine with background
subagents and heartbeat polling. Codex gives that back — differently conducted, same gates:

1. **The conductor is mechanical.** `node codex-workflow-harness/codex/drive-phase.mjs P2` runs
   the per-phase pipeline in plain code: precheck → `phase-items` → one `codex exec` per open item
   (parallel iff file sets are proven disjoint, dispatched in dependency waves) → one whole-repo
   gate with ≤2 fix rounds → QA in a fresh `codex exec` with ≤2 rounds → `phase-guard`. Every
   decision comes from an exit code or the scripts' JSON — the orchestrator cannot be sweet-talked,
   because it cannot read prose.
2. **Role separation is enforced by sandbox policy**, not just prose: executors run
   `--sandbox workspace-write` with **no network** (static self-checks only — the conductor owns
   the dev server and the runtime gate); QA sessions get network solely to drive
   `runtime.web.baseUrl`; the conductor itself is not a model and edits nothing.
3. **Supervision is process-based plus heartbeats.** Executor sessions are awaited with real exit
   codes and a hard per-item timeout; they still write heartbeat JSONs (`subagent-status` trusts
   the file **mtime**, not the self-reported epoch), which feed re-dispatch handoffs — bounded
   recovery (one re-dispatch, then escalate), never a silent retry loop.
4. **Everything is re-entrant.** State lives in the artifacts on disk (checklist ticks, heartbeat
   files, QA reports) — kill the conductor at any point and re-run it; it re-derives where the
   phase stands. The skills carry the same procedures for interactive sessions, and degrade to
   multi-session mode when a sandbox can't spawn children.
5. **Model routing per role** via `harness.config.json` → `codex.models`: pin a heavyweight
   reasoning model for QA and a fast one for executors (empty strings = your `config.toml`
   default). GPT model choice is exactly one string per role.

What does **not** port from Claude Code, by design: PostToolUse editor hooks (executors run the
gate's lint leg instead; `hook-selftest` still proves the hooks bite) and background watchdog
polling (`ScheduleWakeup`) — the conductor's await-with-timeout replaces it.

---

## Install into a project — one command

```bash
git clone <this-repo> ~/codex-workflow-harness            # once per machine
cd ~/my-project
node ~/codex-workflow-harness/install.mjs                 # installs into the current dir
# or: node ~/codex-workflow-harness/install.mjs --target ~/my-project
```

Idempotent — re-run to update. Then: review `harness.config.json` (runner verbs · verifier ·
`source.extensions` · hook selftests), **trust the project in Codex** (so `.codex/config.toml` and
the skills load), `npm i -D playwright-core` if using the `web` verifier, and **walk
`PREFLIGHT.md` once per machine**. Full guide: [INSTALL.md](INSTALL.md).

### Drive a build

```bash
# interactive sessions (Codex CLI or IDE) for the judgment roles:
codex "$init-harness — author and self-test harness.config.json for this app"   # once per app
codex "$plan-work-item — <your feature brief>"                                  # planner → plan files

# then the conductor, from your terminal — one phase per run, human at each barrier:
node codex-workflow-harness/codex/drive-phase.mjs P0
node codex-workflow-harness/codex/drive-phase.mjs --auto          # multi-phase; stops dead at any unguarded barrier
codex "$phase-status"                                             # read-only: where does the build stand?
```

### Quick verify it's wired

```bash
node codex-workflow-harness/codex/drive-phase.mjs --check        # config + codex binary + plan resolve?
node codex-workflow-harness/scripts/hook-selftest.mjs            # are the lint/format hooks alive?
node codex-workflow-harness/scripts/phase-items.mjs P1           # parses your plan? item list + overlap
node codex-workflow-harness/scripts/phase-guard.mjs              # every completed phase has passing QA?
```

---

## The scripts — exit code is the contract

Automate on the exit code; don't parse prose. Run as `node codex-workflow-harness/scripts/<name>.mjs`.

| Script              | What it checks                                                                                       | Exit codes                               |
| ------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `phase-items <Pid>` | the phase's items, file sets, `isUI`, and `parallelizable` computed from **real file-set overlap**   | `0` parsed · `2` setup                   |
| `precheck <id>`     | refuses an illegal dispatch: missing brief, item already `[x]`, unmet deps, unguarded upstream phase | `0` safe · `1` blocked · `2` setup       |
| `run-gate`          | runs `runner.{lint,typecheck,test}` (+`--build`) and the runtime verifier; one structured verdict    | `0` pass · `1` fail · `2` verifier setup |
| `qa-check <report>` | cited screenshots/`path:line` resolve; file-attributed quotes actually appear in the file            | `0` clean · `1` violation · `2` usage    |
| `phase-guard [Pid]` | a phase is done only when **every item is `[x]`** AND its QA report passes `qa-check`                | `0` guarded · `1` unguarded · `2` setup  |
| `subagent-status`   | reads `statusDir/<id>.json` heartbeats by **mtime**; flags stale `running` items as STUCK            | `0` healthy · `1` stuck · `2` malformed  |
| `hook-selftest`     | feeds the lint/format hooks a known-bad fixture; fails if a hook is a dead no-op                     | `0` alive · `1` dead · `2` setup         |

And the edition's own conductor: `node codex-workflow-harness/codex/drive-phase.mjs <Pid> | --auto | --check`
— `0` every phase in range guarded · `1` stopped/escalated · `2` setup.

## The disciplines (they bind every role)

1. **Evidence-or-reject** — every PASS/FIXED/checked-box cites a re-runnable artifact; re-run the detector, don't trust a self-reported verdict.
2. **Quotes are verbatim and sourced** — `qa-check` enforces it mechanically.
3. **Exercise interactive surfaces, don't just load them** — the worst failures hide behind the first click.
4. **No tooling-excuse without a positive control** — a hang is an app failure until proven otherwise.
5. **Keep QA separate from execution** — the agent that wrote the code shares its blind spots.
6. **A phase isn't done because boxes are checked** — it's done when `phase-guard` passes.
7. **Heartbeat or be replaced** — file mtime is the trust anchor; supervision is bounded: stuck → resume once → escalate.
8. **Ground truth overrides self-report for dispatch too** — parallel-safety is real file-set overlap, never a brief's claim.
