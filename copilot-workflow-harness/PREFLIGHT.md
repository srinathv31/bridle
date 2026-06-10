# PREFLIGHT — validate the harness on THIS machine (once)

Copilot Chat's customization surface moved fast through 2025–26 and corporate machines pin old
versions or disable features by policy. This checklist takes ~10 minutes, needs no real project
work, and surfaces every environment problem **before** it costs you a build. Run it top to
bottom on each new machine (and after major VS Code/Copilot updates). Each item says what to do
if it fails — the harness has a designed fallback for every soft failure.

## 1. Versions and feature availability

- [ ] VS Code and the GitHub Copilot Chat extension are current (2026 builds). Custom agents
      (`.github/agents/*.agent.md`) and prompt files (`.github/prompts/*.prompt.md`) ship in
      2025+ builds; if your build predates them, ask IT to update — there is no harness without
      prompt files.
- [ ] Open Copilot Chat → the **agents picker** lists `harness-planner`, `harness-orchestrator`,
      `work-item-executor`, `phase-qa`, `phase-qa-verify`. If it doesn't: reload the window;
      check the files landed in `.github/agents/`; check no org policy hides workspace agents.
- [ ] Type `/` in the chat input → the harness prompts appear (`/run-phase`, `/work-item`,
      `/phase-qa`, …). If not: check `.github/prompts/` exists and prompt-file support isn't
      disabled by policy (look for a `chat.promptFiles*` setting in your build).

## 2. Frontmatter names match YOUR build (the #1 source of silent breakage)

- [ ] **Models.** Open each `.github/agents/*.agent.md`. The shipped pins are `Claude Opus 4.7`
      (planner, orchestrator, phase-qa) and `GPT-5.5` (executor, qa-verify). Compare against the
      exact strings in your model picker and edit the frontmatter to match — a model string the
      picker doesn't know falls back to the session default silently, which quietly puts your QA
      on the wrong model.
- [ ] **Tools.** Open each agent file in the editor — VS Code validates the `tools:` list and
      offers completions. Fix any identifier your build flags as unknown (tool ids have been
      renamed across versions; the intent of each list is commented in the file). Two invariants
      to preserve while fixing: the **orchestrator gets no edit tool**, and the **executor gets
      no subagent tool**.

## 3. Terminal auto-approve (or you'll click "Allow" 200 times per phase)

- [ ] `.vscode/settings.json` contains the `chat.tools.terminal.autoApprove` block (the installer
      merges it; if your settings file is JSONC the installer left `.vscode/settings.harness.json`
      next to it — merge by hand). If your build renamed the setting, search "auto approve" in
      the Settings editor and port the entries.
- [ ] Live test: in agent mode, ask Copilot to run
      `node copilot-workflow-harness/scripts/phase-guard.mjs` — it should execute **without** an
      approval prompt. A destructive command (e.g. `rm -rf /tmp/x`) should still prompt.
- [ ] Org-policy check: some enterprises force-disable auto-approval (`ChatToolsAutoApprove`
      policy). If so, the harness still works — you just confirm each script run by hand; budget
      for it. Never compensate with a global "approve everything" toggle: the deny-list entries
      (`rm`, `git push`, …) and the edit-prompt outside `docs/redesign/` are part of the
      harness's safety story.

## 4. Subagent delegation (parallel fan-out)

- [ ] In a throwaway chat on `harness-orchestrator`, ask: _"Delegate to a subagent: report the
      Node version."_ If a subagent spawns and returns — fan-out works; `/run-phase` will
      dispatch executors and QA itself.
- [ ] If the tool is missing/blocked by policy: **multi-session mode is the designed fallback**,
      not a degraded hack. `/run-phase` will print the exact `/work-item W…` commands; open one
      chat session per command (side by side for parallel items), run them, then re-invoke
      `/run-phase` to continue from the gate. QA always runs via `/phase-qa` in its own fresh
      session either way.

## 5. The trust scripts run

- [ ] `node --version` ≥ 18 (on the PATH the integrated terminal uses).
- [ ] `node copilot-workflow-harness/scripts/run-gate.mjs --no-runtime` exits 0 on a clean tree
      (proves every `runner.*` verb in `harness.config.json` resolves — fix verbs or run
      `/init-harness` if not).
- [ ] `node copilot-workflow-harness/scripts/hook-selftest.mjs` exits 0 (proves the configured
      lint/format hooks bite a known-bad fixture).
- [ ] Web projects only: `npm i -D playwright-core`, Chrome present, then
      `node copilot-workflow-harness/verifiers/web.mjs` with the dev server **down** returns a
      `SETUP` verdict (exit 3) — that's the expected "couldn't reach the app" and proves the
      verifier loads. With the server up it should PASS. If the corporate proxy blocks
      `playwright-core` installation, the web verifier is unavailable: set
      `runtime.verifier: "none"` **and treat that as a known coverage gap** — say so in every QA
      report; do not let "rendered" stand in for "alive".

## 6. Instructions are being read

- [ ] `.github/copilot-instructions.md` contains the harness block (markers
      `copilot-workflow-harness:begin/end`). Ask any agent: _"Which trust script is the merge
      barrier?"_ — the answer should be `phase-guard` without it searching. If your repo uses
      `AGENTS.md` as its primary instructions file instead, paste the block there too (both are
      read; duplication is harmless).

## 7. Optional extras (nice, never required)

- [ ] **Playwright MCP** for richer interactive QA: if org policy allows MCP servers, configure
      one and the QA agents will use its browser tools automatically. If MCP is blocked, QA falls
      back to the scripted verifier + browser preview — the freeze-canary never depended on MCP.
- [ ] **Agent hooks** (preview in 2026 builds): if available, you can wire
      `copilot-workflow-harness/hooks/lint-check.sh` / `format-on-write.sh` to post-edit lifecycle
      events for live lint-on-edit, replicating the Claude Code edition's hook layer. The harness
      doesn't depend on it — executors run the gate's lint leg regardless — so treat this as a
      bonus, and `hook-selftest` as the proof either way.

**Done.** Record anything you had to rename (models, tool ids, setting ids) in your team notes —
you'll need the same edits on the next machine.
