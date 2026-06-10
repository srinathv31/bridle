# bridle

_The gear that lets you steer a powerful animal._

A portable trust layer for **multi-agent AI builds** — it makes a fleet of coding agents produce
verifiable work instead of plausible-sounding work, by putting a **mechanical detector behind every
claim**. One repo, two editions over the **same trust core**:

| Edition                                                  | Binds to                                                                                                                                                                    | Use it when                                                              |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [`agent-workflow-harness/`](agent-workflow-harness/)     | **Claude Code** — skills, agents, the deterministic `execute-phase` Workflow engine, PostToolUse hooks                                                                      | Claude Code is your coding agent                             |
| [`copilot-workflow-harness/`](copilot-workflow-harness/) | **GitHub Copilot Chat in VS Code, IDE-only** — custom agents, prompt files, managed `copilot-instructions.md` block, auto-approve settings. No Copilot CLI, no cloud agents | GitHub Copilot Chat in VS Code is your coding agent |

The trust core — plain zero-dependency Node scripts (`phase-items`, `precheck`, `run-gate`,
`qa-check`, `phase-guard`, `subagent-status`, `hook-selftest`), the pluggable runtime verifiers,
`harness.config.json`, and the plan-file formats — is **identical** in both editions. Exit code is
the contract. Plans authored under one edition run under the other.

> If you read one thing: **every quality gate has at least one detector that does not share the
> subject's failure mode.** "Rendered" ≠ "alive." "Reported" ≠ "true." A claim without a
> re-runnable artifact is a hypothesis — including claims made by QA agents and the orchestrator.

## Install into a project

Clone this repo once, then run the edition's installer against any target project (both are
idempotent — re-run to update):

```bash
git clone https://github.com/srinathv31/bridle.git ~/code/bridle

cd /path/to/your-project
node ~/code/bridle/agent-workflow-harness/install.mjs     # Claude Code edition
# or
node ~/code/bridle/copilot-workflow-harness/install.mjs   # Copilot IDE edition
```

Then follow the edition's own docs:

- **Claude Code:** [`agent-workflow-harness/README.md`](agent-workflow-harness/README.md) ·
  [`INSTALL.md`](agent-workflow-harness/INSTALL.md). Drive with `/plan-work-item …` →
  `/drive-build auto` (or `/run-phase P1`).
- **Copilot:** [`copilot-workflow-harness/README.md`](copilot-workflow-harness/README.md) ·
  [`INSTALL.md`](copilot-workflow-harness/INSTALL.md) · **walk
  [`PREFLIGHT.md`](copilot-workflow-harness/PREFLIGHT.md) once per machine** — it validates the
  Copilot side (agents/prompts visible, model + tool names match your build, auto-approve works)
  before anything can fail silently. Drive with `/init-harness` → `/plan-work-item …` →
  `/run-phase P0`.

Note: each edition's INSTALL.md also describes running it as a standalone repo (`npx github:…`).
Those `npx` one-liners assume the kit is the repo **root** — from this combined repo, use the
`node …/install.mjs` form above, or split an edition into its own repo if you want `npx`.

## Layout

```
bridle/
  agent-workflow-harness/      # Claude Code edition  = trust core + claude/ binding pack
  copilot-workflow-harness/    # Copilot IDE edition  = trust core + github/ + vscode/ binding packs
```

Each edition is self-contained (the core is vendored into both on purpose — a folder copy of either
is a full install source). The only npm dependency anywhere is the optional `playwright-core`,
needed solely by the `web` runtime verifier.
