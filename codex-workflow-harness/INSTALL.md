# Installing codex-workflow-harness

One command stands the whole harness up in a project: the trust-layer scripts, the deterministic
conductor, the repo-scoped Codex skills, the `AGENTS.md` block, the project Codex config, and a
harness config. **Idempotent** — re-run any time to update.

- **Prerequisites:** Node ≥ 18 · the Codex CLI (`codex`) signed in — a 2026 build with skills
  support (`.agents/skills/`) and `codex exec`. The Codex IDE extension is optional, for driving
  the interactive roles from your editor.
- **Optional:** `playwright-core` + Chrome, only if you use the `web` runtime verifier.
- **Not needed:** MCP servers, cloud/background Codex agents, GitHub Actions. (A Playwright MCP
  server enriches QA's interactive checks if you configure one, but nothing depends on it.)

## Quick install (into one project)

```bash
cd /path/to/your-project
node /path/to/codex-workflow-harness/install.mjs
# or, from anywhere:
node /path/to/codex-workflow-harness/install.mjs --target /path/to/your-project
```

### What it does

| Step                    | Result in `your-project/`                                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Vendors the kit         | `codex-workflow-harness/` (scripts, lib, verifiers, hooks, templates, roles, PREFLIGHT, and `codex/drive-phase.mjs` — the conductor)   |
| Installs Codex skills   | `.agents/skills/` (8 skills — repo-scoped and version-controlled; Codex discovers them natively)                                       |
| Merges instructions     | a marker-managed harness block into `AGENTS.md` (creates the file if absent)                                                           |
| Writes Codex config     | `.codex/config.toml` — workspace-write sandbox, on-request approvals, no-network children (side-file fallback if you already have one) |
| Writes config           | `harness.config.json` at the repo root, with **autodetected** runner verbs (pnpm/npm/yarn + Python/Go/Rust/Ruby starters)              |
| Seeds the plan dir      | `docs/redesign/` (with `work-phases`/`contracts` templates) + gitignored `docs/redesign/.status/`                                      |

Flags: `--target <dir>` (default: cwd) · `--force` (overwrite an existing `harness.config.json`).
The installer refuses to install into itself and never clobbers an existing config without `--force`.

### After install — four checks

1. **Trust the project in Codex** (it prompts the first time you run `codex` in the repo, or set
   `projects."<abs path>".trust_level = "trusted"` in `~/.codex/config.toml`). Untrusted projects
   skip `.codex/config.toml` entirely — nothing else works right until this is done.
2. **Review `harness.config.json`** — the installer gets ~90% there; confirm:
   - `runner.*` — the autodetected `lint`/`typecheck`/`test`/`build`/`dev` commands really exist.
   - `runtime.verifier` — `"web"` for a browser UI (fill `runtime.web.routes` with routes + the
     controls to drive), `"none"` for a library/API/CLI, or a custom adapter (`verifiers/README.md`).
   - `source.extensions` — add your language's extensions or `qa-check` silently skips those
     citations (fail-open).
   - `hooks.{lint,format}` — your linter/formatter command + a selftest fixture each is guaranteed
     to react to.
   - `codex.models` (optional) — route executors and QA to different models; empty = your
     `config.toml` default.
     Better: let the agent do this judgment pass — run the **`init-harness`** skill in a Codex
     session; it authors the config and proves it with the trust scripts.
3. `npm i -D playwright-core` if `verifier: "web"`, then
   `node codex-workflow-harness/scripts/hook-selftest.mjs` to prove the hooks bite, and
   `node codex-workflow-harness/codex/drive-phase.mjs --check` to prove the conductor resolves.
4. **Walk `codex-workflow-harness/PREFLIGHT.md`** — once per machine. It validates the Codex side:
   skills visible, `codex exec` works headless, sandbox/network behavior matches what the
   conductor assumes, model names valid for your plan. This is the step that surfaces environment
   surprises **before** they cost you a build.

### Drive a build

```bash
codex "$init-harness — author and self-test harness.config.json"   # once per app
codex "$plan-work-item — <your feature brief>"                     # planner → work-phases.md, contracts.md, work-item-*.md

node codex-workflow-harness/codex/drive-phase.mjs P0               # one phase, human at the barrier
node codex-workflow-harness/codex/drive-phase.mjs --auto           # multi-phase; stops dead at any failure
codex "$phase-status"                                              # read-only: where does the build stand?
```

Manual dispatch (no conductor): run the `work-item` skill in one fresh Codex session per item
(side by side for parallel items), then `phase-qa` in its own session, and check the barrier with
`node codex-workflow-harness/scripts/phase-guard.mjs <Pid>`.

### Non-Codex use (CI, other harnesses)

The bindings are optional — call the scripts directly; the exit code is the contract:

```bash
node codex-workflow-harness/scripts/phase-guard.mjs P1
node codex-workflow-harness/scripts/run-gate.mjs --no-runtime
```

The conductor also runs fine from CI (it needs `codex` on PATH and auth via your org's setup):
`node codex-workflow-harness/codex/drive-phase.mjs --auto` exits non-zero the moment any phase
can't be guarded.

---

## Getting it onto a locked-down machine

The kit is self-contained, zero-dependency Node — a folder copy is a full install of the kit repo:

- **Git remote allowed:** push this repo to your internal Git host, clone it on the target machine.
- **No remote:** zip the folder (`zip -r cxh.zip codex-workflow-harness -x "*/node_modules/*"`),
  transfer by whatever channel is sanctioned, unzip, run `install.mjs`. Nothing phones home except
  `codex` itself; `playwright-core` is the only (optional) npm dependency, needed only on projects
  using the web verifier.

## Make it its own repo / call it from anywhere

```bash
mv codex-workflow-harness ~/code/codex-workflow-harness
cd ~/code/codex-workflow-harness
git init && git add -A && git commit -m "codex-workflow-harness v1"
```

Then either `npx github:<you>/codex-workflow-harness` from any project (after pushing; the
`bin` runs the installer), `npm install -g .` for a global command, or a shell alias:
`alias cxh='node ~/code/codex-workflow-harness/install.mjs'`.

## Updating an already-installed project

Re-run the installer — idempotent; it overwrites the vendored kit + `.agents/skills/` and
refreshes the managed `AGENTS.md` block, leaving `harness.config.json`, your plan files,
`.codex/config.toml`, and everything else untouched.

## Uninstalling from a project

```bash
rm -rf codex-workflow-harness harness.config.json
rm -rf .agents/skills/{init-harness,plan-work-item,run-phase,work-item,phase-qa,qa-verify,drive-build,phase-status}
rm -f  .codex/config.toml            # if the harness wrote it (check for the harness header first)
# then delete the marker-delimited harness block from AGENTS.md
```
