---
name: init-harness
description: Stand up (or repair) the build/QA harness for THIS app — author a correct harness.config.json and prove it with the trust scripts. The judgment half the deterministic installer can't do. Use once per app after install.mjs, or to repair a broken config.
---

# init-harness — author and prove the config

Author a **correct, self-tested `harness.config.json`** for this app. The installer (`install.mjs`) already did the mechanical 80% — vendored the kit, installed the `.agents/skills/` bindings, autodetected a package manager. You do the judgment 20% that needs reading this specific codebase. You only write `harness.config.json` (and fix it in repair mode); never production code. The schema is `codex-workflow-harness/harness.config.schema.json`; start from `harness.config.example.json` if authoring fresh, repair-in-place if one exists (never clobber a working config or an existing plan dir).

## 1. Recon the app

Manifest + scripts block (autodetect lies: it happily writes `pnpm typecheck` when no such script exists) · framework and **runtime-surface type** (web UI / HTTP API / library / CLI / mobile) · real routes or entrypoints · auth story · linter/formatter actually configured. Post a 4–6 line profile before writing the config; ask if surface type or auth is genuinely ambiguous.

## 2. Author each field deliberately

- **`runner.*`** — commands that REALLY exist. No `typecheck` script → use the toolchain directly (`pnpm exec tsc --noEmit`, `mypy .`, `go vet ./...`). No test framework → `test: ""` (an empty verb is skipped at the gate; a bogus verb fails every gate forever).
- **`runtime.verifier`** — by surface type: web UI → `"web"` (fill `runtime.web.{baseUrl,browserChannel,routes}`; each route's real interactive controls as `{label, role, name}` — the freeze-canary only catches a freeze on an interaction it drives). API → a custom `verifiers/api.mjs` adapter (sketch in `verifiers/README.md`). Library/CLI with no surface → `"none"`. **Never leave a web app on `"none"` to make the gate pass** — flag a missing verifier loudly instead of silently downgrading.
- **`runtime.uiFilePattern`** — regex over work-item file paths that marks an item `isUI` (so the phase gate runs the verifier).
- **`source.dirs` / `source.extensions`** — the porting trap: `qa-check` only validates citations under these dirs with these extensions (fail-open otherwise). Add every language extension you'll cite.
- **`hooks.lint` / `hooks.format`** — the real linter/formatter command, plus a `selftest` fixture each is **guaranteed** to react to.
- **`planDir` / `statusDir` / `ids` / `gate.blockOn`** — defaults fit most projects; reconcile with any existing plan dir rather than creating a second one.
- **`codex.*`** (this edition's optional block, read by the conductor) — `models.executor` / `models.qa` to route roles to different models (empty = your `config.toml` default), `sandbox` (default `workspace-write`), `itemTimeoutMinutes`. Leave it out entirely to take the defaults.

## 3. Self-test until green — a config you didn't run is a guess

1. `node codex-workflow-harness/scripts/hook-selftest.mjs` → exit 0 (hooks bite).
2. `node codex-workflow-harness/scripts/run-gate.mjs --no-runtime` → exit 0 (every verb resolves and passes).
3. If a plan exists: `node codex-workflow-harness/scripts/phase-items.mjs <Pid>` → exit 0 with sane JSON.
4. Verifier loads: for `web`, `playwright-core` installed and `node codex-workflow-harness/verifiers/web.mjs` runs (a `SETUP` verdict with the dev server down still proves it resolves).
5. Conductor resolves: `node codex-workflow-harness/codex/drive-phase.mjs --check` → exit 0 (finds the config, finds the `codex` binary, plan dir readable).

Cite each command and exit code. Not done until all are green.

## 4. Report

The profile · every non-obvious field and why (verb corrections, verifier choice, routes enumerated) · the self-test evidence · what needs the human (auth creds, any verifier gap knowingly left at `"none"`) · next step: the `plan-work-item` skill with a brief, or `node codex-workflow-harness/codex/drive-phase.mjs <Pid>` if a plan exists.

Multi-app workspace note: one shared binding set, one `harness.config.json` **inside each app** — the scripts resolve the nearest config walking up from the working directory (or `HARNESS_CONFIG=<path>`). Never put a config at the workspace root where it would shadow every app.
