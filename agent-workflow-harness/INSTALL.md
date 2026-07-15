# Installing agent-workflow-harness

One command stands the whole harness up in a project: the trust-layer scripts, the Claude Code
skills/agents/workflow, the lint/format hooks, and a config. It's **idempotent** — re-run any time
to update.

- **Prerequisite:** Node ≥ 18 (the scripts are zero-dependency Node).
- **Optional:** `playwright-core` + Chrome, only if you use the `web` runtime verifier.

---

## Quick install (into one project)

From inside the project you want to add the harness to:

```bash
cd /path/to/your-project
node /path/to/agent-workflow-harness/install.mjs
```

…or target it explicitly from anywhere:

```bash
node /path/to/agent-workflow-harness/install.mjs --target /path/to/your-project
```

(Once it's a real repo you can skip the long path — see **Call it from anywhere** below.)

### What it does

| Step                          | Result in `your-project/`                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Vendors the kit               | `agent-workflow-harness/` (scripts, lib, verifiers, hooks, templates, roles)                                              |
| Installs Claude Code bindings | `.claude/skills/` (7), `.claude/agents/` (3), `.claude/workflows/execute-phase.js`                                        |
| Merges editor hooks           | lint/format `PostToolUse` hooks into `.claude/settings.json` (keeps existing settings; no duplicates)                     |
| Writes config                 | `harness.config.json` at the repo root, with **autodetected** runner verbs (pnpm/npm/yarn + Python/Go/Rust/Ruby starters) |
| Seeds the plan dir            | `docs/redesign/` (with `work-phases`/`contracts` templates) + gitignored `docs/redesign/.status/`                         |

Flags: `--target <dir>` (default: cwd) · `--force` (overwrite an existing `harness.config.json`).
The installer refuses to install into itself and never clobbers an existing config without `--force`.

### After install — review `harness.config.json`

The installer gets ~90% there; confirm four fields:

- **`runner.*`** — the autodetected `lint`/`typecheck`/`test`/`build`/`dev` commands match your scripts.
- **`runtime.verifier`** — `"web"` for a browser UI (then fill `runtime.web.routes` with your routes +
  the controls to drive), `"none"` for a library/API/CLI, or a path to a custom adapter
  (see `verifiers/README.md`). **Playwright runs only when `verifier: "web"`.**
- **`source.extensions`** — add your language's extensions if non-JS (`py`, `go`, `rb`, …), or
  `qa-check` silently skips those citations (fail-open).
- **`hooks.{lint,format}`** — your linter/formatter command + a `selftest` fixture it's guaranteed
  to react to.

Then:

```bash
npm i -D playwright-core                                      # only if verifier = "web"
node agent-workflow-harness/scripts/hook-selftest.mjs         # prove the hooks actually bite
```

**Restart Claude Code** so it loads the new skills, agents, and workflow.

### Drive a build (Claude Code)

```
/plan-work-item   <your feature brief>     # Planner → writes work-phases.md, contracts.md, work-item-*.md
/drive-build auto                          # autonomous: phase → gate → QA → barrier → next
#   or /run-phase P1                       # manual, one phase at a time, human at each barrier
```

### Non-Claude-Code use (CI, other harnesses)

You don't need the `.claude/` bindings — call the scripts directly; the exit code is the contract:

```bash
node agent-workflow-harness/scripts/phase-guard.mjs P1
node agent-workflow-harness/scripts/run-gate.mjs --no-runtime
```

---

## Make it its own repo

Right now the harness lives inside another project. Move it to a permanent home and version it:

```bash
mv agent-workflow-harness ~/code/agent-workflow-harness     # out of the host project
cd ~/code/agent-workflow-harness
git init && git add -A && git commit -m "agent-workflow-harness v1"

# optional — publish to GitHub (enables `npx github:…` below):
gh repo create agent-workflow-harness --private --source=. --push
#   …or create the repo on github.com, then:
#   git remote add origin git@github.com:<you>/agent-workflow-harness.git && git push -u origin main
```

It's already repo-ready: `README.md`, `.gitignore`, `package.json` (with a `bin` and a `files`
allowlist), and `INSTALL.md` all travel with it.

---

## Call it from anywhere

Pick one. All three end with you running the installer from any project without typing a long path.

### A. `npx` straight from GitHub — nothing installed globally (recommended)

Once it's pushed to GitHub:

```bash
cd /path/to/any-project
npx github:<you>/agent-workflow-harness
```

`npx` fetches the repo and runs its `bin` (the installer) against your current directory. Pin a
version with a tag or branch: `npx github:<you>/agent-workflow-harness#v1.2`.

### B. Global install — one command name on this machine

```bash
cd ~/code/agent-workflow-harness
npm install -g .          # snapshot; re-run after edits to update
#   …or: npm link         # symlink instead — your repo edits are live, no re-install

# then, from any project:
cd /path/to/any-project
agent-workflow-harness    # = run the installer here
```

### C. Shell alias — no npm at all

Add to `~/.zshrc` / `~/.bashrc`:

```bash
alias awh='node ~/code/agent-workflow-harness/install.mjs'
```

Then: `cd /path/to/any-project && awh`.

---

## Updating an already-installed project

Re-run the installer in the project — it's idempotent and overwrites the vendored kit + bindings
with the current version (your `harness.config.json` and plan files are left untouched):

```bash
cd /path/to/your-project
npx github:<you>/agent-workflow-harness     # or: agent-workflow-harness  /  awh
```

- `npx github:…` always pulls the latest of the default branch (or the tag you pin with `#`).
- `npm install -g .` is a snapshot — re-run it after editing the harness; `npm link` is live.

## Uninstalling from a project

```bash
rm -rf agent-workflow-harness harness.config.json
rm -rf .claude/skills/{plan-work-item,work-item,orchestrate,run-phase,drive-build,phase-qa,polish-qa}
rm -f  .claude/agents/{work-item-executor,phase-qa,phase-qa-verify}.md
rm -f  .claude/workflows/execute-phase.js
# then remove the PostToolUse lint/format hook entry from .claude/settings.json by hand
```
