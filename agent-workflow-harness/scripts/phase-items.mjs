#!/usr/bin/env node
// phase-items.mjs — deterministic plan reader for ONE phase. Emits the phase's work-items as
// JSON: ids, done-state, declared deps, the file set each item creates/edits, a computed isUI
// flag, the dispatch `groups` (dependency chains collapsed, see below), and — crucially —
// whether those groups are actually parallel-safe (pairwise-disjoint file sets), independent
// of what each brief CLAIMS.
//
// Why it exists: the dispatch decision (parallel vs serial) must be MECHANICAL, computed from
// real file-set overlap and the declared dependency edges, not from a brief's self-reported
// "parallel-safe" line. Two GROUPS run concurrently only if their file sets genuinely do not
// intersect; open items linked by a within-phase dependency (W3.2 depends on W3.1) land in the
// SAME group, topologically ordered, so the dispatcher hands the whole chain to one executor
// instead of racing the dependent against its prerequisite.
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

// Kahn's algorithm in waves; checklist order within a wave keeps the result deterministic.
// `deps` is already restricted to ids inside `comp` (a dependency edge is what put two items
// in the same component in the first place).
function topoSort(comp, deps, warnings) {
  const order = [];
  const placed = new Set();
  while (order.length < comp.length) {
    const ready = comp.filter(
      (id) => !placed.has(id) && [...deps.get(id)].every((d) => placed.has(d)),
    );
    if (!ready.length) {
      warnings.push(
        `dependency cycle among ${comp.filter((id) => !placed.has(id)).join(", ")} — using checklist order`,
      );
      for (const id of comp) if (!placed.has(id)) order.push(id);
      return order;
    }
    for (const id of ready) {
      placed.add(id);
      order.push(id);
    }
  }
  return order;
}

// Dispatch groups over the OPEN items: connected components of the within-phase dependency
// graph, each topologically ordered. A multi-item group is a chain the dispatcher must hand
// to ONE executor, in this order — never race a dependent against its prerequisite. A dep on
// a done item is satisfied (no edge); a dep outside this phase is precheck's concern.
function computeGroups(open, warnings) {
  const ids = new Set(open.map((i) => i.id));
  const pos = new Map(open.map((i, n) => [i.id, n]));
  const deps = new Map(
    open.map((i) => [i.id, new Set((i.dependsOn || []).filter((d) => ids.has(d)))]),
  );
  const adj = new Map(open.map((i) => [i.id, new Set()]));
  for (const [id, ds] of deps)
    for (const d of ds) {
      adj.get(id).add(d);
      adj.get(d).add(id);
    }
  const seen = new Set();
  const groups = [];
  for (const it of open) {
    if (seen.has(it.id)) continue;
    const comp = [];
    const stack = [it.id];
    seen.add(it.id);
    while (stack.length) {
      const id = stack.pop();
      comp.push(id);
      for (const n of adj.get(id))
        if (!seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
    }
    comp.sort((a, b) => pos.get(a) - pos.get(b));
    groups.push(topoSort(comp, deps, warnings));
  }
  return groups;
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
  const groups = computeGroups(open, warnings);

  // Only overlap between items in DIFFERENT groups gates parallel dispatch — a shared file
  // inside one group is harmless, the chain runs sequentially in a single executor anyway.
  const groupOf = new Map();
  groups.forEach((g, n) => g.forEach((id) => groupOf.set(id, n)));
  const ov = overlaps(open);
  const crossOv = ov.filter((o) => groupOf.get(o.a) !== groupOf.get(o.b));
  const parallelizable = mode === "parallel" && crossOv.length === 0 && groups.length > 1;

  for (const o of crossOv) {
    const a = items.find((i) => i.id === o.a);
    const b = items.find((i) => i.id === o.b);
    if (a?.parallelSafeClaim || b?.parallelSafeClaim) {
      warnings.push(`${o.a} and ${o.b} declare parallel-safe but share ${o.shared.join(", ")} — will serialize`);
    }
  }

  console.log(JSON.stringify({ phase, mode, parallelizable, groups, items, overlaps: ov, warnings }, null, 2));
  process.exit(0);
}

main();
