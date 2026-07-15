---
name: work-item
description: Execute a redesign work-item brief from docs/redesign/work-item-*.md. Use when an AI agent is assigned a specific work-item ID (e.g. W0.1, W2.3, W3.5) to implement. Covers reading the brief, the clarification protocol, scoped implementation, post-implementation verification including Playwright MCP for runtime checks on web apps, and marking the item complete in work-phases.md.
---

# Work-item workflow

Each `work-item-*.md` file in the plan dir (default `docs/redesign/`; the plan dir is `harness.config.json` → `planDir`) is a self-contained brief built to be the entire prompt for one agent. It already contains the goal, files to touch, implementation notes, acceptance criteria, and out-of-scope guardrails. This skill defines how to work through one without drifting.

## 1. Pick up the work-item

- Open the assigned brief at `<planDir>/work-item-<id>.md`.
- Read it end-to-end before doing anything else.
- Read every file/section the **Inputs to read before writing code** block points at — those are mandatory context, not optional.
- If the brief lists `<planDir>/contracts.md` as an input, treat it as load-bearing. The contracts file pins the typed surfaces between work-items; if the brief and contracts disagree on a shape, the contracts file wins and you stop to ask. Producer items must implement the contract verbatim; consumer items must call it verbatim.
- Verify dependencies are merged. If the brief lists `Depends on: WX.Y`, confirm that work-item is checked off in `<planDir>/work-phases.md` → **Progress checklist**. If it isn't, stop and tell the user.
- Confirm the safety hooks are alive: run `node agent-workflow-harness/scripts/hook-selftest.mjs` once at the start of a session. It feeds the lint/format hooks a known-bad fixture and fails if a hook is dead — a copied-but-no-op hook gives you zero inline protection while looking installed. If it reports a dead hook, tell the orchestrator before relying on inline lint/format.
- Start your heartbeat: write `<id>.json` in the status dir (`harness.config.json` → `statusDir`, default `docs/redesign/.status/`) with `state: "running"` (see the work-item-executor agent for the shape) and bump its `lastBeat`/`step` as you progress. This is how the orchestrator distinguishes a working subagent from a hung one without a human having to ask. Timestamps must come from a real clock read (`$(date +%s)000` or `node -e 'console.log(Date.now())'`), never typed from memory — the orchestrator cross-checks them against the file's mtime.

## 2. Understand the plan, then pause if anything is unclear

After reading the brief and inputs, write a short plan (one paragraph or task list) that maps the brief to the concrete edits you'll make. Most ambiguities surface only when you try to articulate the plan — don't skip this step.

If anything is unclear — ambiguous spec, conflicting guidance between brief and code, missing context, a file path that no longer matches the codebase — **pause and ask the user before any further implementation**. Do not guess.

Things to pause on:

- The brief references a file/route that doesn't exist or has been renamed.
- Two parts of the brief contradict each other.
- The brief and `contracts.md` disagree on a typed surface.
- The acceptance criteria can't be satisfied without changing something the brief says is out of scope.
- A dependency listed under "Depends on" hasn't been merged.
- The reference template / spec snippet uses tokens or classes that don't yet exist in the codebase.

State the question, list the options you considered, and recommend one. Wait for the user before continuing. Continue this feedback loop — ask, get an answer, implement the next chunk, ask again if needed — until the work-item is fully done.

**Harness-dispatched executors cannot converse.** If you were spawned by the `execute-phase` workflow, pause-and-ask means: return `state: "blocked"` with a note and the ONE question whose answer unblocks you in the `question` field, then stop — do not guess. The conductor relays the question and re-dispatches you with the answer injected into your prompt; treat that answer as an authoritative part of the brief.

## 3. Implement, scoped tightly to the brief

- Edit only the files listed in **Files this item creates / edits**.
- Honor every **Out of scope** bullet — those are guardrails the spec author chose deliberately.
- Honor the **Architectural rules** in `work-phases.md` (no `cva` for editorial primitives, no barrel `index.ts`, no `bg-blue-100` chips, no emoji titles, etc.).
- Match the **Reference JSX / Reference template** verbatim where the brief calls for it — the spec authors expect identical output.
- Match the surfaces in `contracts.md` verbatim where this item produces or consumes one. This is non-negotiable; downstream items rely on the exact shape.
- If a load-bearing question arises mid-implementation, return to step 2 (pause + ask). Better to ask twice than to hand back work that misses the spec.

## 4. Verification — only after implementation is complete

**Which checks are yours depends on how you were dispatched:**

- **Harness-dispatched** (spawned by the `execute-phase` workflow, or any orchestrator prompt that says "static self-checks only"): run ONLY the static checks below. The phase gate owns ALL runtime verification — one dev server, one runtime-verifier run, one browser pass for the whole phase — so a per-item dev server fights the gate for the port and re-buys coverage the phase already gets once. Skip the two runtime sections below and the runtime parts of the final walk-through. Your dispatch prompt wins over this skill wherever they disagree.
- **Standalone** (a human assigned you one item and no phase gate is coming): run the full protocol including both runtime sections — you are the only verification this item will get.

Run your STATIC self-checks in order, and only after you believe the code is done. Don't run them between every edit; that creates noise and breaks focus. The static set is the configured lint and typecheck commands (`harness.config.json` → `runner.lint` and `runner.typecheck`):

```bash
node agent-workflow-harness/scripts/run-gate.mjs --no-runtime   # configured lint + typecheck + test, runtime verifier skipped
```

The runtime check is **not** your job here — it happens once at the phase gate, against a single dev server, run by the orchestrator. Your job is to leave the static checks green.

If a check fails, fix the underlying issue and re-run. Don't bypass with linter-suppression / type-escape comments unless the brief explicitly allows it. Scaffold is excluded at the linter-config level (in your linter's ignore config, e.g. the generated UI primitives plus the listed hooks), so **any lint finding on a non-ignored file is real** — never wave it off as "scaffold" or "pre-existing" noise. The lint hook enforces this live: it blocks (exit 2) on errors and surfaces warnings as context. Fix the cause; don't silence the rule.

**Both modes:** if you created a brand-new route, add it (and the interactions that exercise it) to `runtime.web.routes` in `harness.config.json` — the phase gate and the verifier only catch a freeze on a route they actually drive. This is the one allowed edit outside your brief's file list; mention it in your summary.

### Runtime verification with Playwright MCP (standalone mode only)

For any work-item with runtime acceptance criteria — anything phrased as "the dropdown opens," "the form submits," "the page renders X," "the table sorts by Y" — validate against the running app via Playwright MCP, not by inspection of the code. Code that typechecks and lints can still render wrong; runtime checks are the only thing that catches that class of bug.

Start the app (the configured dev command — `harness.config.json` → `runner.dev`) and explicitly say **"use playwright mcp"** before the first browser action in the conversation. Without that prefix, agents commonly try to drive Playwright via bash, which is slower and less reliable.

For each runtime acceptance criterion in the brief:

1. Navigate to the relevant route
2. Drive the interaction the criterion describes (click, type, hover, keyboard nav) — **actually open every interactive control you added (combobox, filter, dialog, dropdown, date-picker), don't just confirm it renders.** A rendered control that freezes the page when opened passes a presence check and fails a real user.
3. Take a screenshot and verify the rendered state matches the design source referenced in the brief
4. If the brief includes a reference JSX or template snippet, the rendered output should match it visually — not just structurally

**DOM rendered ≠ page works.** Code that typechecks, lints, and renders a full DOM can still freeze the main thread on interaction. If a Playwright action hangs or times out, treat it as a candidate app-freeze, not a tooling glitch — confirm with the runtime verifier below before moving on.

If Playwright MCP isn't configured for this project, stop and tell the user. Don't proxy the validation through a code-shape check, and don't skip it. Either the project gets MCP configured or the work-item's runtime criteria need to be downgraded by the planner — that's a call for the user, not the executor.

For backend-only or pure-utility work-items with no runtime acceptance criteria, skip this step. The brief itself tells you whether runtime checks apply.

### Runtime verifier (standalone mode only — any work-item that touches a UI route)

Before marking a UI work-item complete, run the runtime verifier (`harness.config.json` → `runtime.verifier`) on the routes you touched. With the `web` verifier this is a Playwright freeze-canary that loads each route, drives its interactive surfaces, and re-probes responsiveness; `none` is a no-op for non-UI projects; or it can point at a custom adapter:

```bash
node agent-workflow-harness/scripts/run-gate.mjs        # the configured static checks PLUS the runtime verifier
# (web verifier standalone: node agent-workflow-harness/verifiers/web.mjs)
```

Exit `0` = all routes stayed responsive; proceed. Exit `1` = a route went unresponsive (`FROZEN`/`FAIL`) — that is a real app defect in your work, **fix it before completing the item**; never attribute it to Playwright/Radix/tooling. Exit `2` = probe inconclusive (re-run); exit `3` = verifier setup error, e.g. Chrome/`playwright-core` missing (report to the orchestrator).

### Final acceptance walk-through

Walk through the brief's **Acceptance criteria** checkbox-by-checkbox and confirm each one. Only flip checkboxes whose criteria you actually verified — no checking by faith. Each box you check must have a concrete artifact behind it: the command and its real output, the screenshot, or the `file:line` — not an assumption that it probably works. **Standalone mode:** for UI items, run the configured dev command and exercise the page in a browser via Playwright MCP one last time end-to-end (type checks pass ≠ feature works), and the runtime verifier must be green (exit 0) for every route this item touches before any box is checked. **Harness-dispatched:** runtime-phrased criteria are verified once at the phase gate and by phase-qa, not by you — verify statically what you can, note the runtime criteria as "deferred to gate" in your summary, and never claim runtime proof you didn't produce.

## 5. Mark the work-item complete

Once every acceptance criterion you own is satisfied AND your mode's checks are green (standalone: lint / typecheck / tests / Playwright runtime; harness-dispatched: the static set — the phase gate owns the rest):

1. Open `<planDir>/work-phases.md`.
2. In the **Progress checklist** section, find the row for this work-item ID and flip `- [ ]` to `- [x]`.
3. Commit the work-item changes and the checklist tick together — downstream agents read this file to verify dependencies, so an unticked-but-merged item will block them.
4. Set your status file to `state: "done"` (in the status dir, `harness.config.json` → `statusDir`, default `docs/redesign/.status/`) so the orchestrator's `node agent-workflow-harness/scripts/subagent-status.mjs` sees the item finished rather than abandoned.

If you finished a phase's last item, **don't** advance to the next phase yourself — phases are merge barriers. Leave that call to the user. Flipping the last `[x]` does not make a phase _complete_: the orchestrator runs `node agent-workflow-harness/scripts/phase-guard.mjs`, which refuses any phase whose items are all checked but which has no passing `phase-<id>-qa.md` on disk. Your tick is necessary but not sufficient.

## What this skill does not cover

- Cross-item coordination — that lives in `work-phases.md` and `contracts.md`.
- Spec interpretation when the brief is silent — pause and ask.
- Cross-phase integration testing — that's the phase-qa agent's job, run by the orchestrator at phase boundaries, not by the individual work-item executor.
- Running design-spec / chat-transcript research — already baked into each brief's "Inputs to read" list.
