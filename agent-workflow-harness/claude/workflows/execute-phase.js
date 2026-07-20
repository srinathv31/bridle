export const meta = {
  name: "execute-phase",
  description:
    "Build one phase end-to-end: read the phase plan deterministically (phase-items.mjs), dispatch work-item executors (parallel only when file sets are genuinely disjoint; a dependency chain collapses into ONE sequential executor), run the whole-repo detector gate ONCE (run-gate.mjs: configured lint/typecheck/test + the runtime verifier) against a single dev server, QA in a SEPARATE agent (+ qa-check), then verify phase-guard. Returns a structured verdict and never advances to the next phase — the merge barrier is the caller's decision. Args: 'P2' or { phase, attempt, answers } — a blocked build surfaces the executors' questions in the verdict, and the conductor's answers re-enter the still-open items' prompts on the next attempt. App-agnostic: all stack verbs/paths come from harness.config.json.",
  phases: [
    {
      title: "Read plan",
      detail:
        "phase-items.mjs — deterministic item list + overlap-based parallel decision",
    },
    {
      title: "Build",
      detail:
        "parallel executors iff disjoint file sets; chained items collapse into ONE executor",
    },
    {
      title: "Gate",
      detail:
        "run-gate.mjs — configured lint/typecheck/test + runtime verifier, once, bounded fix loop",
    },
    {
      title: "QA",
      detail:
        "round 1: phase-qa functional gate; rounds 2+: phase-qa-verify (targeted, Sonnet); qa-check every round",
    },
    { title: "Guard", detail: "phase-guard is the merge barrier" },
  ],
};

// ─── tunables ────────────────────────────────────────────────────────────────
const MAX_FIX = 2; // gate fix attempts before giving up
const MAX_QA_ROUNDS = 2; // QA -> fix -> re-QA rounds for blocking defects
const HARNESS = "agent-workflow-harness"; // vendored kit path in the target repo
// Severities that BLOCK the barrier. Mirrors harness.config.json → gate.blockOn (default
// critical+major). A MAJOR load-bearing defect must not pass an autonomous barrier silently —
// this is the deliberate hardening over the original (which blocked on critical only).
const BLOCK_SEVERITIES = ["critical", "major"];

// ─── target: 'P2' or { phase, attempt?, answers? } ────────────────────────────
// The blocked-item protocol: a build that stops on ambiguity returns stoppedAt:"build"
// with a `questions` map (see stage 2). The conductor answers and re-invokes FRESH with
//   args: { phase, attempt: <n+1>, answers: { "<itemId>": "<answer>" } }
// No resumeFromRunId needed for this path — completed items already ticked their
// checklist boxes, so the re-read plan drops them from `open`, and the answers below are
// injected into the still-open items' prompts so the same ambiguity cannot block twice.
// (resumeFromRunId stays reserved for the conductor's stuck-kill recovery, where prompts
// are byte-identical and the cached prefix replays.)
// Named-workflow invocations can deliver args as a JSON-ENCODED STRING — parse before
// validating, or the { phase, attempt, answers } relaunch path above can never work. A bare
// "P2"-style string stays the phase-id shorthand; a malformed "{…" string falls through to
// the phase-id error below, which echoes the raw args.
let A = args || {};
if (typeof A === "string") {
  const s = A.trim();
  if (s.startsWith("{")) {
    try {
      A = JSON.parse(s);
    } catch {
      A = {};
    }
  } else {
    A = { phase: A };
  }
}
const PHASE = (A.phase || "").toUpperCase();
const ATTEMPT = Math.max(1, Number(A.attempt) || 1);
const ANSWERS = A.answers && typeof A.answers === "object" ? A.answers : {};
if (!/^P\d+$/.test(PHASE)) {
  throw new Error(
    `execute-phase: pass a phase id like "P2" (or { phase, attempt, answers }) via args (got ${JSON.stringify(args)})`,
  );
}
// On attempt >1 these make the re-run prompts unique, so even a caller who DOES pass
// resumeFromRunId can never replay a stale cached "blocked" result; on attempt 1 every
// prompt stays byte-identical to preserve the stuck-resume cache replay.
const ATTEMPT_TAG = ATTEMPT > 1 ? ` (attempt ${ATTEMPT})` : "";
const retryNote =
  ATTEMPT > 1
    ? " A prior attempt stopped mid-phase — read the current state of the assigned files first and complete rather than redo work that already landed."
    : "";
const answerFor = (id) =>
  ANSWERS[id]
    ? `\nAnswer to your prior blocking question (authoritative clarification from the conductor — treat it as part of the brief): ${ANSWERS[id]}`
    : "";

// ─── schemas (validated at the tool layer; the model retries on a miss) ───────
const PLAN = {
  type: "object",
  required: ["phase", "mode", "parallelizable", "items"],
  properties: {
    phase: { type: "string" },
    mode: { type: "string" },
    parallelizable: { type: "boolean" },
    // dependency-collapsed dispatch groups over the OPEN items: each inner array is one
    // executor's assignment, topologically ordered (a multi-item group is a chain)
    groups: { type: "array", items: { type: "array", items: { type: "string" } } },
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "done", "isUI", "files"],
        properties: {
          id: { type: "string" },
          done: { type: "boolean" },
          isUI: { type: "boolean" },
          dependsOn: { type: "array", items: { type: "string" } },
          files: { type: "array", items: { type: "string" } },
        },
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
};

const BUILD = {
  type: "object",
  required: ["id", "state"],
  properties: {
    id: { type: "string" },
    state: { type: "string", enum: ["done", "blocked"] },
    filesTouched: { type: "array", items: { type: "string" } },
    note: { type: "string" },
    // the ONE question whose answer unblocks the item — expected whenever state="blocked"
    question: { type: "string" },
  },
};

// A dependency chain (one dispatch group) returns one entry per item from a single executor.
const BUILD_CHAIN = {
  type: "object",
  required: ["items"],
  properties: { items: { type: "array", items: BUILD } },
};

const GATE = {
  type: "object",
  required: ["pass", "failures"],
  properties: {
    pass: { type: "boolean" },
    failures: {
      type: "array",
      items: {
        type: "object",
        required: ["cmd", "exit"],
        properties: {
          cmd: { type: "string" },
          exit: { type: "integer" },
          file: { type: "string" },
          excerpt: { type: "string" },
        },
      },
    },
  },
};

const QA = {
  type: "object",
  required: ["reportPath", "qaCheckPass", "defects"],
  properties: {
    reportPath: { type: "string" },
    qaCheckPass: { type: "boolean" },
    defects: {
      type: "array",
      items: {
        type: "object",
        required: ["title", "severity"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          severity: { type: "string", enum: ["critical", "major", "minor"] },
          location: { type: "string" },
          detail: { type: "string" },
        },
      },
    },
  },
};

const GUARD = {
  type: "object",
  required: ["guarded", "exit"],
  properties: {
    guarded: { type: "boolean" },
    exit: { type: "integer" },
    output: { type: "string" },
  },
};

// ─── stage 1: read the plan deterministically ────────────────────────────────
phase("Read plan");
const plan = await agent(
  `Run \`node ${HARNESS}/scripts/phase-items.mjs ${PHASE}\` and return its JSON output verbatim — it is a deterministic parser of the plan (item list, file sets, isUI, dependency-collapsed dispatch "groups", and an overlap-computed "parallelizable"). Do NOT reinterpret or change any value. If it exits non-zero, surface the error.${ATTEMPT_TAG}`,
  {
    schema: PLAN,
    label: `read-plan:${PHASE}`,
    phase: "Read plan",
    // pure script wrapper — runs one deterministic command and relays JSON
    model: "haiku",
    effort: "low",
  },
);

const open = plan.items.filter((i) => !i.done);
// Dependency-collapsed dispatch groups (id arrays → item arrays, topological order kept).
// A multi-item group is a chain ONE executor builds in order — dispatching its members as
// parallel siblings would race a dependent against its prerequisite. Fallback for a plan
// without `groups` (older phase-items): every open item is its own group.
const groups = (
  plan.groups && plan.groups.length ? plan.groups : open.map((i) => [i.id])
)
  .map((g) => g.map((id) => open.find((i) => i.id === id)).filter(Boolean))
  .filter((g) => g.length);
if (plan.warnings && plan.warnings.length)
  log(`${PHASE} plan warnings: ${plan.warnings.join(" · ")}`);
log(
  `${PHASE}: mode=${plan.mode} · parallelizable=${plan.parallelizable} · ${open.length} open: ${groups.map((g) => g.map((i) => i.id).join("→")).join(" · ") || "none"}`,
);

// ─── stage 2: build (static self-check only; no per-item server) ──────────────
phase("Build");
async function build(item) {
  return agent(
    `Implement work-item ${item.id} following the work-item skill and its brief (default path docs/redesign/work-item-${item.id}.md; honor harness.config.json → planDir if customized). Read the brief end-to-end plus everything in its "Inputs to read" block, match contracts.md verbatim, and stay strictly inside its "Files this item creates / edits" list and "Out of scope" bullets. Maintain your heartbeat at the status dir (harness.config.json → statusDir, default docs/redesign/.status/${item.id}.json): state running→done, bump lastBeat/step, keep criteriaDone/filesTouched current.
Do STATIC self-checks only — run \`node ${HARNESS}/scripts/run-gate.mjs --no-runtime\` (configured lint + typecheck + test, no runtime verifier). Do NOT start a dev server or run the runtime verifier yourself — all runtime verification happens once at the phase gate, to avoid contention on the dev port. If the brief is ambiguous, set state "blocked" with a note and the ONE question whose answer unblocks you in "question" — do not guess.${retryNote}${answerFor(item.id)}`,
    {
      agentType: "work-item-executor",
      schema: BUILD,
      label: `build:${item.id}`,
      phase: "Build",
    },
  );
}

// One executor for the whole chain when items can't run in parallel: N sequential
// executors each pay full context spin-up (briefs, contracts, design source) and re-read
// files the previous agent just wrote — measured at ~150k redundant tokens on a 3-item phase.
async function buildChain(items) {
  const ids = items.map((i) => i.id);
  const answered = ids.filter((id) => ANSWERS[id]);
  const chainAnswers = answered.length
    ? `\nAnswers to prior blocking questions (authoritative clarifications from the conductor — treat them as part of the briefs): ${answered.map((id) => `${id}: ${ANSWERS[id]}`).join(" · ")}`
    : "";
  const chain = await agent(
    `Implement work-items ${ids.join(", ")} of phase ${PHASE} — all of them, one at a time, in exactly that order (it is a dependency chain). For EACH item in turn: follow the work-item skill and its brief (default path docs/redesign/work-item-<id>.md; honor harness.config.json → planDir if customized), read the brief end-to-end plus everything in its "Inputs to read" block, match contracts.md verbatim, and stay strictly inside its "Files this item creates / edits" list and "Out of scope" bullets. Maintain a heartbeat PER ITEM at the status dir (harness.config.json → statusDir, default docs/redesign/.status/<id>.json): state running→done, bump lastBeat/step, keep criteriaDone/filesTouched current. Read shared inputs (contracts.md, design source) ONCE — do not re-read them per item.
After each item, run the configured typecheck (harness.config.json → runner.typecheck); after the FINAL item, run \`node ${HARNESS}/scripts/run-gate.mjs --no-runtime\` once (configured lint + typecheck + test, no runtime verifier). Do NOT start a dev server or run the runtime verifier yourself — all runtime verification happens once at the phase gate. If a brief is ambiguous, mark that item "blocked" with a note and the ONE question whose answer unblocks it in its "question" field, do not guess, and do NOT attempt items that depend on it — mark those "blocked" too (their "question" can be "blocked by <id>"). Return one entry per assigned item.${retryNote}${chainAnswers}`,
    {
      agentType: "work-item-executor",
      schema: BUILD_CHAIN,
      label: `build:${ids.join("+")}`,
      phase: "Build",
    },
  );
  return (chain && chain.items) || [];
}

// parallel ONLY when phase-items proved the groups' file sets disjoint ACROSS groups —
// then the groups run concurrently, and a multi-item group (dependency chain) still
// serializes inside its single executor. Otherwise ONE executor builds everything in
// dependency order.
let built;
if (plan.parallelizable) {
  built = (
    await parallel(
      groups.map((g) => () => (g.length > 1 ? buildChain(g) : build(g[0]))),
    )
  )
    .flat()
    .filter(Boolean);
} else if (open.length > 1) {
  built = await buildChain(groups.flat());
} else {
  built = [];
  for (const it of open) built.push(await build(it));
}

const buildProblem = built.filter((b) => !b || b.state === "blocked");
if (buildProblem.length || built.length < open.length) {
  const ids = buildProblem
    .map((b) => b && b.id)
    .filter(Boolean)
    .join(", ");
  const questions = {};
  for (const b of built)
    if (b && b.state === "blocked" && (b.question || b.note))
      questions[b.id] = b.question || b.note;
  log(
    `${PHASE}: build stopped — ${ids || "an executor failed"} did not complete.`,
  );
  return {
    phase: PHASE,
    guarded: false,
    stoppedAt: "build",
    attempt: ATTEMPT,
    mode: plan.mode,
    items: built,
    questions,
    resume: `answer the question(s), then re-run FRESH (no resumeFromRunId): Workflow({ name: "execute-phase", args: { phase: "${PHASE}", attempt: ${ATTEMPT + 1}, answers: { "<itemId>": "<answer>" } } }) — completed items are already ticked and will be skipped; the answers are injected into the blocked items' prompts`,
    reason: `build incomplete: ${ids || "executor failure"}`,
  };
}

// ─── stage 3: ONE whole-repo gate against ONE dev server, bounded fix loop ────
phase("Gate");
const anyUI = open.some((i) => i.isUI);
const fileMap = open.map((i) => `${i.id}:[${i.files.join(", ")}]`).join(" ; ");

async function runGate() {
  return agent(
    `Run the whole-repo detector gate for ${PHASE}: \`node ${HARNESS}/scripts/run-gate.mjs\`. ${anyUI ? "First ensure the app is up: start the configured dev command (harness.config.json → runner.dev) in the background and wait until it responds (runtime.web.baseUrl) before the gate runs the runtime verifier. " : "This phase has no UI items; you may pass --no-runtime. "}run-gate runs the configured lint/typecheck/test verbs PLUS the runtime verifier (harness.config.json → runtime.verifier) and prints a JSON verdict {pass, failures}. A failing runtime verifier (e.g. a web FROZEN verdict) is a CRITICAL defect — never excuse it as a tooling limitation. You are a DETECTOR, not a builder — do not edit production code. Return pass=true only if run-gate exited 0; otherwise list each failure with its exit code, the offending file path if known, and a short excerpt.`,
    {
      schema: GATE,
      label: `gate:${PHASE}`,
      phase: "Gate",
      // mechanical detector (start server, run script, relay verdict) — but it manages a
      // background dev server, so keep medium effort rather than low
      model: "haiku",
      effort: "medium",
    },
  );
}

let gate = await runGate();
let fixes = 0;
while (!gate.pass && fixes < MAX_FIX) {
  fixes++;
  const failed = gate.failures
    .map(
      (f) =>
        `${f.cmd} (exit ${f.exit})${f.file ? ` @ ${f.file}` : ""}: ${f.excerpt || ""}`,
    )
    .join(" | ");
  await agent(
    `Fix the phase ${PHASE} gate failures — ${failed}. These are whole-repo checks; attribute each failure to the owning work-item by its file path (phase file map: ${fileMap}) and fix within that item's scope, updating its heartbeat. A failing runtime verifier is a real defect in the app — fix the root cause, do not blame the tool. Verify your fix with STATIC checks only (\`node ${HARNESS}/scripts/run-gate.mjs --no-runtime\`); do NOT start a dev server or drive a browser — the full gate, runtime verifier included, re-runs automatically after you.`,
    {
      agentType: "work-item-executor",
      label: `gate-fix:${PHASE}#${fixes}`,
      phase: "Gate",
    },
  );
  gate = await runGate();
}
if (!gate.pass) {
  log(
    `${PHASE}: gate still failing after ${MAX_FIX} fix attempt(s) — stopping before QA.`,
  );
  return {
    phase: PHASE,
    guarded: false,
    stoppedAt: "gate",
    attempt: ATTEMPT,
    mode: plan.mode,
    items: built,
    gate,
    reason: "gate not green",
  };
}

// ─── stage 4: QA in a SEPARATE agent + qa-check + bounded fix rounds ──────────
phase("QA");
let qa;
let qaRound = 0;
let lastBlockers = [];
while (true) {
  qaRound++;
  const thorough = qaRound === 1;
  // Round 1: phase-qa (Opus) runs the functional-gate battery. Rounds 2+: phase-qa-verify
  // (Sonnet) does a targeted fix-verification — re-running the full battery to check one
  // fix was measured at ~14min/143k tokens vs ~4min targeted.
  const fixedList = lastBlockers
    .map(
      (d) =>
        `${d.id ? d.id + " " : ""}"${d.title}"${d.location ? ` (${d.location})` : ""}`,
    )
    .join("; ");
  qa = await agent(
    thorough
      ? `Run phase QA for ${PHASE} using the phase-qa skill in thorough mode (this is pass 1 — no phase-${PHASE}-qa*.md should exist yet). READ-ONLY on production code. This is a FUNCTIONAL GATE, not a polish pass: run the skill's functional-gate battery INCLUDING the runtime verifier (never skipped); a failing verifier verdict is a CRITICAL defect and is never downgraded to a tooling quirk. Exhaustive edge-case probing and detailed design diff belong to the separate polish-qa skill — do not do them here. Known minors: read defect-ledger.md in the plan dir FIRST and do not re-prove or re-report anything listed there; append NEW minors to it per its header protocol. Write phase-${PHASE}-qa.md (in harness.config.json → planDir, default docs/redesign/) with every claim citing ground truth (path:line, real command output, or a screenshot that exists). Before returning, run \`node ${HARNESS}/scripts/qa-check.mjs <that report>\` and fix the report until it exits 0; report qaCheckPass accordingly.`
      : `Run verify-mode phase QA for ${PHASE} using the phase-qa skill (a prior phase-${PHASE}-qa*.md exists). READ-ONLY on production code. This is a TARGETED pass, not the full battery: (1) run the runtime verifier (never skipped; FROZEN/FAIL = CRITICAL), (2) verify each just-fixed defect at source and runtime — this round's fixes: ${fixedList || "see the prior pass file's open defects"}, (3) static typecheck+build, (4) one smoke screenshot per touched surface. New minors go to defect-ledger.md per its header protocol (never re-prove minors already listed there). Write the pass file per the skill (phase-${PHASE}-qa-pass<N>.md) AND annotate the base phase-${PHASE}-qa.md — mark each verified-fixed defect RESOLVED with fix evidence and update its counts line, since phase-guard gates on that base file. Run \`node ${HARNESS}/scripts/qa-check.mjs\` on both files until each exits 0; report qaCheckPass accordingly. In your returned defects array, list ONLY defects still open (still-broken priors + new finds) — do not re-list resolved ones.`,
    {
      agentType: thorough ? "phase-qa" : "phase-qa-verify",
      schema: QA,
      label: `phase-qa:${PHASE}#${qaRound}`,
      phase: "QA",
    },
  );

  // Block on the configured severities (default critical+major), not critical-only.
  const blockers = qa.defects.filter((d) =>
    BLOCK_SEVERITIES.includes(d.severity),
  );
  if (qa.qaCheckPass && blockers.length === 0) break;

  if (qaRound >= MAX_QA_ROUNDS) {
    log(
      `${PHASE}: ${blockers.length} blocking defect(s) / qa-check=${qa.qaCheckPass} still open after ${MAX_QA_ROUNDS} round(s) — stopping for human.`,
    );
    return {
      phase: PHASE,
      guarded: false,
      stoppedAt: "qa",
      attempt: ATTEMPT,
      mode: plan.mode,
      items: built,
      qa,
      reason: "unresolved blocking defects or failing qa-check",
    };
  }

  if (blockers.length) {
    lastBlockers = blockers;
    log(
      `${PHASE}: QA round ${qaRound} found ${blockers.length} blocking defect(s) (${BLOCK_SEVERITIES.join("/")}) — dispatching fixes, then re-QA (verify).`,
    );
    await parallel(
      blockers.map(
        (d) => () =>
          agent(
            `Fix the ${d.severity} defect phase-qa filed against ${PHASE}: "${d.title}" — ${d.detail || ""} (${d.location || "see report"}). Implement within the owning work-item's file scope, update its heartbeat, and re-verify with STATIC checks only (\`node ${HARNESS}/scripts/run-gate.mjs --no-runtime\`) — do NOT start a dev server or drive a browser; the QA verify round re-checks your fix at runtime immediately after.`,
            {
              agentType: "work-item-executor",
              label: `qa-fix:${d.id || d.title}`,
              phase: "QA",
            },
          ),
      ),
    );
  }
  // loop: next round dispatches phase-qa-verify (targeted) against the fixes above
}

// ─── stage 5: phase-guard — the merge barrier (the definition of "done") ──────
phase("Guard");
const guard = await agent(
  `Run \`node ${HARNESS}/scripts/phase-guard.mjs ${PHASE}\`. Report its exit code and output verbatim. Do not edit anything. guarded=true only if it exits 0 (every item [x] AND a phase-${PHASE}-qa.md that itself passes qa-check).`,
  {
    schema: GUARD,
    label: `phase-guard:${PHASE}`,
    phase: "Guard",
    // pure script wrapper — runs one deterministic command and relays exit/output
    model: "haiku",
    effort: "low",
  },
);

log(
  `${PHASE}: phase-guard exit ${guard.exit} → ${guard.guarded ? "GUARDED" : "NOT guarded"}`,
);
return {
  phase: PHASE,
  guarded: guard.guarded,
  stoppedAt: guard.guarded ? "complete" : "guard",
  attempt: ATTEMPT,
  mode: plan.mode,
  items: built,
  qa: { reportPath: qa.reportPath, openDefects: qa.defects },
  guardExit: guard.exit,
  summary: guard.guarded
    ? `${PHASE} built, QA'd, and guarded. ${built.length} item(s) merged.`
    : `${PHASE} built and QA'd but phase-guard did not pass (exit ${guard.exit}).`,
};
