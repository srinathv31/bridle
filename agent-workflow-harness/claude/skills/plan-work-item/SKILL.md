---
name: plan-work-item
description: Plan a redesign or feature implementation by decomposing a brief into the orchestration files multi-agent execution needs — docs/redesign/work-phases.md, docs/redesign/contracts.md, and one docs/redesign/work-item-<id>.md per chunk. Use when an agent is given a design URL, written spec, or feature description and asked to set up the work for multiple downstream execution agents. Covers reading the brief, codebase reconnaissance, the planning checkpoint, file production, and consistency verification. Output is consumed by the work-item skill.
---

# Plan-work-item workflow

This skill produces the full set of files an orchestrator needs to fan a redesign or feature out to multiple execution agents. The output of this skill is the input to the `work-item` skill — file paths, work-item ID format, and acceptance criteria style must match what `work-item` expects. This skill plans the work; it does not implement any of it.

All artifacts land in the plan dir (default `docs/redesign/`; the plan dir is `harness.config.json` → `planDir`). Paths below use the default; substitute your configured `planDir` if it differs.

## 1. Read the input brief end-to-end

Sources can be:

- A design URL (Figma, Anthropic design tool, etc.) — fetch it, read the design system, every screen, every component variant
- A written spec (markdown file, ticket description) — read in full
- A user prompt describing the feature in prose

Do not start planning until you have read the entire brief. If the brief points at a design tool, follow every link the design's README references — design tokens, component specs, and interaction notes are all mandatory context.

## 2. Read the codebase enough to understand the integration surface

The plan must fit the codebase as it actually exists, not as the design imagines it. Before decomposing, read:

- The project manifest / dependency surface (UI library, test runner, build tools)
- The directory structure of the area being changed (e.g. `src/components/`, `src/pages/admin/`)
- Any existing convention file: `CLAUDE.md`, `AGENTS.md`, `.claude/`, prior `docs/redesign/`
- The current implementation of the surfaces being changed — at least skim them
- The theming and design-token setup if the work involves visual changes

This pass tells you what's already there, what naming conventions are in force, and what the integration surface looks like. Skipping it produces plans that name files conflicting with existing ones or assume primitives that don't exist.

## 3. Sketch the dependency graph, then pause

Before writing any files, write a short plan in the conversation that includes:

- The phase boundaries you propose (P0 → P1 → P2 → …) and what each phase delivers
- Within each phase, which work-items can run in parallel and which are sequential
- The contracts (typed surfaces) where one work-item's output feeds another's input
- Any open questions about the brief or codebase

Share this with the user and wait for confirmation before producing file artifacts. **This is the most important checkpoint in the whole workflow — if the decomposition is wrong, every downstream artifact is wrong.**

Pause and ask if:

- The brief is ambiguous about scope (which screens, which states, which user roles)
- The codebase doesn't have a primitive the design assumes (e.g. tokens that don't exist in the theme)
- There's a conflict between the design and existing conventions
- The work could plausibly be one phase or three and the choice is non-obvious

## 4. Produce `docs/redesign/work-phases.md`

Start from `agent-workflow-harness/templates/work-phases.template.md`. This file is the orchestrator's map. Fill the `**Repo:**` pin under the title with the repo's root folder name — `precheck` refuses to dispatch from a working directory that doesn't match it, which guards against wrong-repo session resumes. It contains three sections:

**Architectural rules** — the load-bearing constraints every execution agent must honor. Examples: "no `cva` for editorial primitives," "no barrel `index.ts` files," "no inline color hex values — theme tokens only," "no emoji in UI titles." Pull these from the codebase's existing conventions plus any rule the design imposes.

**Phase table** — one row per phase. Each row lists the phase ID, what the phase delivers, and which work-item IDs belong to it. Mark each work-item as `parallel` or `sequential` within its phase. Sequential items list their `Depends on:` predecessors.

**Progress checklist** — one `- [ ] Wx.y` line per work-item, grouped by phase. Execution agents flip these to `- [x]` when their item is done. The orchestrator reads this to verify dependencies before starting downstream phases. A phase counts as complete only when every item is `- [x]` **and** a passing `docs/redesign/phase-<id>-qa.md` exists on disk — the orchestrator enforces this with `node agent-workflow-harness/scripts/phase-guard.mjs` before advancing, so an all-checked phase with no QA artifact stays blocked.

## 5. Produce `docs/redesign/contracts.md`

Start from `agent-workflow-harness/templates/contracts.template.md`. This file pins the typed surfaces between work-items. For every producer/consumer relationship in the dependency graph, write down the exact shape:

- Signatures, in your project's language (TS types / Python hints / Go interfaces), for hooks, utilities, and functions produced by one item and consumed by another
- Prop / parameter shapes for components or modules shared across items
- Theme token names, scales, and intended use
- Route response shapes if backend and frontend items share an API surface

Be specific. A concrete signature like `useCmsForm(): { data: CmsRecord; loading: boolean }` (or its Python/Go equivalent) — not "a hook that returns form state." If a producer item hasn't decided the shape yet, that's a planning failure — decide it now or split the items differently.

## 6. Produce one `docs/redesign/work-item-<id>.md` per chunk

Each brief follows `agent-workflow-harness/templates/work-item.template.md`:

```
# Wx.y — <one-line goal>

**Phase:** Px
**Depends on:** Wx.y, Wx.z  (or "none")
**Parallel-safe within phase:** yes | no

## Goal
One paragraph. What does done look like for this item.

## Inputs to read before writing code
- docs/redesign/work-phases.md
- docs/redesign/contracts.md  (if this item produces or consumes a contract)
- <specific files in the codebase>
- <specific section of the design source>

## Files this item creates / edits
- src/.../Foo.tsx  (create)
- src/.../bar.ts   (edit)

## Requires        (only when the item needs anything from outside the repo)
- env: SERVICE_API_KEY — which call needs it
- cmd: node scripts/probe-service.mjs — must exit 0 (proves the external dependency is alive)

## Implementation notes
Concrete guidance — not the full implementation, but enough that the
executing agent doesn't have to guess at intent. Reference specific
sections of the design or contracts.md.

## Reference template / Reference JSX
Where the design specifies an exact output, paste the snippet here.
Execution agents are expected to match it verbatim.

## Acceptance criteria
- [ ] <code-shape check — exports X, signature/prop shape matches contracts.md>
- [ ] <code-shape check>
- [ ] <runtime check — the runtime verifier / Playwright sees Y on screen, state Z>   ← at least one for UI items
- [ ] <runtime verifier — every interactive control responds and the route stays live; `node agent-workflow-harness/scripts/run-gate.mjs` exits 0>   ← mandatory for UI items
- [ ] lint passes
- [ ] typecheck passes
- [ ] tests pass

## Out of scope
- <explicit guardrail — what this item must not touch>
- <bullet per guardrail>
```

Each work-item must have:

- At least one runtime acceptance criterion if the item produces UI
- A runtime-verifier acceptance criterion if the item produces UI — every interactive control responds and the route stays live; the configured runtime verifier passes (`node agent-workflow-harness/scripts/run-gate.mjs` exits 0). Rendering is not the same claim as responsiveness.
- Acceptance criteria phrased so each is checkable against an artifact — a command and its output, a `file:line`, a screenshot, or a gate's exit code — never a subjective "looks right." Downstream, both the executor and QA must be able to cite proof, not assert.
- An explicit out-of-scope section — silence here is a planning failure
- A clear list of files it creates and edits, used to detect cross-item file conflicts
- A `## Requires` section whenever the item touches anything outside the repo — API keys (`env:`), gitignored credential files (`file:`), a live external service / credit balance / migration state (`cmd:` probe). `precheck` verifies every line before dispatch, so a missing key blocks in seconds instead of mid-build; an undeclared external dependency that blocks an executor is a planning failure

## 7. Verify the plan is internally consistent

After producing all files, do one pass to check:

- Every work-item ID in the phase table has a brief
- Every brief's `Depends on:` references an ID that exists
- Every contract in `contracts.md` is produced by exactly one work-item and consumed by at least one
- No two parallel-marked work-items in the same phase edit the same file (cross-reference each brief's "Files this item creates / edits" section)
- The progress checklist matches the phase table

If any of these fails, fix it before handing off. Inconsistencies here become bugs at execution time.

## 8. Hand off

Tell the user the plan is ready and list the files produced. Do not start executing work-items yourself — that's the orchestrator session's job, running the `work-item` skill via subagents. Your job ends here.

## What this skill does not cover

- Implementation of any work-item — that's the `work-item` skill
- Orchestration of execution agents (spawning subagents, running phase QA) — that happens in a separate session
- Updating the plan once execution has started — if a work-item discovers the plan is wrong, the user re-invokes this skill on a scoped re-plan
