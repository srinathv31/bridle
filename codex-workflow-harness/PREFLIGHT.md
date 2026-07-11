# PREFLIGHT — validate the harness on THIS machine (once)

Codex's customization surface (skills, project config, exec flags) moved fast through 2025–26 and
machines pin old builds or restrict features by policy. This checklist takes ~10 minutes, needs no
real project work, and surfaces every environment problem **before** it costs you a build. Run it
top to bottom on each new machine (and after major Codex updates). Each item says what to do if it
fails — the harness has a designed fallback for every soft failure.

## 1. Versions and feature availability

- [ ] `codex --version` runs and you're signed in (`codex login` status). Skills
      (`.agents/skills/`) and `codex exec` ship in 2026 builds; if yours predates them, update —
      there is no harness without them. (Custom prompts in `~/.codex/prompts/` are the deprecated
      predecessor of skills; this kit doesn't use them.)
- [ ] **Trust the project.** Run `codex` once in the repo and accept the trust prompt (or set
      `projects."<abs path>".trust_level = "trusted"` in `~/.codex/config.toml`). Untrusted
      projects skip `.codex/config.toml` — sandbox and approval defaults silently won't apply.
- [ ] **Skills are visible.** In a Codex session, run `/skills` — the eight harness skills
      (`init-harness`, `plan-work-item`, `run-phase`, `work-item`, `phase-qa`, `qa-verify`,
      `drive-build`, `phase-status`) should list. If not: check `.agents/skills/*/SKILL.md`
      landed, restart the session, and confirm your build reads repo-scoped skills (some builds
      gate skill discovery behind a feature flag — check `codex features` / release notes).
- [ ] **Explicit invocation works.** `codex "$phase-status"` (the `$` mention form) should load
      the skill and run the read-only sweep. If your build's mention syntax differs, note the
      working form — the conductor doesn't depend on it (it names the skill file path in its
      prompts), but your interactive muscle memory does.

## 2. Headless exec — what the conductor stands on

- [ ] `codex exec --sandbox workspace-write "create a file preflight-echo.txt containing ok, then stop"`
      completes without an approval prompt and the file exists. Delete it after. If exec prompts
      or refuses: check org policy on non-interactive runs; the harness cannot conduct without a
      working `codex exec`.
- [ ] **Sandbox blocks network by default.** `codex exec --sandbox workspace-write "curl -sS -m 5 https://example.com and report the exit code"`
      should FAIL to reach the network. That failure is correct — executors are designed to run
      static checks only. If your machine-level config force-enables network, executors will
      still behave (the skill forbids dev servers), but note the drift.
- [ ] **The QA network override works.** `codex exec --sandbox workspace-write -c sandbox_workspace_write.network_access=true "curl -sS -m 5 http://localhost:1 and report what happened"`
      should attempt the connection (connection-refused is fine — it proves network is permitted).
      This is exactly how the conductor grants QA sessions access to your dev server. If `-c`
      overrides are blocked by policy, QA falls back to source-level verification + the
      conductor-run verifier: the freeze-canary still runs (the conductor runs it outside any
      sandbox), you just lose QA's hand-driven browser probes — note it in every report.
- [ ] **Model names are valid.** If `harness.config.json` → `codex.models` pins models, run
      `codex exec --model <name> "say ok"` for each. An unknown model errors loudly (good);
      empty strings use your `~/.codex/config.toml` default (also good). Pick your GPT tiers
      here: a heavyweight reasoning model for `qa`, a fast one for `executor`.

## 3. The conductor resolves

- [ ] `node codex-workflow-harness/codex/drive-phase.mjs --check` exits 0: config found, `codex`
      binary runnable, plan dir located (or "no plan yet", which is fine pre-planning).
- [ ] If your `codex` lives somewhere unusual: set `codex.bin` in `harness.config.json` or
      `$CODEX_BIN`.
- [ ] Optional dry run once a plan exists: `node codex-workflow-harness/codex/drive-phase.mjs P0 --dry-run`
      prints the dispatch plan (waves, parallel/serial, prompts' log paths) and spawns nothing.

## 4. The trust scripts run

- [ ] `node --version` ≥ 18 (on the PATH your terminal uses).
- [ ] `node codex-workflow-harness/scripts/run-gate.mjs --no-runtime` exits 0 on a clean tree
      (proves every `runner.*` verb in `harness.config.json` resolves — fix verbs or run the
      `init-harness` skill if not).
- [ ] `node codex-workflow-harness/scripts/hook-selftest.mjs` exits 0 (proves the configured
      lint/format hooks bite a known-bad fixture).
- [ ] Web projects only: `npm i -D playwright-core`, Chrome present, then
      `node codex-workflow-harness/verifiers/web.mjs` with the dev server **down** returns a
      `SETUP` verdict (exit 3) — that's the expected "couldn't reach the app" and proves the
      verifier loads. With the server up it should PASS. If a proxy blocks `playwright-core`
      installation, the web verifier is unavailable: set `runtime.verifier: "none"` **and treat
      that as a known coverage gap** — say so in every QA report; do not let "rendered" stand in
      for "alive".

## 5. Instructions are being read

- [ ] `AGENTS.md` contains the harness block (markers `codex-workflow-harness:begin/end`) —
      Codex reads `AGENTS.md` natively, no setting needed. Ask any session: _"Which trust script
      is the merge barrier?"_ — the answer should be `phase-guard` without it searching.

## 6. Optional extras (nice, never required)

- [ ] **Playwright MCP** for richer interactive QA: if you configure a Playwright MCP server in
      `~/.codex/config.toml`, QA sessions will use its browser tools automatically. Without it,
      QA falls back to the scripted verifier — the freeze-canary never depended on MCP.
- [ ] **Live lint hooks:** `codex-workflow-harness/hooks/lint-check.sh` / `format-on-write.sh`
      are runnable by any lifecycle mechanism your build offers (or a git pre-commit hook). The
      harness doesn't depend on them — executors run the gate's lint leg regardless — and
      `hook-selftest` is the proof either way.

**Done.** Record anything you had to rename (model names, mention syntax, feature flags) in your
team notes — you'll need the same edits on the next machine.
