#!/usr/bin/env node
// phase-guard.mjs — the merge barrier. A phase is not "complete" until every checklist item is
// [x] AND a QA artifact exists on disk that itself passes qa-check. This is what makes the
// build's "done" mechanical rather than self-reported.
//
// Reads the plan (config.planDir/work-phases.md), groups checklist items by phase via the
// config id scheme, and for each fully-[x] phase requires:
//   1. the phase QA report (config.report.namePattern) to exist, and
//   2. that report to pass scripts/qa-check.mjs (the evidence/quote check).
//
// Usage:
//   node scripts/phase-guard.mjs [P4]
//     no Pid  → check every phase that is fully [x]
//     Pid     → check just that phase
// Exit: 0 = every completed phase guarded · 1 = a completed phase missing/failing QA · 2 = setup.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadConfig } from "../lib/config.mjs";

const cfg = loadConfig();
const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const QA_CHECK = join(SCRIPTS, "qa-check.mjs");

function parseArg(argv) {
  for (const a of argv) if (cfg.phaseArgRe.test(a)) return a.toUpperCase();
  return null;
}

function parsePhases(content) {
  const phases = new Map();
  const re = cfg.itemRe();
  let m;
  while ((m = re.exec(content)) !== null) {
    const done = m[1].toLowerCase() === "x";
    const id = m.groups.id;
    const phase = cfg.phaseLabel(m.groups.phase);
    if (!phases.has(phase)) phases.set(phase, { items: [] });
    phases.get(phase).items.push({ id, done });
  }
  return phases;
}

function qaCheckPasses(reportPath) {
  const r = spawnSync(process.execPath, [QA_CHECK, reportPath], { encoding: "utf8" });
  return { ok: r.status === 0, status: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

function phaseNum(p) {
  const m = p.match(/\d+/);
  return m ? Number(m[0]) : 0;
}

function main() {
  const only = parseArg(process.argv.slice(2));
  let content;
  try {
    content = readFileSync(cfg.workPhasesAbs, "utf8");
  } catch {
    console.error(`phase-guard: cannot read ${cfg.workPhasesAbs}`);
    process.exit(2);
  }

  const phases = parsePhases(content);
  if (phases.size === 0) {
    console.error(`phase-guard: no checklist items found in ${cfg.workPhasesAbs} (id scheme: ${cfg.ids.checklistItem})`);
    process.exit(2);
  }

  const ordered = [...phases.keys()].sort((a, b) => phaseNum(a) - phaseNum(b));
  const targets = only ? ordered.filter((p) => p === only) : ordered;
  if (only && targets.length === 0) {
    console.error(`phase-guard: phase ${only} not found in the checklist`);
    process.exit(2);
  }

  let violations = 0;
  for (const phase of targets) {
    const { items } = phases.get(phase);
    const doneCount = items.filter((i) => i.done).length;
    const allDone = items.length > 0 && doneCount === items.length;

    if (!allDone) {
      console.log(`• ${phase}: in progress (${doneCount}/${items.length} items) — QA not required yet`);
      continue;
    }

    const report = cfg.reportPath(phase);
    const relReport = cfg.rel(report);
    if (!existsSync(report)) {
      console.log(`✗ ${phase}: all ${items.length} items [x] but NO QA report (${relReport}) — phase cannot be considered complete`);
      violations++;
      continue;
    }
    const qa = qaCheckPasses(report);
    if (!qa.ok) {
      console.log(`✗ ${phase}: QA report exists but FAILS qa-check (exit ${qa.status}) — fix the report's evidence before advancing`);
      const detail = qa.out.split("\n").filter((l) => /✗|violation/.test(l)).slice(0, 4);
      for (const d of detail) console.log(`    ${d.trim()}`);
      violations++;
      continue;
    }
    console.log(`✓ ${phase}: complete and guarded (${relReport} passes qa-check)`);
  }

  console.log(`\nphase-guard: ${targets.length} phase(s) checked · ${violations} unguarded`);
  process.exit(violations > 0 ? 1 : 0);
}

main();
