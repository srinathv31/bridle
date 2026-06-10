#!/usr/bin/env node
// precheck.mjs — verify a dispatch is legal BEFORE the orchestrator spawns a subagent on it.
// The forward complement to phase-guard (which checks a phase is complete AFTER the fact).
//
// Refuses: a missing brief; an item already [x]; an item whose `Depends on:` predecessors
// aren't merged; advancing to a phase while an earlier phase is incomplete or not QA-guarded.
//
// Usage:
//   node scripts/precheck.mjs W4.2     # before dispatching a work-item
//   node scripts/precheck.mjs P4       # before starting/advancing to a phase
// Exit: 0 = safe · 1 = blocked · 2 = setup error.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadConfig } from "../lib/config.mjs";

const cfg = loadConfig();
const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const PHASE_GUARD = join(SCRIPTS, "phase-guard.mjs");

const ITEM_RE = new RegExp("^" + cfg.ids.checklistItem + "$", "i");

function parseArg(argv) {
  for (const a of argv) {
    if (cfg.phaseArgRe.test(a) || ITEM_RE.test(a)) return a.toUpperCase();
  }
  return null;
}

function parseChecklist(content) {
  const items = [];
  const re = cfg.itemRe();
  let m;
  while ((m = re.exec(content)) !== null) {
    items.push({ id: m.groups.id, phase: cfg.phaseLabel(m.groups.phase), done: m[1].toLowerCase() === "x" });
  }
  return items;
}

function briefPath(id) {
  return join(cfg.planDirAbs, `work-item-${id}.md`);
}

function readDeps(id) {
  const p = briefPath(id);
  if (!existsSync(p)) return null;
  const body = readFileSync(p, "utf8");
  const m = body.match(/^\*\*Depends on:\*\*\s*(.+)$/m);
  if (!m) return [];
  const raw = m[1].trim();
  if (/^none$/i.test(raw)) return [];
  const re = new RegExp(cfg.ids.checklistItem, "g");
  return (raw.match(re) || []).map((s) => s.toUpperCase());
}

function phaseNum(p) {
  const m = p.match(/\d+/);
  return m ? Number(m[0]) : 0;
}
function phaseOrder(items) {
  return [...new Set(items.map((i) => i.phase))].sort((a, b) => phaseNum(a) - phaseNum(b));
}

function phaseGuarded(phase) {
  const r = spawnSync(process.execPath, [PHASE_GUARD, phase], { encoding: "utf8" });
  return r.status === 0;
}

function checkWorkItem(id, items) {
  const fails = [];
  const self = items.find((i) => i.id === id);
  if (!self) fails.push(`work-item ${id} is not in the progress checklist`);

  const deps = readDeps(id);
  if (deps === null) {
    fails.push(`brief ${cfg.rel(briefPath(id))} does not exist`);
  } else {
    for (const dep of deps) {
      const d = items.find((i) => i.id === dep);
      if (!d) fails.push(`dependency ${dep} is not in the checklist (broken Depends-on)`);
      else if (!d.done) fails.push(`dependency ${dep} is not yet complete (still [ ]) — merge it first`);
    }
  }
  if (self?.done) fails.push(`${id} is already marked [x] — re-dispatching it is wrong-phase drift; pick the next open item`);

  if (self) {
    const order = phaseOrder(items);
    const myIdx = order.indexOf(self.phase);
    for (let p = 0; p < myIdx; p++) {
      const ph = order[p];
      const open = items.filter((i) => i.phase === ph && !i.done).map((i) => i.id);
      if (open.length) fails.push(`upstream phase ${ph} still has open items (${open.join(", ")}) — ${self.phase} should not run yet`);
    }
  }
  return fails;
}

function checkPhase(phase, items) {
  const fails = [];
  const order = phaseOrder(items);
  if (!order.includes(phase)) {
    fails.push(`phase ${phase} does not exist in the checklist (phases: ${order.join(", ")})`);
    return fails;
  }
  const myIdx = order.indexOf(phase);
  for (let p = 0; p < myIdx; p++) {
    const ph = order[p];
    const open = items.filter((i) => i.phase === ph && !i.done).map((i) => i.id);
    if (open.length) {
      fails.push(`earlier phase ${ph} is incomplete (${open.join(", ")}) — cannot advance to ${phase}`);
    } else if (!phaseGuarded(ph)) {
      fails.push(`earlier phase ${ph} is all [x] but NOT QA-guarded (phase-guard fails) — advancing to ${phase} would skip its QA`);
    }
  }
  return fails;
}

function main() {
  const id = parseArg(process.argv.slice(2));
  if (!id) {
    console.error("precheck: pass a work-item or phase id");
    process.exit(2);
  }
  let content;
  try {
    content = readFileSync(cfg.workPhasesAbs, "utf8");
  } catch {
    console.error(`precheck: cannot read ${cfg.workPhasesAbs}`);
    process.exit(2);
  }
  const items = parseChecklist(content);
  if (items.length === 0) {
    console.error(`precheck: no checklist items found in ${cfg.workPhasesAbs}`);
    process.exit(2);
  }

  const isPhase = cfg.phaseArgRe.test(id);
  const fails = isPhase ? checkPhase(id, items) : checkWorkItem(id, items);

  if (fails.length === 0) {
    console.log(`✓ ${id}: safe to dispatch — preconditions met`);
    process.exit(0);
  }
  console.log(`✗ ${id}: NOT safe to dispatch`);
  for (const f of fails) console.log(`  - ${f}`);
  console.log(`\nprecheck: ${fails.length} blocker(s)`);
  process.exit(1);
}

main();
