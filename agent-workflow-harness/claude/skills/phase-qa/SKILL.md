---
name: phase-qa
description: Validate a completed redesign phase as a FUNCTIONAL GATE — "is this feature broken, or does it break something else?" — and produce a structured defect list for the orchestrator. Operates in two modes — thorough (first pass, functional-gate battery) and verify (subsequent passes, targeted verification of prior defects + light smoke). Auto-detects mode by checking for existing pass files. Exhaustive edge-case probing and detailed design diff are NOT this skill's job — that is the polish-qa skill, run per-milestone. Use when an AI agent is assigned a phase ID (e.g. P0, P2, P3) after every parallel work-item in that phase has been marked complete. This skill is read-only — it does not modify production code.
---

# Phase-qa workflow

This skill validates a completed phase and produces a structured defect list. **This skill does not modify production code.** It reads, runs the app, observes, and reports.

**This is a functional gate, not a polish pass.** The question it answers between phases is: _is this feature broken, or does it break something else?_ Exhaustive per-criterion validation, edge-case states, and detailed pixel-level design diff belong to the `polish-qa` skill, run once per milestone — not between every phase. A between-phase pass that hunts cosmetic drift burns the token/wall-clock budget that multi-phase autonomous runs (drive-build) need for building.

The skill operates in two modes:

- **Thorough mode** — first QA pass on a phase. Functional-gate battery: static checks (typecheck + build), the runtime verifier, a happy-path walkthrough of each work-item's primary flow (opening every NEW interactive control once), happy-path integration seam checks, an obvious-breakage visual check, and a smoke pass of pre-existing surfaces the phase touched.
- **Verify mode** — second or later pass on a phase, after fixes have been applied. Targeted: the runtime verifier, verifies the specific defects from the prior pass at source and runtime, runs typecheck + build, takes a smoke screenshot of each major touched surface, watches for regressions on touched surfaces only.

Verify mode exists because re-running even the functional-gate battery after a fix-pass is mostly redundant — contract surfaces haven't changed, architectural rules don't get re-violated by a fix, and most prior acceptance criteria don't need re-verification. The cost saving is ~50% per pass while preserving the most important guard: that previously-flagged defects actually got fixed and didn't regress nearby surfaces.

**The runtime verifier runs in BOTH modes and is never skipped.** It is cheap (~25s for a handful of routes with the `web` verifier) and catches a failure class — frozen/unresponsive pages — that no other leg sees. "Trust the prior pass" applies to contracts and architectural rules, never to the runtime verifier: a fix-pass can freeze a page that was live before.

## Evidence discipline (every claim in this report cites ground truth)

This skill produces a report full of claims, and a report that lies is worse than no report — it certifies a broken phase as shippable. This harness has already shipped two confabulations: a page certified `0 critical … ready to advance` with no artifact, and an audit that quoted a lint warning and an agent line ("the MCP server is wedged") that **do not exist** in the transcripts it cited. Treat your own output as untrusted until it cites ground truth. Three rules govern every pass, in both modes:

1. **Evidence-or-reject.** Every load-bearing claim — a `PASS`, a `FIXED`, a `ready to advance`, a defect's `Observed` — cites a re-runnable artifact: a command **and its real output**, a `file:line`, or a screenshot path that exists on disk. A bare assertion is not a result; it is a hypothesis, and it does not gate progress.
2. **Quotes are verbatim and sourced.** When you quote a file, transcript, lint line, or console message, paste it exactly and cite the source on the next line so the claim can be re-verified mechanically:

   > export const dynamic = "force-dynamic";
   > — src/app/bookings/page.tsx:5

   Never reconstruct a quote from memory or paraphrase into quotation marks. A plausible-sounding quote is the easiest thing to fabricate and the hardest to catch by eye.

3. **No tooling-excuse without a positive control.** "The tool is broken / it's a Playwright/Radix limitation / the MCP server is wedged" is a conclusion you may reach only **after** a positive control proves the tool works right now on a healthy subject. The runtime verifier (§3b) is that control for browser hangs. A `curl` 200 is never evidence of client-side health. Absent a positive control, a hang is an app failure, not a tooling failure.

**Self-check before you hand off.** Run the report through the mechanical checker:

```bash
node agent-workflow-harness/scripts/qa-check.mjs <planDir>/phase-<id>-qa.md      # or the phase-<id>-qa-pass<N>.md you wrote
```

It verifies that every cited screenshot / `file:line` resolves on disk and that every file-attributed quote actually appears in that file — the same ~150-line check that catches a fabricated quote by grep. Exit `1` means a citation is missing or a quote is confabulated: **fix the report before returning it.** Add `--strict` to also fail on bare verdicts and unverifiable (transcript/URL) quotes. A clean run is part of your deliverable, not an optional extra.

## 1. Pick up the phase and detect mode

- Read `<planDir>/work-phases.md` (the plan dir, default `docs/redesign/`; `harness.config.json` → `planDir`) and identify every work-item belonging to the assigned phase ID.
- Confirm every work-item in the phase is marked complete (`- [x]`) in the progress checklist. If any are still `- [ ]`, stop and tell the user — QA on a partial phase produces noise, not signal.
- **Detect mode by inspecting the plan dir:**
  - No `phase-<id>-qa.md` exists → **thorough mode** (this is pass 1)
  - `phase-<id>-qa.md` exists but no `phase-<id>-qa-pass<N>.md` files → **verify mode**, pass 2
  - One or more `phase-<id>-qa-pass<N>.md` files exist → **verify mode**, pass N+1 (where N is the highest existing pass number)
- Output filename: thorough → `phase-<id>-qa.md`; verify → `phase-<id>-qa-pass<N>.md`.

Decide mode before doing anything else — every step below branches on it.

## 2. Plan the QA pass

### Thorough mode plan

Read each work-item brief at `<planDir>/work-item-<id>.md`. Extract:

- The item's **primary user flow** — the one end-to-end path that proves the feature works (e.g. "open the editor, switch tabs, edit a field, save, confirm persistence"). Individual acceptance criteria inform what the flow should look like; you are not building a per-criterion test matrix — that's polish-qa.
- The NEW interactive controls the item introduces (dialogs, comboboxes, popovers, pickers) — each gets opened once during the walkthrough.
- The pre-existing routes/surfaces the item's files touch — these get a does-it-still-work smoke check.
- Any explicit out-of-scope notes.

Read `<planDir>/contracts.md` and identify every contract produced or consumed within this phase. These are the integration seams — plan one happy-path producer→consumer check per seam.

Write a short plan listing static checks, the primary flow per work-item, new controls to open, seams to probe (happy path), and pre-existing surfaces to smoke.

### Verify mode plan

Read the most recent prior pass file (`phase-<id>-qa.md` for pass 2, or the highest-numbered `phase-<id>-qa-pass<N>.md` for later passes). Build a verification list:

- Every defect not marked `fixed in fix-pass N` or `deferred-by-design` — these need verification
- The files each defect's fix likely touched, derived from the defect's `Likely originating work-item(s)` and `Notes` fields
- The major surfaces those files render — these get a smoke screenshot

**Skip:** integration seam probing, primary-flow walkthroughs, the obvious-breakage visual check. The thorough pass already ran the functional gate; nothing in a normal fix-pass invalidates it. If a fix did break something at the contract or rule level, the smoke pass will surface it.

Write a short plan listing the defects to verify and the smoke screenshots to capture.

## 3. Static checks

Both modes run the same minimal check — the configured typecheck and build commands (`harness.config.json` → `runner.typecheck` and `runner.build`):

```bash
node agent-workflow-harness/scripts/run-gate.mjs --build --no-runtime   # static gate: typecheck + build, runtime verifier skipped
```

**Do not run the lint command.** The work-item-executor already ran it at every work-item's completion. Re-running it here finds nothing new at integration time and adds cost without value.

Capture any failures verbatim — they go in the defect list. In verify mode, build/typecheck failures are critical defects (the fix-pass broke the integration).

## 3b. Runtime verifier (both modes — never skipped)

A page can render a complete DOM, log zero console errors, build clean, and serve healthy — and still be **frozen**: unresponsive to interaction because the main thread is pegged. The accessibility snapshot, console, and network log do not encode responsiveness, so this failure class is invisible to every other leg of this skill. Worse, a frozen page also stalls Playwright MCP, so the symptom reads as a tooling problem. The runtime verifier is the only detector that does not share the app's failure mode.

The verifier is selected by `harness.config.json` → `runtime.verifier`: `web` is the Playwright freeze-canary for browser UIs, `none` is a no-op for non-UI projects, or a path to a custom adapter. Run it before the Playwright-driven legs:

```bash
node agent-workflow-harness/scripts/run-gate.mjs   # runs the configured static checks PLUS the runtime verifier
# (web verifier standalone: node agent-workflow-harness/verifiers/web.mjs — loads each route, DRIVES each interactive surface, re-probes responsiveness)
```

- **Exit 0 (PASS)** — every route stayed responsive through its interactions. Proceed.
- **Exit 1 (FAIL)** — at least one route went unresponsive (`FROZEN`). **Each `FROZEN`/`FAIL` verdict is a CRITICAL `liveness` defect.** Record the route, the interaction that froze it, and the verifier's JSON output as evidence.
- **Exit 2 (INCONCLUSIVE)** — the probe itself errored (not a freeze). Investigate and re-run; do not record as FROZEN.
- **Exit 3 (setup error)** — verifier setup failed, e.g. Chrome/`playwright-core` missing. Report as a blocker.

With the `web` verifier, the routes it loads come from `harness.config.json` → `runtime.web.routes` — each route plus the interactions that exercise it. If routes added in this phase aren't covered by that array, note the coverage gap in your report; the verifier only catches a freeze on an interaction it actually drives. (With `verifier: "none"` this leg is a no-op; a custom adapter runs its own check.)

**A `FROZEN`/`FAIL` verdict is never downgraded to "a Playwright/Radix limitation."** The verifier re-probes responsiveness _after_ each action precisely to disambiguate: an action that times out but leaves the page responsive is tooling flakiness; an action after which the page is unresponsive is a real app freeze. A FROZEN/FAIL verdict is a real app defect, never a tooling excuse — trust the verifier's verdict over any tooling rationalization.

## 4. Runtime / verification checks via Playwright MCP

Start the app (the configured dev command — `harness.config.json` → `runner.dev`). Explicitly say `use playwright mcp` before the first browser action.

### Thorough mode

For each work-item in the phase, drive its **primary flow** end-to-end (from your §2 plan):

1. Navigate to the relevant route
2. Drive the flow, and **actually open every NEW interactive control the item introduced (combobox, filter, dialog, dropdown, date-picker) once — don't just confirm it's present.** A rendered-but-frozen control passes a presence check and fails a real user. The worst failures hide behind the first click.
3. Screenshot the flow's end state (and any step where something looks wrong) to `<planDir>/phase-<id>-qa-screenshots/<descriptive-filename>.png`
4. Verify the flow's outcome matches the brief — the feature does what it exists to do (data persists, navigation lands, state updates)
5. Record pass/fail per flow, with the screenshot path as evidence

Then smoke the **pre-existing surfaces** the phase's files touch: load each, confirm it still renders and its primary interaction still responds. "Breaks something else" is half the gate.

Do NOT walk every acceptance criterion individually, and do not probe edge-case inputs — a criterion is only exercised here if the primary flow or a new control naturally crosses it. The exhaustive per-criterion matrix is polish-qa's job.

**DOM rendered ≠ page works.** If a Playwright action hangs or times out, that is a candidate liveness defect — re-run the runtime verifier (§3b) on that route to disambiguate app-freeze from tooling. Never attribute a hang to tooling without that positive control, and never proxy runtime validation through a code-shape check or a `curl` 200 (a server-side 200 cannot detect a client-side freeze).

If Playwright MCP is genuinely unavailable (not merely hung on one page), stop and report it as a blocker.

### Verify mode

The runtime verifier (§3b) already ran for this mode too — fold any `FROZEN`/`FAIL` verdicts into the new-defects section as CRITICAL before doing the per-defect probes below.

For each defect in your verification list, do two probes:

1. **Source-level verification** — read the file referenced in the defect's `Reproduction` section. Does the change that should have been made actually exist? Compare against the defect's `Expected` section.
2. **Runtime verification** — drive Playwright MCP to the surface the defect manifested on. Take a screenshot. Check the specific symptom: for a CSS drift, probe `getComputedStyle`; for a behavior bug, drive the interaction; for a static-check fail, the static-check pass already covered it.

Record per-defect: `fixed` / `still broken` / `partially fixed`.

Screenshots go to `<planDir>/phase-<id>-qa-pass<N>-screenshots/`.

## 5. Integration-seam probes (thorough mode only)

**Skipped in verify mode.**

For each contract in the phase, exercise the producer/consumer path end-to-end — **happy path only**:

- Trigger the producer (load the page, fire the action, mount the component that produces the contract surface)
- Verify the consumer receives data in the shape `contracts.md` specifies
- Verify the consumer renders correctly with that data

Do NOT probe edge-case states here (empty, loading, error, large-data) — those are polish-qa's job. The between-phase question is whether the seam works at all, not whether it degrades gracefully.

Bugs at this step are the highest-priority class of defect — they're the integration failures individual work-items couldn't see.

## 6. Obvious-breakage visual check

### Thorough mode

For every screen the phase touches, glance at your Playwright screenshot against the design source for **obvious breakage only**: broken layout, missing sections, unreadable/overlapping content, a component that plainly failed to render. This is a "did the screen come out structurally right" check, not a fidelity audit.

Do NOT hunt spacing/typography/color drift, missing interaction states, or responsive behavior — that detailed diff is polish-qa's job. Logging cosmetic drift here at blocking severity is how a functional gate turns into an hour-long polish pass.

### Verify mode — smoke pass

For each major touched surface (derived from the verification list's file paths), take one full-page screenshot at the default viewport. Compare to the design source quickly — looking for obvious regressions, not detailed drift. Detailed drift was caught in the thorough pass.

If you spot a new defect during the smoke pass, flag it. **New defects discovered in verify mode are higher-priority than minor drift** — they indicate the fix-pass had side effects.

## 7. Output the defect list — tiered by severity

### Critical and major defect format (full detail)

For phase-blocking issues and functional spec mismatches — static-check failures, broken integration seams, primary flows that fail, features that do the wrong thing:

```
## D<n> — <one-line summary>

**Severity:** critical | major
**Likely originating work-item(s):** Wx.y, Wx.z
**Type:** liveness | static-check | runtime-criterion | integration-seam | visual-drift
**Screenshot:** <planDir>/phase-<id>-qa-screenshots/<filename>.png

### Observed
<full detail — concrete and specific>

### Expected
<full detail — what the brief, contract, or design source specifies>

### Reproduction
<step-by-step from a fresh app start>

### Notes
<anything load-bearing, fix recommendations, cross-work-item coordination needs>
```

### Minor defect format (one paragraph)

For cosmetic or edge-case issues the phase could ship without:

```
## D<n> — <one-line summary>

**Severity:** minor · **Origin:** Wx.y · **Type:** visual-drift
**Observed:** <one sentence>
**Expected:** <one sentence>
**Fix hint:** <one sentence, optional>
```

No separate sections, no screenshot unless the visual is the only viable way to describe it.

### Known minors — the defect ledger

Before writing your report, read `<planDir>/defect-ledger.md`. Anything listed there is a KNOWN minor: do not re-prove it, do not re-screenshot it, do not re-report it as a new defect. (A regression of a `fixed` row, or a listed minor that has become functionally blocking, is a NEW defect at the appropriate severity — file it in the report.) After writing your report, APPEND one ledger row per NEW minor you found, per the ledger's own header protocol, citing your report for the detail. Minors get discovered and proved exactly once; the ledger is the standing fix queue, and it never blocks a barrier.

### Severity guidance

- **Critical** — phase doesn't work. Liveness failures (a route freezes on interaction), static-check failures, broken integration seams, a primary flow that fails entirely. The phase cannot ship in this state.
- **Major** — phase runs but does the wrong thing **functionally**: saves the wrong data, navigates to the wrong place, shows the wrong record, a regression on a pre-existing surface. The feature is misbehaving, not just mis-styled.
- **Minor** — cosmetic or edge-case: visual drift, spacing/typography/color mismatch, a missing hover/empty/error state, edge-case input handling. The phase ships without this fix; polish-qa owns hunting and fixing this class per-milestone.

The merge barrier blocks on `harness.config.json` → `gate.blockOn` (default `["critical","major"]`) — so a **MAJOR** defect blocks advancement, not only critical. Classify by function, not by spec-letter: don't park a real functional mismatch as minor to slip it past the barrier, and don't promote cosmetic drift to major just because the design source disagrees — a barrier that blocks on cosmetics stalls autonomous multi-phase runs on non-defects. If everything is critical, nothing is. Reserve critical for actual blockers.

### Output file structure

**Thorough mode** → `<planDir>/phase-<id>-qa.md`:

```
# Phase <id> — QA pass 1

**Counts:** N critical · N major · N minor (N total).
**Recommendation:** <ready to advance | needs fix-pass before advancing to P<next>>
**qa-check:** <clean | the citation/quote violations you fixed before handing off> — `node agent-workflow-harness/scripts/qa-check.mjs` on this file

If a defect you logged is fixed and re-verified before the phase closes (a mid-run fix-pass), annotate it in the counts line — e.g. `1 major (resolved) · 1 minor` — and mark the defect heading **RESOLVED** with the fix evidence. A bare `1 major` over a resolved defect makes the report's top line claim an open blocker that no longer exists; whoever skims only the header will make the wrong barrier call.

[static-check summary table]
[runtime-verifier summary: per-route PASS/FROZEN + verifier exit code]
[runtime probe summary table]
[integration-seam probe summary table]
[screenshots index]
[defects ordered by severity, tiered detail per above]
```

**Verify mode** → `<planDir>/phase-<id>-qa-pass<N>.md`:

```
# Phase <id> — QA pass <N>

**Counts:** <prior-defect-resolution counts> · <new-defect counts>
**Recommendation:** <ready to advance | needs fix-pass <N>>
**qa-check:** <clean | the citation/quote violations you fixed before handing off> — `node agent-workflow-harness/scripts/qa-check.mjs` on this file

## Runtime verifier

[per-route PASS/FROZEN + verifier exit code — runs in verify mode too, never skipped]

## Fix-pass verification

| ID  | Origin pass | Source fix verified | Runtime verified | Status |
| --- | ----------- | ------------------- | ---------------- | ------ |
| D1  | pass 1      | <one-line>          | <one-line>       | FIXED |
| D2  | pass 1      | <one-line>          | <one-line>       | STILL BROKEN |
| ... |             |                     |                  |        |

## New defects (if any)

[same tiered format as thorough mode]

## Smoke pass screenshots

[index of screenshots, one per touched surface]
```

Verify mode skips the full runtime probe table and integration-seam table — those are inherited from the thorough pass. It does **not** skip the static-check or runtime-verifier summaries — both run every pass.

If there are zero defects in either mode, write that explicitly at the top: `**No defects found. Phase Px is ready to advance.**`

## 8. Hand off

Return to the orchestrator:

- Phase ID
- Mode used (thorough / verify pass N)
- Defect count by severity, separating prior-defect verification from new defects in verify mode
- Path to the report file
- One-sentence summary: `Phase Px ready to advance` or `N defects need fixing — see <path>`
- Runtime-verifier result: PASS, or the routes that came back FROZEN/FAIL
- `qa-check` result: clean, or the citation/quote violations you found and fixed in your own report before returning it
- `phase-guard` readiness: this report is the artifact `node agent-workflow-harness/scripts/phase-guard.mjs <id>` requires before a phase can be called complete. Run it after writing the report to confirm the phase is now guarded (all items `[x]` + this report passes `qa-check`); report green, or the gap that keeps it unguarded.
- Coverage notes if any acceptance criteria couldn't be Playwright-validated, or any phase routes `runtime.web.routes` doesn't yet cover

If your defect list is empty, say so explicitly — the orchestrator needs that signal to decide whether to advance or run another iteration.

## What this skill does not cover

- Fixing defects — that's `work-item-executor` running on a defect-derived inline brief, kicked off by the orchestrator.
- Re-planning the phase — if QA reveals the original plan was wrong, that's `plan-work-item` in a scoped re-plan, kicked off by the user.
- Cross-phase regression testing — `phase-qa` validates only the phase it's invoked on. Cross-phase regression is a separate invocation against the full integrated app.
- Polish QA — exhaustive per-criterion validation, edge-case seam states (empty/loading/error/large-data), detailed visual diff vs the design source, responsive drift. That's the `polish-qa` skill, run per-milestone across the phases shipped since the last polish pass.
- Writing or modifying any production code — this skill is read-only by design.
