<!--
  defect-ledger.md — the standing queue of KNOWN OPEN MINOR defects across the whole plan.
  Lives in <planDir> alongside work-phases.md (scaffolded by install.mjs). Append-only rows.

  Why it exists: without it, every QA pass re-discovers — and re-proves, with screenshots —
  the same minor drift, burning QA time on defects that are already on the books. The merge
  barrier still blocks only on harness.config.json → gate.blockOn (default critical+major);
  minors land HERE once and stop costing anything until someone chooses to fix them.

  Protocol:
  • phase-qa / phase-qa-verify read this file FIRST. Anything listed is a KNOWN minor — not
    re-proved, not re-screenshotted, not re-reported. They APPEND one row per NEW minor
    (next L<n> id, status `open`), citing the QA report that carries the full detail.
  • A regression of a `fixed` row, or a listed minor that has become functionally blocking,
    is a NEW defect at the appropriate severity in the phase QA report — not a ledger edit.
  • polish-qa takes the `open` rows as its starting checklist and annotates what it re-verified.
  • Whoever fixes a minor (a polish fix batch, a work-item in passing) flips its Status to
    `fixed` with one line of evidence in Detail. The row is the queue entry; the QA report
    stays the detail record.
  • Nothing in this file ever blocks a phase barrier.

  Delete this comment and the example row when the first real minor lands.
-->

# Defect ledger — known open minors

| ID  | First seen  | Origin | Summary                         | Detail              | Status |
| --- | ----------- | ------ | ------------------------------- | ------------------- | ------ |
| L1  | <P2 pass 1> | <W2.3> | <one-line summary of the minor> | <phase-P2-qa.md#D4> | open   |
