#!/usr/bin/env node
// phase-items.mjs — deterministic plan reader for ONE phase. Emits the phase's work-items as
// JSON: ids, done-state, declared deps, the file set each item creates/edits, a computed isUI
// flag, and — crucially — whether the open items are actually parallel-safe (pairwise-disjoint
// file sets), independent of what each brief CLAIMS.
//
// Why it exists: the dispatch decision (parallel vs serial) must be MECHANICAL, computed from
// real file-set overlap, not from a brief's self-reported "parallel-safe" line. Two items run
// concurrently only if their file sets genuinely do not intersect.
//
// App-agnostic: all paths, the id scheme, and the "what counts as UI" rule come from
// harness.config.json (see lib/config.mjs). Nothing here knows about pnpm, Next, or .tsx beyond
// what the config's `runtime.uiFilePattern` says.
//
// Usage:
//   node scripts/phase-items.mjs P2
// Output: JSON to stdout. Exit 0 = parsed · 2 = setup error (missing file / unknown phase).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../lib/config.mjs";

const cfg = loadConfig();

function fail(msg) {
  console.error(`phase-items: ${msg}`);
  process.exit(2);
}

function parseArg(argv) {
  for (const a of argv) if (cfg.phaseArgRe.test(a)) return a.toUpperCase();
  return null;
}

// checklist: "- [x] W2.1 — ..." → {id, phase, done}, using the config id scheme
function parseChecklist(content) {
  const items = [];
  const re = cfg.itemRe();
  let m;
  while ((m = re.exec(content)) !== null) {
    const done = m[1].toLowerCase() === "x";
    items.push({ id: m.groups.id, phase: cfg.phaseLabel(m.groups.phase), done });
  }
  return items;
}

// phase table row → Mode (last cell): "| P2 | … | W2.1, … | parallel |"
function parseMode(content, phase) {
  for (const line of content.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells[0] === "") cells.shift();
    if (cells.length && cells[cells.length - 1] === "") cells.pop();
    if (cells[0] && cells[0].toUpperCase() === phase) {
      const last = (cells[cells.length - 1] || "").toLowerCase();
      const hit = last.match(/parallel|sequential|single/);
      if (hit) return hit[0];
    }
  }
  return null;
}

function readBrief(id) {
  const p = join(cfg.planDirAbs, `work-item-${id}.md`);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

function parseDeps(body) {
  const m = body.match(/^\*\*Depends on:\*\*\s*(.+)$/m);
  if (!m || /^none$/i.test(m[1].trim())) return [];
  const re = new RegExp(cfg.ids.checklistItem, "g");
  return (m[1].match(re) || []).map((s) => s.toUpperCase());
}

function parseParallelClaim(body) {
  const m = body.match(/^\*\*Parallel-safe within phase:\*\*\s*(\w+)/im);
  return m ? /^yes$/i.test(m[1]) : null;
}

// the bullet list of backticked paths under "## Files this item creates / edits"
function parseFiles(body) {
  const start = body.search(/^##\s+Files this item creates\s*\/\s*edits\s*$/im);
  if (start === -1) return [];
  const rest = body.slice(start + 3);
  const next = rest.search(/^##\s+/m);
  const section = next === -1 ? rest : rest.slice(0, next);
  const files = [];
  const re = /^\s*-\s+`([^`]+)`/gm;
  let m;
  while ((m = re.exec(section)) !== null) files.push(m[1].trim());
  return files;
}

// a file counts as a drivable runtime surface if it matches the config's uiFilePattern
const uiRe = new RegExp(cfg.runtime.uiFilePattern);
function isUIFiles(files) {
  return files.some((f) => uiRe.test(f));
}

function overlaps(items) {
  const out = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const shared = items[i].files.filter((f) => items[j].files.includes(f));
      if (shared.length) out.push({ a: items[i].id, b: items[j].id, shared });
    }
  }
  return out;
}

function main() {
  const phase = parseArg(process.argv.slice(2));
  if (!phase) fail(`pass a phase id (matching ${cfg.ids.phaseArg})`);

  let content;
  try {
    content = readFileSync(cfg.workPhasesAbs, "utf8");
  } catch {
    return fail(`cannot read ${cfg.workPhasesAbs}`);
  }

  const phaseItems = parseChecklist(content).filter((i) => i.phase === phase);
  if (phaseItems.length === 0) return fail(`phase ${phase} has no items in the checklist`);

  const mode = parseMode(content, phase) || "single";
  const warnings = [];

  const items = phaseItems.map((it) => {
    const body = readBrief(it.id);
    if (body === null) {
      warnings.push(`brief work-item-${it.id}.md is missing`);
      return { id: it.id, done: it.done, dependsOn: [], parallelSafeClaim: null, isUI: false, files: [] };
    }
    const files = parseFiles(body);
    return {
      id: it.id,
      done: it.done,
      dependsOn: parseDeps(body),
      parallelSafeClaim: parseParallelClaim(body),
      isUI: isUIFiles(files),
      files,
    };
  });

  const open = items.filter((i) => !i.done);
  const ov = overlaps(open);
  const parallelizable = mode === "parallel" && ov.length === 0 && open.length > 1;

  for (const o of ov) {
    const a = items.find((i) => i.id === o.a);
    const b = items.find((i) => i.id === o.b);
    if (a?.parallelSafeClaim || b?.parallelSafeClaim) {
      warnings.push(`${o.a} and ${o.b} declare parallel-safe but share ${o.shared.join(", ")} — will serialize`);
    }
  }

  console.log(JSON.stringify({ phase, mode, parallelizable, items, overlaps: ov, warnings }, null, 2));
  process.exit(0);
}

main();
