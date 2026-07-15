<!--
  work-item-<id>.md — one self-contained brief per chunk. Lives in <planDir> alongside
  work-phases.md and contracts.md. It is the ENTIRE prompt for one executor: an agent should be able
  to implement this item from this file plus the inputs it lists, without reading sibling briefs.

  This is a FILL-IN-THE-BLANKS template. Replace every <angle-bracket placeholder> and delete this
  comment. Keep the section HEADINGS exactly as written — the harness parsers and human readers both
  depend on them:
    • "**Depends on:**"                         — the precheck guard reads it
    • "**Parallel-safe within phase:**"          — your INTENT (the real check is file-set overlap)
    • "## Files this item creates / edits"       — phase-items.mjs computes overlap from THIS list
  Use the id scheme your harness.config.json declares (default W<phase>.<n> / P<phase>).
-->

# <Wx.y> — <one-line title of what this item builds>

**Phase:** <Px>
**Depends on:** <none | Wx.y | Wx.y, Wx.z | P<n> complete>
**Parallel-safe within phase:** <yes | no> <(— one clause of why, e.g. "disjoint files; only this item edits <path>" or "no — <sibling> imports what this produces")>

## What to build

<2–5 sentences. State the goal and the shape of the deliverable concretely enough that an executor
knows when it's done. Name the contracts this item produces or consumes (e.g. "produces C9, C10;
consumes C2"). Call out the algorithm or data flow if it's non-obvious. Name edge cases by name —
empty inputs, boundary/transition values, null fields, overpayment/underflow, race conditions —
rather than leaving them implicit.>

## Files this item creates / edits

<!-- phase-items.mjs computes REAL overlap from this list to decide parallel-safety. For parallel
     siblings, keep these sets DISJOINT — any shared path serializes the phase regardless of the
     "Parallel-safe: yes" line above. Mark each (create) or (edit). Append-only edits to a shared
     file are still an edit and still count as overlap. -->

- `<path/to/file-a>` (create — <what it is>)
- `<path/to/file-a.test.ext>` (create — colocated test)
- `<path/to/existing-file>` (edit — <the specific, narrow change>)

## Requires

<!-- OPTIONAL — delete the whole section if this item needs nothing from outside the repo.
     Everything the item needs from the WORLD, one bullet per need; precheck.mjs verifies each
     line BEFORE dispatch, so a missing key fails in seconds instead of 40 minutes into a build.
       env:  <KEY>            — set in the environment or a root .env* file
       file: <path>           — exists at the project root (e.g. gitignored credentials)
       cmd:  <shell command>  — exits 0 within 30s (probe an external service, credits, migration state)
     A trailing " — <why>" note is allowed; the parser ignores it. -->

- env: <SERVICE_API_KEY> — <which call needs it>
- file: <path/to/gitignored-credentials> — <what reads it>
- cmd: <command that proves the external dependency is alive> — <what it probes>

## Acceptance criteria

<!-- Each criterion must be checkable against an ARTIFACT (a command + its real output, a file:line,
     a screenshot), not a subjective "looks right". Check a box only with the evidence behind it. -->

- [ ] <a structural claim, e.g. "`<module>` exports `<symbols>`; shapes match contract C<n> exactly">
- [ ] <a behavioral claim verified at runtime, e.g. "selecting <option> filters the rows to <subset>; clearing restores the full set — observed via the runtime check">
- [ ] <an edge-case claim, e.g. "empty input → <result>; <boundary value> → <result>">
- [ ] **for a UI item:** every interactive control responds and the route stays live; the configured runtime verifier passes <(for a web project this is the browser freeze-canary; for an api/cli project, the corresponding verifier — same criterion, different adapter)>
- [ ] the configured **lint** verb passes (harness.config.json → runner.lint)
- [ ] the configured **typecheck** verb passes (harness.config.json → runner.typecheck)
- [ ] the configured **test** verb passes, including any new colocated tests (harness.config.json → runner.test)

## Inputs to read

<!-- Everything the executor must read before writing code — so it doesn't guess at a shape, a
     convention, or a stack quirk. -->

- `work-phases.md` (the architectural rules — cite the rule numbers this item must honor)
- `contracts.md` (the contracts named above — match the signatures verbatim)
- `<path to the canonical pattern to mirror>` (<e.g. an existing module/page that establishes the
  performance or structure pattern this item should copy>)
- `<any stack docs the executor must heed, e.g. a framework's local docs / deprecation notices>`

## Out of scope

<!-- Bound the blast radius. Each bullet is a thing the executor must NOT do — usually because a
     sibling item owns it, or an architectural rule forbids it. -->

- <Work that a sibling item owns — name the item, e.g. "No <feature>; that is W<x>.<z>.">
- <Files this item must not touch — e.g. "Do not edit `<path>`; <other item> owns it.">
- <Anything an architectural rule forbids — e.g. "Do not implement/move the `<anchor>` (rule N).">
