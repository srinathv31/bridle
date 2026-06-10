# Installing copilot-workflow-harness

One command stands the whole harness up in a project: the trust-layer scripts, the Copilot custom
agents and prompt files, the instructions block, the VS Code settings, and a config. **Idempotent**
— re-run any time to update.

- **Prerequisites:** Node ≥ 18 · VS Code with the GitHub Copilot Chat extension (a 2026 build —
  custom agents and prompt files must be available) · a Copilot plan whose model picker includes
  the models you'll pin (the shipped frontmatter assumes **Claude Opus 4.7** and **GPT-5.5**).
- **Optional:** `playwright-core` + Chrome, only if you use the `web` runtime verifier.
- **Not needed:** Copilot CLI, cloud/coding agents, GitHub Actions, MCP servers. (A Playwright MCP
  server enriches QA's interactive checks if your org allows MCP, but nothing depends on it.)

## Quick install (into one project)

```bash
cd /path/to/your-project
node /path/to/copilot-workflow-harness/install.mjs
# or, from anywhere:
node /path/to/copilot-workflow-harness/install.mjs --target /path/to/your-project
```

### What it does

| Step                      | Result in `your-project/`                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Vendors the kit           | `copilot-workflow-harness/` (scripts, lib, verifiers, hooks, templates, roles, PREFLIGHT)                                                                                                  |
| Installs Copilot bindings | `.github/agents/` (5 custom agents) + `.github/prompts/` (8 slash-command prompt files)                                                                                                    |
| Merges instructions       | a marker-managed harness block into `.github/copilot-instructions.md` (creates the file if absent)                                                                                         |
| Merges VS Code settings   | terminal auto-approve allowlist for the trust scripts, edits auto-approve for the plan dir, `chat.agent.maxRequests` — into `.vscode/settings.json` (side-file fallback if yours is JSONC) |
| Writes config             | `harness.config.json` at the repo root, with **autodetected** runner verbs (pnpm/npm/yarn + Python/Go/Rust/Ruby starters)                                                                  |
| Seeds the plan dir        | `docs/redesign/` (with `work-phases`/`contracts` templates) + gitignored `docs/redesign/.status/`                                                                                          |

Flags: `--target <dir>` (default: cwd) · `--force` (overwrite an existing `harness.config.json`).
The installer refuses to install into itself and never clobbers an existing config without `--force`.

### After install — three checks

1. **Review `harness.config.json`** — the installer gets ~90% there; confirm:
   - `runner.*` — the autodetected `lint`/`typecheck`/`test`/`build`/`dev` commands really exist.
   - `runtime.verifier` — `"web"` for a browser UI (fill `runtime.web.routes` with routes + the
     controls to drive), `"none"` for a library/API/CLI, or a custom adapter (`verifiers/README.md`).
   - `source.extensions` — add your language's extensions or `qa-check` silently skips those
     citations (fail-open).
   - `hooks.{lint,format}` — your linter/formatter command + a selftest fixture each is guaranteed
     to react to.
     Better: let the agent do this judgment pass — run **`/init-harness`** in Copilot Chat; it
     authors the config and proves it with the trust scripts.
2. `npm i -D playwright-core` if `verifier: "web"`, then
   `node copilot-workflow-harness/scripts/hook-selftest.mjs` to prove the hooks bite.
3. **Walk `copilot-workflow-harness/PREFLIGHT.md`** — once per machine. It validates the Copilot
   side: agents visible in the picker, prompts resolve as slash commands, model names match your
   picker, terminal auto-approve actually auto-approves, subagent delegation available or the
   multi-session fallback understood. This is the step that surfaces
   org-policy surprises **before** they cost you a build.

Then **reload VS Code** so it picks up `.github/agents/`, `.github/prompts/`, and the settings.

### Drive a build (Copilot Chat)

```
/init-harness                          # once per app — author + self-test the config
/plan-work-item <your feature brief>   # planner → work-phases.md, contracts.md, work-item-*.md
/run-phase P0                          # one phase per fresh chat session, human at each barrier
/phase-status                          # read-only: where does the build stand?
# /drive-build auto                    # multi-phase in one session — small builds only
```

### Non-Copilot use (CI, other harnesses)

The bindings are optional — call the scripts directly; the exit code is the contract:

```bash
node copilot-workflow-harness/scripts/phase-guard.mjs P1
node copilot-workflow-harness/scripts/run-gate.mjs --no-runtime
```

---

## Getting it onto a locked-down machine

The kit is self-contained, zero-dependency Node — a folder copy is a full install of the kit repo:

- **Git remote allowed:** push this repo to your internal Git host, clone it on the target machine.
- **No remote:** zip the folder (`zip -r cwh.zip copilot-workflow-harness -x "*/node_modules/*"`),
  transfer by whatever channel is sanctioned, unzip, run `install.mjs`. Nothing phones home;
  `playwright-core` is the only (optional) npm dependency, needed only on projects using the web
  verifier.

## Make it its own repo / call it from anywhere

```bash
mv copilot-workflow-harness ~/code/copilot-workflow-harness
cd ~/code/copilot-workflow-harness
git init && git add -A && git commit -m "copilot-workflow-harness v1"
```

Then either `npx github:<you>/copilot-workflow-harness` from any project (after pushing; the
`bin` runs the installer), `npm install -g .` for a global command, or a shell alias:
`alias cwh='node ~/code/copilot-workflow-harness/install.mjs'`.

## Updating an already-installed project

Re-run the installer — idempotent; it overwrites the vendored kit + `.github/` bindings and
refreshes the managed instructions block, leaving `harness.config.json`, your plan files, and your
other settings untouched.

## Uninstalling from a project

```bash
rm -rf copilot-workflow-harness harness.config.json
rm -f  .github/agents/{harness-planner,harness-orchestrator,work-item-executor,phase-qa,phase-qa-verify}.agent.md
rm -f  .github/prompts/{plan-work-item,run-phase,drive-build,work-item,phase-qa,qa-verify,init-harness,phase-status}.prompt.md
# then delete the marker-delimited harness block from .github/copilot-instructions.md
# and remove the harness entries from .vscode/settings.json by hand
```
