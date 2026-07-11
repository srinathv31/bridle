#!/usr/bin/env node
// drive-phase.mjs — the deterministic conductor for the Codex edition. Replaces the model-driven
// orchestrator with a plain Node loop: every dispatch decision comes from the trust scripts'
// exit codes and JSON, never from prose. Work-items and QA run as separate `codex exec` sessions
// (the role separation the harness requires); this process runs the gates and the barrier itself.
//
//   node codex/drive-phase.mjs P2                       # build ONE phase, stop at the barrier
//   node codex/drive-phase.mjs --auto                   # lowest open phase → last phase
//   node codex/drive-phase.mjs --auto --from P1 --to P4 # bounded range
//   node codex/drive-phase.mjs --check                  # setup probe: config, codex binary, plan
//   node codex/drive-phase.mjs P2 --dry-run             # print the dispatch plan, spawn nothing
//   Flags: --serial (force serial dispatch) · --max-fix-rounds N · --max-qa-rounds N
//
// Per phase: precheck → phase-items (parallel-safety from REAL file overlap) → one codex exec
// per open item, in dependency waves → ONE whole-repo gate (this process owns the dev server;
// ≤2 fix rounds) → QA in a fresh codex exec with network to drive localhost (≤2 rounds) →
// phase-guard. Auto never means skip the gate: any unguarded barrier stops the run dead.
//
// Sandbox contract: executor children get workspace-write with NO network (static self-checks
// only — the skill says so too); QA children get workspace-write plus
// sandbox_workspace_write.network_access=true so the browser legs can reach runtime.web.baseUrl.
//
// Model routing (optional) — harness.config.json:
//   "codex": { "bin": "codex", "models": { "executor": "", "qa": "" },
//              "sandbox": "workspace-write", "extraArgs": [], "itemTimeoutMinutes": 45 }
// Empty model strings fall through to your ~/.codex/config.toml default.
//
// Exit: 0 = every phase in range guarded · 1 = stopped/escalated · 2 = setup.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, createWriteStream } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../lib/config.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, "..", "scripts");

const cfg = loadConfig();
const CODEX = {
  bin: process.env.CODEX_BIN || cfg.codex?.bin || "codex",
  models: { executor: "", qa: "", ...(cfg.codex?.models || {}) },
  sandbox: cfg.codex?.sandbox || "workspace-write",
  extraArgs: cfg.codex?.extraArgs || [],
  itemTimeoutMinutes: cfg.codex?.itemTimeoutMinutes ?? 45,
};

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : d);
const AUTO = has("--auto");
const DRY = has("--dry-run");
const CHECK = has("--check");
const SERIAL = has("--serial");
const MAX_FIX = Number(val("--max-fix-rounds", 2));
const MAX_QA = Number(val("--max-qa-rounds", 2));
const phaseArg = argv.find((a) => cfg.phaseArgRe.test(a))?.toUpperCase() || null;

const log = (m) => console.log(m);
const step = (m) => console.log(`\n── ${m}`);
const fail = (m, code = 1) => {
  console.error(`\ndrive-phase: STOP — ${m}`);
  process.exit(code);
};

const LOG_DIR = join(cfg.statusDirAbs, "logs");

// ── trust-script plumbing (exit code is the contract) ────────────────────────
function script(name, args = [], opts = {}) {
  const r = spawnSync(process.execPath, [join(SCRIPTS, `${name}.mjs`), ...args], {
    cwd: cfg.root,
    encoding: "utf8",
    ...opts,
  });
  return { exit: r.status ?? 127, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function phaseItems(phase) {
  const r = script("phase-items", [phase]);
  if (r.exit !== 0) fail(`phase-items ${phase} exit ${r.exit}: ${r.stderr.trim()}`, 2);
  return JSON.parse(r.stdout);
}

// ── codex exec plumbing ───────────────────────────────────────────────────────
function codexArgs({ model, network }) {
  const args = ["exec", "--sandbox", CODEX.sandbox];
  if (network) args.push("-c", "sandbox_workspace_write.network_access=true");
  if (model) args.push("--model", model);
  args.push(...CODEX.extraArgs);
  return args;
}

// One codex exec session; resolves { exit, timedOut, log }. Never rejects — the caller decides
// what a failure means. All child output streams to a log file under statusDir/logs/.
function codexExec(label, prompt, { model = "", network = false } = {}) {
  mkdirSync(LOG_DIR, { recursive: true });
  const logPath = join(LOG_DIR, `${label}.log`);
  const lastMsg = join(LOG_DIR, `${label}.last.md`);
  const args = [...codexArgs({ model, network }), "--output-last-message", lastMsg, prompt];
  log(`  ▶ codex exec [${label}]${model ? ` model=${model}` : ""}${network ? " +network" : ""} → ${cfg.rel(logPath)}`);
  if (DRY) return Promise.resolve({ exit: 0, timedOut: false, log: logPath, dryRun: true });

  return new Promise((resolve) => {
    const out = createWriteStream(logPath);
    const child = spawn(CODEX.bin, args, { cwd: cfg.root, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.pipe(out);
    child.stderr.pipe(out);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ exit: 124, timedOut: true, log: logPath });
    }, CODEX.itemTimeoutMinutes * 60_000);
    child.on("error", (e) => {
      clearTimeout(timer);
      out.end(`\n[drive-phase] spawn error: ${e.message}\n`);
      resolve({ exit: 127, timedOut: false, log: logPath, error: e.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      out.end();
      resolve({ exit: code ?? 1, timedOut: false, log: logPath });
    });
  });
}

// ── prompts (the skill files carry the role rules; the prompt carries the assignment) ─────────
function executorPrompt(id) {
  return [
    `You are a work-item executor in this repo's build/QA harness. Load the work-item skill at .agents/skills/work-item/SKILL.md and follow it end-to-end for work-item ${id}.`,
    `Read the brief at ${cfg.planDir}/work-item-${id}.md plus everything in its "Inputs to read" block; match contracts.md verbatim; stay strictly inside its "Files this item creates / edits" list and "Out of scope" bullets.`,
    `Maintain your heartbeat at ${cfg.statusDir}/${id}.json (real clock reads only).`,
    `Run STATIC self-checks only (node codex-workflow-harness/scripts/run-gate.mjs --no-runtime) — your sandbox has no network; do NOT start a dev server. Runtime verification happens once at the phase gate, run by the conductor.`,
    `If the brief is ambiguous, set state "blocked" with a note and finish instead of guessing.`,
    `When done: flip ${id} to [x] in ${cfg.planDir}/work-phases.md, set your status file to state "done".`,
  ].join("\n");
}

function fixPrompt(id, round, failures) {
  const detail = failures
    .map((f) => `- ${f.cmd}${f.command ? ` (${f.command})` : ""} exit ${f.exit}\n  ${(f.excerpt || "").slice(0, 900)}`)
    .join("\n");
  return [
    `You are a work-item executor in this repo's build/QA harness (fix round ${round}). Load the work-item skill at .agents/skills/work-item/SKILL.md; this is an INLINE DEFECT BRIEF for work-item ${id} — there is no brief file for the fix itself.`,
    `The whole-repo gate failed. Failing checks:\n${detail}`,
    `A failing runtime verifier is a real defect in the app — fix the root cause; never blame Playwright, the browser, or tooling.`,
    `Stay as close as possible to the files of work-item ${id} (brief: ${cfg.planDir}/work-item-${id}.md). Fix causes, not symptoms — no suppression comments.`,
    `Your sandbox has no network: verify with node codex-workflow-harness/scripts/run-gate.mjs --no-runtime; the conductor re-runs the full gate after you.`,
    `Do NOT tick or untick any checklist box. Maintain a heartbeat at ${cfg.statusDir}/${id}-fix.json.`,
  ].join("\n");
}

function qaPrompt(phase, mode, priorReport) {
  const skill = mode === "thorough" ? "phase-qa" : "qa-verify";
  return [
    `You are the phase QA agent for this repo's build/QA harness. Load the ${skill} skill at .agents/skills/${skill}/SKILL.md and run it end-to-end for phase ${phase}.`,
    mode === "thorough"
      ? `Write the report to ${cfg.planDir}/phase-${phase}-qa.md.`
      : `The most recent pass file is ${priorReport}. Write the next pass file per the skill's numbering.`,
    `The dev server is already serving ${cfg.runtime.web.baseUrl} (the conductor owns it — do not start another); your sandbox has network access to reach it.`,
    `The **Counts:** line of your report is machine-read: keep the "N critical · N major · N minor" format exactly, counting OPEN defects.`,
    `Run node codex-workflow-harness/scripts/qa-check.mjs on your report until it exits 0 before finishing. Never edit production code.`,
  ].join("\n");
}

function defectFixPrompt(phase, report, counts, round) {
  return [
    `You are a work-item executor in this repo's build/QA harness (QA fix round ${round}). Load the work-item skill at .agents/skills/work-item/SKILL.md; your assignment is an INLINE DEFECT set, not a brief file.`,
    `The QA report at ${report} found open blocking defects (${counts}). Read the report's defect list; fix every defect whose severity is in ${JSON.stringify(cfg.gate.blockOn)}, using each defect's Observed/Expected/Reproduction as the brief.`,
    `Honor the originating work-items' file scopes and contracts.md. Fix causes, not symptoms. Do NOT edit the QA report and do NOT tick checklist boxes.`,
    `Your sandbox has no network: verify with node codex-workflow-harness/scripts/run-gate.mjs --no-runtime; a fresh QA pass re-verifies at runtime after you.`,
    `Maintain a heartbeat at ${cfg.statusDir}/${phase}-qafix.json.`,
  ].join("\n");
}

// ── dev server (this process owns it; ONE server per phase, never one per executor) ──────────
async function baseUrlUp(ms = 2500) {
  try {
    const res = await fetch(cfg.runtime.web.baseUrl, { signal: AbortSignal.timeout(ms) });
    return !!res;
  } catch {
    return false;
  }
}

async function ensureDevServer() {
  if (cfg.runtime.verifier === "none") return { started: false, kill() {} };
  if (await baseUrlUp()) {
    log(`  • dev server already serving ${cfg.runtime.web.baseUrl}`);
    return { started: false, kill() {} };
  }
  if (!cfg.runner.dev) fail(`runtime.verifier is "${cfg.runtime.verifier}" but ${cfg.runtime.web.baseUrl} is down and runner.dev is empty — start the app or fix harness.config.json`, 2);
  if (DRY) return { started: false, kill() {} };
  mkdirSync(LOG_DIR, { recursive: true });
  const out = createWriteStream(join(LOG_DIR, "dev-server.log"));
  const child = spawn(cfg.runner.dev, { shell: true, cwd: cfg.root, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(out);
  child.stderr.pipe(out);
  log(`  • started dev server (${cfg.runner.dev}) → ${cfg.rel(join(LOG_DIR, "dev-server.log"))}`);
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    if (await baseUrlUp()) return { started: true, kill: () => killTree(child) };
    if (child.exitCode !== null) fail(`dev server exited (${child.exitCode}) before ${cfg.runtime.web.baseUrl} responded — see ${cfg.rel(join(LOG_DIR, "dev-server.log"))}`, 2);
  }
  killTree(child);
  fail(`dev server never answered at ${cfg.runtime.web.baseUrl} after 120s`, 2);
}

function killTree(child) {
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {}
  }
}

// ── QA report discovery + the machine-read Counts line ───────────────────────
function latestReport(phase) {
  const first = cfg.reportPath(phase);
  if (!existsSync(cfg.planDirAbs)) return null;
  const passes = readdirSync(cfg.planDirAbs)
    .map((f) => f.match(new RegExp(`^phase-${phase}-qa-pass(\\d+)\\.md$`, "i")))
    .filter(Boolean)
    .map((m) => ({ n: Number(m[1]), path: join(cfg.planDirAbs, m[0]) }))
    .sort((a, b) => b.n - a.n);
  if (passes.length) return { path: passes[0].path, pass: passes[0].n };
  return existsSync(first) ? { path: first, pass: 1 } : null;
}

function openBlockingDefects(reportPath) {
  const text = readFileSync(reportPath, "utf8");
  const line = text.match(/^\*\*Counts:\*\*(.+)$/im)?.[1];
  if (!line) return { counts: null, blocking: null, raw: "no **Counts:** line found" };
  const n = (sev) => Number(line.match(new RegExp(`(\\d+)\\s*${sev}`, "i"))?.[1] ?? 0);
  const counts = { critical: n("critical"), major: n("major"), minor: n("minor") };
  const blocking = (cfg.gate.blockOn || ["critical", "major"]).reduce((s, sev) => s + (counts[sev] || 0), 0);
  return { counts, blocking, raw: line.trim() };
}

// ── phase enumeration for --auto ─────────────────────────────────────────────
function allPhases() {
  const content = readFileSync(cfg.workPhasesAbs, "utf8");
  const seen = new Map(); // phase → {total, done}
  const re = cfg.itemRe();
  let m;
  while ((m = re.exec(content)) !== null) {
    const phase = cfg.phaseLabel(m.groups.phase);
    const e = seen.get(phase) || { total: 0, done: 0 };
    e.total++;
    if (m[1].toLowerCase() === "x") e.done++;
    seen.set(phase, e);
  }
  const num = (p) => Number(p.match(/\d+/)?.[0] ?? 0);
  return [...seen.entries()].map(([phase, e]) => ({ phase, ...e })).sort((a, b) => num(a.phase) - num(b.phase));
}

// ── executor dispatch: dependency waves, parallel only when PROVEN safe ──────
async function runExecutors(phase, plan) {
  const completed = new Set(plan.items.filter((i) => i.done).map((i) => i.id));
  let open = plan.items.filter((i) => !i.done);
  const parallel = plan.parallelizable && !SERIAL;

  while (open.length) {
    const ready = open.filter((i) => i.dependsOn.every((d) => completed.has(d) || !plan.items.some((x) => x.id === d)));
    if (!ready.length) fail(`${phase}: items ${open.map((i) => i.id).join(", ")} have unmet in-phase dependencies (cycle?)`);
    const wave = parallel ? ready : [ready[0]];
    log(`  wave: ${wave.map((i) => i.id).join(", ")}${parallel && wave.length > 1 ? " (parallel — disjoint file sets proven)" : ""}`);

    for (const item of wave) {
      const pre = script("precheck", [item.id]);
      if (pre.exit !== 0) fail(`${phase}: precheck ${item.id} refused the dispatch (exit ${pre.exit})\n${pre.stdout}${pre.stderr}`);
    }

    const results = await Promise.all(wave.map((item) => codexExec(item.id, executorPrompt(item.id), { model: CODEX.models.executor })));

    for (let k = 0; k < wave.length; k++) {
      const item = wave[k];
      let r = results[k];
      let ok = executorSucceeded(phase, item.id, r);
      if (!ok) {
        log(`  ✗ ${item.id} ${r.timedOut ? `timed out after ${CODEX.itemTimeoutMinutes}m` : `failed (exit ${r.exit})`} — one re-dispatch with handoff state`);
        const handoff = readHandoff(item.id);
        r = await codexExec(`${item.id}-retry`, executorPrompt(item.id) + `\nPrior attempt ${r.timedOut ? "timed out" : "failed"}. Its handoff state: ${handoff}. Resume from criteriaDone/filesTouched — do not redo finished work. You MUST tick the checklist box when done.`, { model: CODEX.models.executor });
        ok = executorSucceeded(phase, item.id, r);
      }
      if (!ok) fail(`${phase}: ${item.id} still not done after one re-dispatch — see ${cfg.rel(r.log)} and ${cfg.statusDir}/${item.id}.json (escalate to a human)`);
      log(`  ✓ ${item.id} done (checklist ticked)`);
      completed.add(item.id);
    }
    open = open.filter((i) => !completed.has(i.id));
  }

  const status = script("subagent-status", []);
  if (status.stdout.trim()) log(status.stdout.trim().split("\n").map((l) => `  ${l}`).join("\n"));
}

function executorSucceeded(phase, id, r) {
  if (DRY) return true;
  if (r.exit !== 0) return false;
  // trust the artifact, not the session's exit: the checklist tick is the claim that counts
  const fresh = phaseItems(phase);
  return !!fresh.items.find((i) => i.id === id)?.done;
}

function readHandoff(id) {
  try {
    const s = JSON.parse(readFileSync(join(cfg.statusDirAbs, `${id}.json`), "utf8"));
    return JSON.stringify({ step: s.step, criteriaDone: s.criteriaDone, filesTouched: s.filesTouched, note: s.note });
  } catch {
    return "(no heartbeat file)";
  }
}

// ── the gate: ONE whole-repo detector pass, ≤MAX_FIX fix rounds ───────────────
async function runGate(phase, plan) {
  const hasUI = plan.items.some((i) => i.isUI);
  const gateArgs = hasUI ? ["--json"] : ["--json", "--no-runtime"];
  let server = { started: false, kill() {} };
  if (hasUI) server = await ensureDevServer();

  try {
    for (let round = 0; round <= MAX_FIX; round++) {
      const r = script("run-gate", gateArgs);
      let verdict;
      try {
        verdict = JSON.parse(r.stdout);
      } catch {
        fail(`run-gate emitted unparseable output (exit ${r.exit}): ${r.stdout.slice(0, 400)}${r.stderr.slice(0, 400)}`, 2);
      }
      if (r.exit === 0) {
        log(`  ✓ gate PASS (${verdict.ran.join(" + ")}${verdict.runtime ? ` + runtime:${verdict.runtime.verifier}` : ""})${round ? ` after ${round} fix round(s)` : ""}`);
        return { rounds: round };
      }
      if (r.exit === 2) fail(`gate: verifier setup error — ${JSON.stringify(verdict.failures)}`, 2);
      if (round === MAX_FIX) fail(`${phase}: gate still red after ${MAX_FIX} fix rounds — stoppedAt: gate\n${JSON.stringify(verdict.failures, null, 2)}`);

      log(`  ✗ gate FAIL (${verdict.failures.map((f) => f.cmd).join(", ")}) — fix round ${round + 1}`);
      // attribute failures to owning items by file path; unattributed failures go to one session
      const buckets = attributeFailures(plan, verdict.failures);
      for (const [id, fails] of buckets) {
        const r2 = await codexExec(`${id}-fix${round + 1}`, fixPrompt(id, round + 1, fails), { model: CODEX.models.executor });
        if (r2.exit !== 0) fail(`${phase}: fix session for ${id} ${r2.timedOut ? "timed out" : `failed (exit ${r2.exit})`} — see ${cfg.rel(r2.log)}`);
      }
    }
  } finally {
    if (server.started) server.kill();
  }
}

function attributeFailures(plan, failures) {
  const buckets = new Map();
  const put = (id, f) => buckets.set(id, [...(buckets.get(id) || []), f]);
  for (const f of failures) {
    const excerpt = (f.excerpt || "") + (f.command || "");
    const owner = plan.items.find((i) => i.files.some((file) => excerpt.includes(file)));
    put(owner ? owner.id : plan.items[plan.items.length - 1].id, f); // unattributed → last item's executor takes it
  }
  return buckets;
}

// ── QA: separate sessions, evidence checked mechanically, ≤MAX_QA rounds ─────
async function runQA(phase, plan) {
  const hasUI = plan.items.some((i) => i.isUI);
  let server = { started: false, kill() {} };
  if (hasUI || cfg.runtime.verifier !== "none") server = await ensureDevServer();

  try {
    for (let round = 1; round <= MAX_QA; round++) {
      const prior = latestReport(phase);
      const mode = prior ? "verify" : "thorough";
      const r = await codexExec(`${phase}-qa-r${round}`, qaPrompt(phase, mode, prior?.path && cfg.rel(prior.path)), { model: CODEX.models.qa, network: true });
      if (r.exit !== 0) fail(`${phase}: QA session ${r.timedOut ? "timed out" : `failed (exit ${r.exit})`} — see ${cfg.rel(r.log)}`);
      if (DRY) return { rounds: round, report: "(dry-run)" };

      const report = latestReport(phase);
      if (!report || (prior && report.path === prior.path)) fail(`${phase}: QA session produced no new report — see ${cfg.rel(r.log)}`);

      const qc = script("qa-check", [report.path]);
      if (qc.exit !== 0) fail(`${phase}: QA report ${cfg.rel(report.path)} FAILS qa-check (exit ${qc.exit}) — fabricated evidence is a stop, not a retry\n${qc.stdout}${qc.stderr}`);

      const { counts, blocking, raw } = openBlockingDefects(report.path);
      if (blocking === null) fail(`${phase}: ${cfg.rel(report.path)} — ${raw}; cannot decide blocking defects mechanically`);
      log(`  • QA pass ${report.pass}: ${raw} → ${blocking} blocking (blockOn: ${cfg.gate.blockOn.join("+")})`);
      if (blocking === 0) return { rounds: round, report: report.path, counts };
      if (round === MAX_QA) fail(`${phase}: ${blocking} blocking defect(s) still open after ${MAX_QA} QA rounds — stoppedAt: qa (report: ${cfg.rel(report.path)})`);

      const rf = await codexExec(`${phase}-qafix-r${round}`, defectFixPrompt(phase, cfg.rel(report.path), raw, round), { model: CODEX.models.executor });
      if (rf.exit !== 0) fail(`${phase}: QA fix session ${rf.timedOut ? "timed out" : `failed (exit ${rf.exit})`} — see ${cfg.rel(rf.log)}`);
    }
  } finally {
    if (server.started) server.kill();
  }
}

// ── one phase, end-to-end ─────────────────────────────────────────────────────
async function drivePhase(phase) {
  step(`${phase} · precheck`);
  const pre = script("precheck", [phase]);
  if (pre.exit !== 0) fail(`${phase}: precheck refused the launch (exit ${pre.exit})\n${pre.stdout}${pre.stderr}`);
  log(`  ✓ precheck clean`);

  step(`${phase} · plan (phase-items)`);
  const plan = phaseItems(phase);
  const open = plan.items.filter((i) => !i.done);
  log(`  ${plan.items.length} item(s), ${open.length} open · mode=${plan.mode} · parallelizable=${plan.parallelizable}`);
  for (const w of plan.warnings) log(`  ⚠ ${w}`);

  if (open.length) {
    step(`${phase} · build (${open.length} executor session(s))`);
    await runExecutors(phase, plan);
  } else {
    log(`  all items already [x] — skipping to the gate`);
  }

  if (DRY) {
    log(`\n${phase}: dry-run — dispatch plan printed; gate, QA, and barrier not run`);
    return true;
  }

  step(`${phase} · gate (one whole-repo pass)`);
  const gate = await runGate(phase, plan);

  let qa = { rounds: 0, report: latestReport(phase)?.path };
  const guardPre = script("phase-guard", [phase]);
  if (guardPre.exit === 0) {
    log(`\n  phase already guarded — QA artifact present and clean`);
  } else {
    step(`${phase} · QA (separate session)`);
    qa = await runQA(phase, plan);
  }

  step(`${phase} · barrier (phase-guard)`);
  const guard = script("phase-guard", [phase]);
  log(guard.stdout.trim().split("\n").map((l) => `  ${l}`).join("\n"));
  if (guard.exit !== 0 && !DRY) fail(`${phase}: phase-guard says UNGUARDED — the barrier is absolute; a session's summary never overrides it`);

  log(`\n${phase}: GUARDED · ${plan.items.length} item(s) · ${gate?.rounds ?? 0} gate fix round(s) · ${qa.rounds} QA round(s) · report: ${qa.report ? cfg.rel(qa.report) : "existing"}`);
  return true;
}

// ── modes ─────────────────────────────────────────────────────────────────────
function checkSetup() {
  log(`drive-phase --check`);
  log(`  ✓ config: ${cfg.manifestPath} (root: ${cfg.root})`);
  const v = spawnSync(CODEX.bin, ["--version"], { encoding: "utf8", timeout: 15_000 });
  if (v.status !== 0) fail(`codex binary not runnable ("${CODEX.bin}") — install the Codex CLI or set codex.bin / $CODEX_BIN`, 2);
  log(`  ✓ codex: ${(v.stdout || "").trim() || "ok"}`);
  if (!existsSync(cfg.workPhasesAbs)) log(`  • no plan yet (${cfg.rel(cfg.workPhasesAbs)}) — run the plan-work-item skill first`);
  else log(`  ✓ plan: ${cfg.rel(cfg.workPhasesAbs)} (${allPhases().map((p) => `${p.phase} ${p.done}/${p.total}`).join(" · ")})`);
  log(`  • executor model: ${CODEX.models.executor || "(config.toml default)"} · qa model: ${CODEX.models.qa || "(config.toml default)"} · sandbox: ${CODEX.sandbox} · item timeout: ${CODEX.itemTimeoutMinutes}m`);
  process.exit(0);
}

async function main() {
  if (CHECK) return checkSetup();
  if (!existsSync(cfg.workPhasesAbs)) fail(`no plan at ${cfg.rel(cfg.workPhasesAbs)} — run the plan-work-item skill first`, 2);

  let targets;
  if (AUTO) {
    const phases = allPhases();
    const from = val("--from", null)?.toUpperCase();
    const to = val("--to", null)?.toUpperCase();
    // resume from the first phase that is open OR fully-[x] but unguarded (e.g. QA never ran)
    const firstOpen = phases.find((p) => p.done < p.total || script("phase-guard", [p.phase]).exit !== 0)?.phase;
    const start = from || firstOpen;
    if (!start) return log("drive-phase: every phase is already guarded — nothing to do"), process.exit(0);
    const names = phases.map((p) => p.phase);
    targets = names.slice(names.indexOf(start), to ? names.indexOf(to) + 1 : undefined);
    if (!targets.length) fail(`--from/--to produced an empty range (phases: ${names.join(", ")})`, 2);
    log(`drive-phase --auto: ${targets.join(" → ")}${DRY ? " (dry-run)" : ""}`);
  } else {
    if (!phaseArg) fail(`pass a phase id (matching ${cfg.ids.phaseArg}), or --auto, or --check`, 2);
    targets = [phaseArg];
    log(`drive-phase: ${phaseArg}${DRY ? " (dry-run)" : ""}`);
  }

  for (const phase of targets) await drivePhase(phase); // any failure inside exits non-zero — auto never skips a gate

  log(`\ndrive-phase: ${targets.length} phase(s) guarded. ${AUTO ? "Build range complete." : "Review the diff and the QA report, then run the next phase."}`);
}

main();
