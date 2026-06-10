# copilot-workflow-harness

A portable trust layer for **multi-agent builds**, packaged as its own repo you reuse across
projects — this is the **GitHub Copilot Chat (IDE-only)** edition of `agent-workflow-harness`.
It makes AI coding agents produce verifiable work instead of plausible-sounding work, by putting
a **mechanical detector behind every claim** — and it stands up in any repo with **one command**.

**Targets Copilot Chat in VS Code. Nothing else.** No Copilot CLI, no cloud coding agent, no
GitHub Actions dependency — built for locked-down work machines where the IDE chat is the only
agent surface you're allowed. The trust layer underneath (plain Node scripts) is runtime-neutral
and identical to the Claude Code edition; only the binding pack differs.

> If you read one thing: **every quality gate here has at least one detector that does not share
> the subject's failure mode.** "Rendered" ≠ "alive." "Reported" ≠ "true." A claim without a
> re-runnable artifact is a hypothesis — including claims made by QA agents and by the
> orchestrator itself.

The kit is the generalized form of a harness built around a real failure: a multi-agent build
shipped a page that **froze the instant you opened a filter**, while every signal the agents read
(DOM rendered, 0 console errors, clean build, 200s) said PASS. Two backbones came out of it:

- **Backbone A — runtime truth.** The **runtime verifier** (pluggable; `web` = a freeze-canary
  that drives every control and re-probes the main thread out-of-band). Plain Node +
  `playwright-core` — it does **not** need an MCP server, so it survives MCP-blocking org policy.
- **Backbone B — agent-claim truth.** **`qa-check`** greps every cited quote/artifact in a QA
  report against ground truth, and **`phase-guard`** won't call a phase done until a QA report
  exists that itself passes `qa-check`.

---

## What's in the box

```
copilot-workflow-harness/        # this repo — clone once, reuse everywhere
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
  github/                        # the Copilot binding pack → installed into <target>/.github/
    agents/    harness-planner · harness-orchestrator · work-item-executor · phase-qa · phase-qa-verify
    prompts/   /plan-work-item · /run-phase · /drive-build · /work-item · /phase-qa · /qa-verify · /init-harness · /phase-status
    copilot-instructions.harness.md   # managed block merged into .github/copilot-instructions.md
  vscode/settings.harness.json   # terminal/edits auto-approve allowlist + maxRequests, merged into .vscode/settings.json
  PREFLIGHT.md                   # first-run validation checklist for a locked-down machine
```

After install, the **target project** gets: `copilot-workflow-harness/` (the vendored kit),
`harness.config.json`, `.github/agents/` (5) + `.github/prompts/` (8), the managed block in
`.github/copilot-instructions.md`, merged `.vscode/settings.json`, and a seeded `docs/redesign/`
plan dir. The **scripts are the portable trust layer**; the **github/** pack is the Copilot
binding that tells an agent _when_ to run them.

---

## The mental model (30 seconds)

A build is decomposed into **phases** (`P0, P1, …`), each holding **work-items** (`W0.1, W4.2, …`).
Items in a phase run **parallel** when their file sets are genuinely disjoint, **serial** when they
aren't — decided **mechanically** by `phase-items`, never by a brief's self-report. Phases are
**merge barriers**: you don't advance until the phase is complete _and_ QA-passed (`phase-guard`).

Four roles, kept separate — **the agent that writes code never certifies it**:

| Role             | Copilot binding                                                             | Never does                     |
| ---------------- | --------------------------------------------------------------------------- | ------------------------------ |
| **Planner**      | `harness-planner` agent · `/plan-work-item`                                 | implement anything             |
| **Orchestrator** | `harness-orchestrator` · `/run-phase`, `/drive-build` (no edit tool at all) | write production code          |
| **Executor**     | `work-item-executor` · `/work-item`                                         | advance phases; certify itself |
| **QA**           | `phase-qa` / `phase-qa-verify` · `/phase-qa`, `/qa-verify`                  | edit production code           |

## How orchestration maps onto IDE-only Copilot

The Claude Code edition drives each phase through a deterministic workflow engine with background
subagents and heartbeat polling. Copilot Chat has none of that, so the same pipeline is bound
differently — same gates, different conductor mechanics:

1. **The per-phase pipeline is a re-entrant prompt** (`/run-phase`): precheck → `phase-items` →
   dispatch → one whole-repo gate → QA → `phase-guard` → stop at the barrier. _Re-entrant_ means
   every step re-derives where the phase stands from the artifacts on disk — re-invoke
   `/run-phase P2` after any interruption (compaction, a manual detour, a closed window) and it
   continues instead of restarting. The scripts' exit codes, not the conversation, carry the state.
2. **Fan-out uses Copilot subagents** (the orchestrator delegates each work-item / QA pass to a
   subagent running the right custom agent). Where subagent delegation is unavailable or blocked
   by policy, the orchestrator degrades to **multi-session mode**: it prints the exact
   `/work-item W2.x` commands to run in separate chat sessions (side by side for parallel items),
   you run them, then re-invoke `/run-phase` to continue. QA always gets its own session.
3. **Supervision is checkpoint-based, not polling-based.** Executors still write heartbeat JSONs
   (`subagent-status` trusts the file **mtime**, not the self-reported epoch); the orchestrator
   checks them at each return and at every re-entry, with bounded recovery (one re-dispatch, then
   escalate).
4. **Role separation is enforced by agent tool policy**, not just prose: the orchestrator has no
   edit tool; QA agents are read-only on production code by hard instruction, with an
   edits-auto-approve glob that keeps any file write outside `docs/redesign/` behind a manual prompt.
5. **Model routing** uses your unlimited pool: Claude Opus 4.7 for the judgment roles (planner,
   orchestrator, thorough QA), GPT-5.5 for the mechanical ones (executor, verify QA). Pinned per
   agent in frontmatter — adjust to your picker's exact names (see PREFLIGHT.md).

What does **not** port from Claude Code, by design: the deterministic Workflow engine (the loop is
prose + exit codes now), background watchdog polling (`ScheduleWakeup`), and editor-hook live lint
on every edit (executors run the gate's lint leg instead; VS Code agent hooks exist in preview if
you want to wire `hooks/` up later — see PREFLIGHT.md).

---

## Install into a project — one command

```bash
git clone <this-repo> ~/copilot-workflow-harness        # once per machine
cd ~/my-project
node ~/copilot-workflow-harness/install.mjs              # installs into the current dir
# or: node ~/copilot-workflow-harness/install.mjs --target ~/my-project
```

Idempotent — re-run to update. Then: review `harness.config.json` (runner verbs · verifier ·
`source.extensions` · hook selftests), `npm i -D playwright-core` if using the `web` verifier,
**walk `PREFLIGHT.md` once per machine**, and reload VS Code. Full guide: [INSTALL.md](INSTALL.md).

### Drive a build (Copilot Chat in VS Code)

```
/init-harness                       # once per app: author + self-test harness.config.json
/plan-work-item <your feature brief>   # planner → produces the plan files
/run-phase P0                       # build one phase, stop at the barrier (fresh session per phase)
/phase-status                       # where does the build stand?
# or /drive-build auto              # multi-phase in one session — small builds only
```

### Quick verify it's wired

```bash
node copilot-workflow-harness/scripts/hook-selftest.mjs      # are the lint/format hooks alive?
node copilot-workflow-harness/scripts/phase-items.mjs P1     # parses your plan? item list + overlap
node copilot-workflow-harness/scripts/phase-guard.mjs        # every completed phase has passing QA?
```

---

## The scripts — exit code is the contract

Automate on the exit code; don't parse prose. Run as `node copilot-workflow-harness/scripts/<name>.mjs`.

| Script              | What it checks                                                                                       | Exit codes                               |
| ------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `phase-items <Pid>` | the phase's items, file sets, `isUI`, and `parallelizable` computed from **real file-set overlap**   | `0` parsed · `2` setup                   |
| `precheck <id>`     | refuses an illegal dispatch: missing brief, item already `[x]`, unmet deps, unguarded upstream phase | `0` safe · `1` blocked · `2` setup       |
| `run-gate`          | runs `runner.{lint,typecheck,test}` (+`--build`) and the runtime verifier; one structured verdict    | `0` pass · `1` fail · `2` verifier setup |
| `qa-check <report>` | cited screenshots/`path:line` resolve; file-attributed quotes actually appear in the file            | `0` clean · `1` violation · `2` usage    |
| `phase-guard [Pid]` | a phase is done only when every item is `[x]` **and** its QA report passes `qa-check`                | `0` guarded · `1` unguarded · `2` setup  |
| `subagent-status`   | reads `statusDir/<id>.json` heartbeats by **mtime**; flags stale `running` items as STUCK            | `0` healthy · `1` stuck · `2` malformed  |
| `hook-selftest`     | feeds the lint/format hooks a known-bad fixture; fails if a hook is a dead no-op                     | `0` alive · `1` dead · `2` setup         |

## The disciplines (they bind every role)

1. **Evidence-or-reject** — every PASS/FIXED/checked-box cites a re-runnable artifact; re-run the detector, don't trust a self-reported verdict.
2. **Quotes are verbatim and sourced** — `qa-check` enforces it mechanically.
3. **Exercise interactive surfaces, don't just load them** — the worst failures hide behind the first click.
4. **No tooling-excuse without a positive control** — a hang is an app failure until proven otherwise.
5. **Keep QA separate from execution** — the agent that wrote the code shares its blind spots.
6. **A phase isn't done because boxes are checked** — it's done when `phase-guard` passes.
7. **Heartbeat or be replaced** — file mtime is the trust anchor; supervision is bounded: stuck → resume once → escalate.
8. **Ground truth overrides self-report for dispatch too** — parallel-safety is real file-set overlap, never a brief's claim.
