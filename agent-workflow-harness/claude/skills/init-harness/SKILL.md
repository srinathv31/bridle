---
name: init-harness
description: Stand up (or repair) the harness for ONE app — author a correct harness.config.json and prove it with the trust scripts. Use after copying the kit into a project, when onboarding a new app in a multi-app workspace, or when the config is missing/wrong for the stack (incorrect runner verbs, wrong or missing runtime verifier, unenumerated routes). The deterministic installer does the mechanical 80% (vendor files, install .claude bindings, merge hooks, autodetect a package manager); this skill does the judgment 20% that needs reasoning about an unfamiliar codebase — picking the verifier, correcting the verbs the lockfile lied about, enumerating real routes + controls, wiring auth — and then self-tests until every script exits 0. Output is a committed config, so the reasoning happens once and every run afterward is deterministic again.
---

# Init-harness workflow

Scaffolding a harness has two halves with different natures. The **mechanical half** — vendor the
kit, install the `.claude/` skills/agents/workflow, merge the lint/format hooks, scaffold the plan
dir, guess the package manager — is identical on every project and belongs to the deterministic
installer (`install.mjs`). The **judgment half** — which runtime verifier fits this app, what the
_real_ build verbs are (the lockfile says `pnpm` but is there actually a `typecheck` script?), which
routes and controls are worth driving, how to get past auth — requires reading and reasoning about
_this specific_ codebase. A static installer can't do that part. You can.

This skill is that judgment half. Its single deliverable is a **correct, self-tested
`harness.config.json` for one app**. Because the output is a committed file, you are using the model
once to author a config a human would otherwise hand-tune — you are **not** putting an LLM in the
hot path. Every `run-gate` / `phase-items` / `drive-build` run afterward reads the static file.

The whole point is portability: this must work on a stack you've never seen. Do not assume Next.js,
do not assume `src/app/`, do not assume a test runner exists. **Discover, decide, then prove.**

> Path note: commands below assume the kit is vendored at `agent-workflow-harness/` under the app.
> In a multi-app workspace the kit may live once at the workspace root — adjust the path, and see
> **Multi-app workspaces** at the end for how the scripts find the right per-app config.

## 1. Identify the target and the mechanical base

Settle three things before any judgment:

- **Which app** are you initializing? Take it from the skill argument (e.g. `/init-harness jade-control-panel`) or, absent one, the current working directory. Everything below is scoped to that one app's root.
- **Is the mechanical base already there?** Check the target app for `agent-workflow-harness/` (vendored kit) and `harness.config.json`. If the kit is missing, run the deterministic installer first: `node <path-to-kit>/install.mjs --target <app>`. It vendors the kit, installs the `.claude/` bindings, merges the hooks, autodetects runner verbs, and scaffolds the plan dir. (In a workspace where `.claude/` is already shared at the root, you only need the per-app config + vendored scripts — see the workspace note; you can still run the installer and simply leave the shared `.claude/` as the source of truth.)
- **Does a config already exist?** If `harness.config.json` is present, you are in **repair mode**: read it, validate it against the steps below, and change only the fields that are wrong. Do **not** clobber a working config or an existing `docs/redesign/` plan. If it's absent, you are authoring fresh from `agent-workflow-harness/harness.config.example.json`.

## 2. Recon the app — the judgment input

Read enough to profile the app. This is the same discipline as `plan-work-item`'s codebase pass, aimed at config instead of decomposition. Gather:

- **Package / project manifest** — `package.json` (+ its `scripts`), or `pyproject.toml` / `go.mod` / `Cargo.toml` / `Gemfile`. The lockfile reveals the package manager; the `scripts` block reveals which verbs _actually exist_ (this is where autodetect lies — it will happily write `pnpm typecheck` when there is no `typecheck` script).
- **Framework + runtime-surface type** — classify the app into exactly one: **web UI** (Next/Vite/Remix/etc.), **mobile** (Expo/React Native), **HTTP API/service** (Fastify/Express/FastAPI), **library / types package** (no runtime surface), or **CLI**. This single classification drives the verifier choice.
- **Routing / entrypoints** — for a web app, find the routes (file-router dir or route table). For an API, find the registered endpoints. For a CLI, the binary + commands. You need real paths, not guesses.
- **Auth** — does reaching the app require login? Look for an `auth.md`, a login route, middleware redirects, a seeded test user. A web verifier that ignores auth just tests the login page.
- **Conventions** — `CLAUDE.md`, `AGENTS.md`, existing `.claude/`, any prior `docs/redesign/`. Honor existing file/naming conventions and never overwrite an existing plan.
- **Linter / formatter** — the real commands (`eslint`, `biome`, `ruff`, `prettier`, `gofmt`) and config files present.

Write a 4–6 line profile in the conversation (stack, surface type, package manager, real verbs, auth y/n) before writing the config. If the surface type or auth story is genuinely ambiguous, ask — a wrong verifier choice wastes every later gate run.

## 3. Author each config field — decision rules

Start from the example and set each field deliberately. The schema is `agent-workflow-harness/harness.config.schema.json`; consult it for exact shapes.

**`runner.*` — map to commands that REALLY exist.** For each of `lint`/`typecheck`/`test`/`build`/`dev`, confirm the command resolves against the manifest. If a `typecheck` script is absent, use the toolchain directly (`pnpm exec tsc --noEmit`, `mypy .`, `go vet ./...`). If there is no test framework, set `test: ""` — an empty verb is **skipped** at the gate, which is correct; a bogus verb fails every gate forever. Same for any verb the app genuinely lacks.

**`runtime.verifier` — pick from the surface type:**

| Surface type            | `verifier`                                                                     | Notes                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web UI                  | `"web"`                                                                        | Playwright freeze-canary (built-in). Fill `runtime.web` (below). Needs `playwright-core` + a Chrome channel.                                                                     |
| HTTP API / service      | `"verifiers/api.mjs"`                                                          | Drive endpoints, assert response shape. A ~40-line sketch is in `verifiers/README.md` — write it if absent, then add `runtime.api.{baseUrl,probes}`.                             |
| Mobile (Expo/RN)        | `"verifiers/ios-simulator.mjs"` **if it exists**, else `"none"`                | No browser verifier fits a simulator. If the plugin isn't built yet, set `"none"` and **flag it in the report** as a gap so the user knows freeze-detection is off for this app. |
| Library / types package | `"none"`                                                                       | No runtime surface — static checks (lint/typecheck/test/build) are the whole gate.                                                                                               |
| CLI                     | a `cli` verifier (spawn the binary, assert exit 0 + golden stdout) or `"none"` | Same plugin contract.                                                                                                                                                            |

Never leave a web app on `"none"` to "make the gate pass" — that defeats the freeze-canary. If the right verifier doesn't exist, say so loudly rather than silently downgrading.

**`runtime.uiFilePattern` — what counts as a runtime surface on this stack.** It's a regex over a work-item's file paths; a matching file flips the item to `isUI` and makes the phase gate run the verifier. Point it at this app's runtime-surface files (web pages, screens, route handlers). For a library with no runtime surface, set a pattern that never matches.

**`runtime.web.routes` (web only) — enumerate the real routes and the controls worth driving.** The freeze-canary only catches a freeze on an interaction it actually drives, so for each meaningful route add an `interactions[]` entry per important control: `{label, role, name}` where `role`/`name` feed `getByRole(role, {name})`. **Auth:** if the app is gated, the routes you list will redirect to login unless the verifier authenticates first — note the auth requirement in the report and, once the web verifier supports a login step, wire it (creds via `auth.md`, never hardcoded in the config). Set `runtime.web.baseUrl` and `browserChannel` to match how the app runs.

**`source.dirs` + `source.extensions` — so qa-check recognizes this stack's citations.** This is the porting trap: `qa-check` only validates a QA citation whose path is under one of `source.dirs` and ends in one of `source.extensions`; anything else escapes the evidence check (fail-open). Add this app's source roots and **every language extension you'll cite** (e.g. `swift`, `kt` for mobile; `py` for a Python service). Keep the image extensions for screenshots.

**`hooks.lint` / `hooks.format` — the real linter/formatter + a fixture that trips them.** Set `command` to this app's linter/formatter (with `{file}` substituted). The one irreducibly per-stack value is each hook's `selftest.{filename,content}`: content the linter is **guaranteed to flag** and content the formatter is **guaranteed to rewrite**. Without a real fixture, `hook-selftest` can't prove the hook has teeth.

**`planDir` / `statusDir` / `ids` / `gate.blockOn` / `report.*`** — defaults (`docs/redesign`, `docs/redesign/.status`, `W<n>.<m>`→`P<n>`, block on `critical`+`major`) fit most projects. Change `ids` only if the app already uses a different work-item scheme; reconcile `planDir` with any existing plan rather than creating a second one.

## 4. Self-test until green — the proof

A config you didn't run is a guess. Run the trust scripts against the freshly written config and iterate until each exits as expected. Run them **from within the target app** (so `loadConfig` resolves this app's config — see the workspace note) or with `HARNESS_CONFIG=<app>/harness.config.json` set.

1. `node agent-workflow-harness/scripts/hook-selftest.mjs` — **exit 0**. Proves both hooks fire and bite. Exit 1 means a hook is toothless (fix the `selftest` fixture or the hook command); exit 2 is a setup error.
2. `node agent-workflow-harness/scripts/run-gate.mjs --no-runtime` — **exit 0**. Proves every configured `runner` verb resolves and passes on the current tree. Use `--no-runtime` first so a not-yet-running dev server doesn't mask a verb error. A failure here is almost always a wrong/bogus verb — fix `runner.*` and re-run.
3. If a plan already exists: `node agent-workflow-harness/scripts/phase-items.mjs <phaseId>` — **exit 0** with sane JSON (right items, file sets parsed, overlaps computed). Proves `ids`/`planDir`/`uiFilePattern` parse this app's plan. If `items[].files` come back empty or the phase is misread, the id scheme or plan path is wrong.
4. Verifier reachability: confirm the chosen verifier _loads_. For `web`, ensure `playwright-core` is installed and `node agent-workflow-harness/verifiers/web.mjs` runs (with the dev server up for a full PASS; with it down, a `SETUP` return is the expected "couldn't reach the app", which still proves the verifier resolves). For a custom plugin path, confirm the file exists and exports `verify(cfg)`.

Cite each command and its exit code as you go. Do not declare done until 1, 2, and (if a plan exists) 3 are green and the verifier resolves.

## 5. Report and hand off

Tell the user, concisely:

- The **profile** you detected (stack, surface type, package manager).
- Every **non-obvious field** you set and why — especially verb corrections (`test: ""`, `typecheck` via toolchain), the verifier choice, and the routes you enumerated.
- The **self-test results** — the commands run and their exit codes (the proof the config is real).
- What **needs the human**: auth credentials/flow, any ephemeral design-source path, and any **verifier gap** you downgraded to `"none"` (e.g. mobile with no `ios-simulator` verifier yet) so freeze-detection is knowingly off until that plugin is built.
- The **next command**: `/plan-work-item <brief>` to decompose work, or `/drive-build auto` (or `/run-phase <id>`) if a plan already exists.

Do not plan, implement, or drive a build yourself — author the config, prove it, hand off.

## Multi-app workspaces

If you open Claude at a workspace root that holds several independent apps and keep one **shared
`.claude/`** there (skills/agents/workflow are app-agnostic, and you want full-platform context),
the model is: **shared `.claude/` at the workspace root + one `harness.config.json` inside each
app.** Only the config is per-app — the verbs and the verifier genuinely differ between, say, a web
CMS and a mobile app, and one file can't hold contradictory verb sets.

The scripts find the right config by walking up from the current directory (or via the
`HARNESS_CONFIG` env var). So: **run and drive each app from inside that app's directory**, or set
`HARNESS_CONFIG=<app>/harness.config.json` for the run. Do **not** place a `harness.config.json` at
the workspace root — it would shadow every app whenever cwd is the root. Invoke this skill once per
app to author each per-app config; the shared bindings are installed only once.

## What this skill does not cover

- **Writing a verifier plugin that doesn't exist yet** (e.g. `ios-simulator`, `api`, `cli`). This skill _selects_ the verifier and flags the gap; building the adapter against the `verify(cfg)` contract in `verifiers/README.md` is separate work.
- **Planning work-items** — that's `plan-work-item`.
- **Implementing or driving a build** — that's `work-item` / `run-phase` / `drive-build`.
- **Changing app code** — this skill only writes `harness.config.json` (and, in repair mode, fixes the config); it never touches production source.
