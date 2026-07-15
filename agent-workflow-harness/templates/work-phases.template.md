<!--
  work-phases.md — the orchestrator's map. Lives in <planDir> (harness.config.json → planDir).
  This is a FILL-IN-THE-BLANKS template. Replace every <angle-bracket placeholder>; delete this
  comment and the example rows when you're done.

  HOW THE SCRIPTS PARSE THIS FILE (keep the shapes intact or the parsers won't see your items):

  • Item ids and phase labels are CONFIG-DRIVEN, not hardcoded. The default scheme is
      checklist item  =  W<phase>.<n>     (e.g. W7.1)
      phase label     =  P<phase>         (e.g. P7)
    but harness.config.json → ids.{checklistItem, phaseLabel, phaseArg} can change the spelling.
    Use whatever scheme your config declares, consistently, everywhere below.

  • Phase table: phase-items.mjs reads the | Phase | … | Mode | row for each phase. The MODE IS THE
    LAST TABLE CELL and must be one of: parallel | sequential | single.

  • Progress checklist: phase-guard.mjs scans for "- [ ] <id>" / "- [x] <id>" lines (the regex is
    built from ids.checklistItem). Every work-item needs exactly one checklist line. A phase is
    "complete" only when all of its checklist lines are [x].

  • phase-items.mjs computes parallel-safety from the REAL file-set overlap of each item's
    "## Files this item creates / edits" list in its work-item-<id>.md — it overrides a brief's
    self-reported "Parallel-safe" claim. The table's Mode is your intent; the file sets are the truth.

  • precheck.mjs additionally reads the optional "**Repo:**" pin below the title (refuses dispatch
    from a mismatched working directory — guards wrong-repo session resumes) and each brief's
    optional "## Requires" section (env/file/cmd preflight, verified before any dispatch).
-->

# <Project / epic name> — Work Phases

**Repo:** <root folder name of this repo — leave the angle brackets in place to skip the check>

Orchestrator map for building <one-line description of what this plan delivers>. This file is the
source of truth for which work-items belong to which phase, what runs in parallel, and what blocks
what.

---

## Architectural rules

These rules are load-bearing and **authored per project** — this is where your domain's business
logic and invariants live. Every execution agent must honor them; every QA pass checks against them.
Number them so work-items and contracts can cite a rule by number. Replace the examples below.

1. **<Invariant about data representation>.** <e.g. "Money is integer cents end to end — never a
   float, never a string, in storage or transport. Formatting happens only at the view edge.">
2. **<Invariant about derived vs stored values>.** <e.g. "Derived totals/status are computed at read
   time, never written by a create/patch.">
3. **<Read-only boundary>.** <e.g. "Do not modify the <existing module/table>; reference it by id
   only.">
4. **<Toolchain / convention rule>.** <e.g. "Use the configured package manager and path alias;
   validate every API boundary; no untyped input reaches business logic.">
5. **<Idempotency / fixtures rule>.** <e.g. "The seed/fixtures extend, never rewrite, and produce
   identical state every run.">
6. **<Any deliberate teaching/anchor constraint, if applicable>.** <e.g. "Leave the literal
   `// TODO: …` anchor exactly where it is; do not implement it.">

---

## Phase table

| Phase | Delivers                          | Items              | Mode                           |
| ----- | --------------------------------- | ------------------ | ------------------------------ |
| <P0>  | <what this phase ships, one line> | <W0.1, W0.2>       | <parallel\|sequential\|single> |
| <P1>  | <…>                               | <W1.1 → W1.2>      | <sequential>                   |
| <P2>  | <…>                               | <W2.1, W2.2, W2.3> | <parallel>                     |
| <P3>  | <…>                               | <W3.1>             | <single>                       |

<!-- Mode: parallel = siblings run concurrently (disjoint file sets); sequential = each waits on the
     previous in the same phase; single = exactly one item. The LAST cell must be the Mode word. -->

**Dependencies:**

- <P1 depends on P0>
- <P2 depends on P1>
- <P3 depends on P2>

Within a phase, items marked `parallel` execute concurrently in separate sub-agents **only because
their "Files this item creates / edits" sets are disjoint** — verified mechanically by
`phase-items.mjs`. Items marked `sequential` wait for the predecessor in the same phase (typically
because each imports what the previous produces).

---

## Progress checklist

Execution agents flip `- [ ]` to `- [x]` in their own work-item file **and** mirror that change here.
The orchestrator gates phase transitions on this list **plus** a passing phase QA report (the
`<report.namePattern>` file that itself passes `qa-check`). Group items under their phase heading.

### <P0> — <phase title>

- [ ] <W0.1> — <short description of the chunk>
- [ ] <W0.2> — <short description of the chunk>

### <P1> — <phase title>

- [ ] <W1.1> — <short description>
- [ ] <W1.2> — <short description>

### <P2> — <phase title>

- [ ] <W2.1> — <short description>
- [ ] <W2.2> — <short description>
- [ ] <W2.3> — <short description>

### <P3> — <phase title>

- [ ] <W3.1> — <short description>
