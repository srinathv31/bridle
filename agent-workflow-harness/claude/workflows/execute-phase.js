export const meta = {
  name: "execute-phase",
  description:
    "Build one phase end-to-end: read the phase plan deterministically (phase-items.mjs), dispatch work-item executors (parallel only when file sets are genuinely disjoint), run the whole-repo detector gate ONCE (run-gate.mjs: configured lint/typecheck/test + the runtime verifier) against a single dev server, QA in a SEPARATE agent (+ qa-check), then verify phase-guard. Returns a structured verdict and never advances to the next phase — the merge barrier is the caller's decision. App-agnostic: all stack verbs/paths come from harness.config.json.",
  phases: [
    {
      title: "Read plan",
      detail:
        "phase-items.mjs — deterministic item list + overlap-based parallel decision",
    },
    {
      title: "Build",
      detail:
        "one executor per item; parallel iff disjoint file sets, else serialized",
    },
    {
      title: "Gate",
      detail:
        "run-gate.mjs — configured lint/typecheck/test + runtime verifier, once, bounded fix loop",
    },
    {
      title: "QA",
      detail: "phase-qa in a separate agent + qa-check, bounded fix rounds",
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

// ─── target phase (accept 'P2' or { phase: 'P2' }) ───────────────────────────
const PHASE = (
  typeof args === "string" ? args : (args && args.phase) || ""
).toUpperCase();
if (!/^P\d+$/.test(PHASE)) {
  throw new Error(
    `execute-phase: pass a phase id like "P2" via args (got ${JSON.stringify(args)})`,
  );
}

// ─── schemas (validated at the tool layer; the model retries on a miss) ───────
const PLAN = {
  type: "object",
  required: ["phase", "mode", "parallelizable", "items"],
  properties: {
    phase: { type: "string" },
    mode: { type: "string" },
    parallelizable: { type: "boolean" },
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
  },
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
  `Run \`node ${HARNESS}/scripts/phase-items.mjs ${PHASE}\` and return its JSON output verbatim — it is a deterministic parser of the plan (item list, file sets, isUI, and an overlap-computed "parallelizable"). Do NOT reinterpret or change any value. If it exits non-zero, surface the error.`,
  { schema: PLAN, label: `read-plan:${PHASE}`, phase: "Read plan" },
);

const open = plan.items.filter((i) => !i.done);
if (plan.warnings && plan.warnings.length)
  log(`${PHASE} plan warnings: ${plan.warnings.join(" · ")}`);
log(
  `${PHASE}: mode=${plan.mode} · parallelizable=${plan.parallelizable} · ${open.length} open: ${open.map((i) => i.id).join(", ") || "none"}`,
);

// ─── stage 2: build (static self-check only; no per-item server) ──────────────
phase("Build");
async function build(item) {
  return agent(
    `Implement work-item ${item.id} following the work-item skill and its brief (default path docs/redesign/work-item-${item.id}.md; honor harness.config.json → planDir if customized). Read the brief end-to-end plus everything in its "Inputs to read" block, match contracts.md verbatim, and stay strictly inside its "Files this item creates / edits" list and "Out of scope" bullets. Maintain your heartbeat at the status dir (harness.config.json → statusDir, default docs/redesign/.status/${item.id}.json): state running→done, bump lastBeat/step, keep criteriaDone/filesTouched current.
Do STATIC self-checks only — run \`node ${HARNESS}/scripts/run-gate.mjs --no-runtime\` (configured lint + typecheck + test, no runtime verifier). Do NOT start a dev server or run the runtime verifier yourself — all runtime verification happens once at the phase gate, to avoid contention on the dev port. If the brief is ambiguous, set state "blocked" with a note instead of guessing.`,
    {
      agentType: "work-item-executor",
      schema: BUILD,
      label: `build:${item.id}`,
      phase: "Build",
    },
  );
}

// parallel ONLY when phase-items proved the open file sets disjoint; otherwise serialize.
let built;
if (plan.parallelizable) {
  built = (await parallel(open.map((it) => () => build(it)))).filter(Boolean);
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
  log(
    `${PHASE}: build stopped — ${ids || "an executor failed"} did not complete.`,
  );
  return {
    phase: PHASE,
    guarded: false,
    stoppedAt: "build",
    mode: plan.mode,
    items: built,
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
    { schema: GATE, label: `gate:${PHASE}`, phase: "Gate" },
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
    `Fix the phase ${PHASE} gate failures — ${failed}. These are whole-repo checks; attribute each failure to the owning work-item by its file path (phase file map: ${fileMap}) and fix within that item's scope, updating its heartbeat. A failing runtime verifier is a real defect in the app — fix the root cause, do not blame the tool. Do not run the gate yourself; it re-runs automatically after you.`,
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
while (true) {
  qaRound++;
  qa = await agent(
    `Run phase QA for ${PHASE} using the phase-qa skill (auto-detect thorough vs verify by checking for an existing phase-${PHASE}-qa*.md in the plan dir). READ-ONLY on production code. Run the full battery INCLUDING the runtime verifier (never skipped); a failing verifier verdict is a CRITICAL defect and is never downgraded to a tooling quirk. Write phase-${PHASE}-qa.md (in harness.config.json → planDir, default docs/redesign/) with every claim citing ground truth (path:line, real command output, or a screenshot that exists). Before returning, run \`node ${HARNESS}/scripts/qa-check.mjs <that report>\` and fix the report until it exits 0; report qaCheckPass accordingly.`,
    {
      agentType: "phase-qa",
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
      mode: plan.mode,
      items: built,
      qa,
      reason: "unresolved blocking defects or failing qa-check",
    };
  }

  if (blockers.length) {
    log(
      `${PHASE}: QA round ${qaRound} found ${blockers.length} blocking defect(s) (${BLOCK_SEVERITIES.join("/")}) — dispatching fixes, then re-QA (verify).`,
    );
    await parallel(
      blockers.map(
        (d) => () =>
          agent(
            `Fix the ${d.severity} defect phase-qa filed against ${PHASE}: "${d.title}" — ${d.detail || ""} (${d.location || "see report"}). Implement within the owning work-item's file scope, update its heartbeat, and re-verify locally.`,
            {
              agentType: "work-item-executor",
              label: `qa-fix:${d.id || d.title}`,
              phase: "QA",
            },
          ),
      ),
    );
  }
  // loop: re-run phase-qa (auto-detects verify mode)
}

// ─── stage 5: phase-guard — the merge barrier (the definition of "done") ──────
phase("Guard");
const guard = await agent(
  `Run \`node ${HARNESS}/scripts/phase-guard.mjs ${PHASE}\`. Report its exit code and output verbatim. Do not edit anything. guarded=true only if it exits 0 (every item [x] AND a phase-${PHASE}-qa.md that itself passes qa-check).`,
  { schema: GUARD, label: `phase-guard:${PHASE}`, phase: "Guard" },
);

log(
  `${PHASE}: phase-guard exit ${guard.exit} → ${guard.guarded ? "GUARDED" : "NOT guarded"}`,
);
return {
  phase: PHASE,
  guarded: guard.guarded,
  stoppedAt: guard.guarded ? "complete" : "guard",
  mode: plan.mode,
  items: built,
  qa: { reportPath: qa.reportPath, openDefects: qa.defects },
  guardExit: guard.exit,
  summary: guard.guarded
    ? `${PHASE} built, QA'd, and guarded. ${built.length} item(s) merged.`
    : `${PHASE} built and QA'd but phase-guard did not pass (exit ${guard.exit}).`,
};
