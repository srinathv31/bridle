#!/usr/bin/env node
// precheck.mjs — verify a dispatch is legal BEFORE the orchestrator spawns a subagent on it.
// The forward complement to phase-guard (which checks a phase is complete AFTER the fact).
//
// Refuses: a missing brief; an item already [x]; an item whose `Depends on:` predecessors
// aren't merged; advancing to a phase while an earlier phase is incomplete or not QA-guarded;
// an unmet "## Requires" declaration (env key / file / probe command) in any open brief; a
// work-phases.md "**Repo:**" pin that doesn't match the working directory.
//
// Usage:
//   node scripts/precheck.mjs W4.2     # before dispatching a work-item
//   node scripts/precheck.mjs P4       # before starting/advancing to a phase
// Exit: 0 = safe · 1 = blocked · 2 = setup error.

import { readFileSync, existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
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

// ── environment preflight ─────────────────────────────────────────────────────
// Briefs declare what they need from the WORLD (not the codebase) in a "## Requires"
// section, one bullet per need:
//   - env: VOYAGE_API_KEY — embeddings calls
//   - file: auth.md — gitignored test credentials
//   - cmd: node scripts/check-credits.mjs — probes the provider's credit balance
// Verbs: env (set in the environment or a root .env* file) · file (exists at the project
// root) · cmd (exits 0 within 30s). A trailing " — why" note is ignored. An unmet
// requirement fails the dispatch HERE, in seconds — not 40 minutes into a build when an
// executor finally makes the external call.
function parseRequires(body) {
  const start = body.search(/^##\s+Requires\s*$/im);
  if (start === -1) return [];
  const rest = body.slice(start + 3);
  const next = rest.search(/^##\s+/m);
  const section = next === -1 ? rest : rest.slice(0, next);
  const reqs = [];
  const re = /^\s*-\s+(env|file|cmd):\s*(.+)$/gim;
  let m;
  while ((m = re.exec(section)) !== null) {
    const value = m[2].split(/\s+—\s+/)[0].trim().replace(/^`|`$/g, "");
    if (value && !/^<.*>$/.test(value)) reqs.push({ verb: m[1].toLowerCase(), value });
  }
  return reqs;
}

let envFileCache = null;
function envFromFiles() {
  if (envFileCache) return envFileCache;
  envFileCache = {};
  for (const f of [".env", ".env.local", ".env.development", ".env.development.local"]) {
    const p = join(cfg.root, f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && m[2] !== "" && m[2] !== '""' && m[2] !== "''") envFileCache[m[1]] = true;
    }
  }
  return envFileCache;
}

function checkRequires(ids) {
  const fails = [];
  const seen = new Set();
  for (const id of ids) {
    const p = briefPath(id);
    if (!existsSync(p)) continue; // a missing brief is reported by the dep check
    for (const r of parseRequires(readFileSync(p, "utf8"))) {
      const key = `${r.verb}:${r.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (r.verb === "env") {
        if (!process.env[r.value] && !envFromFiles()[r.value])
          fails.push(`${id} requires env ${r.value} — not set in the environment or any root .env* file`);
      } else if (r.verb === "file") {
        if (!existsSync(join(cfg.root, r.value))) fails.push(`${id} requires file ${r.value} — not found at the project root`);
      } else if (r.verb === "cmd") {
        const res = spawnSync(r.value, { shell: true, encoding: "utf8", timeout: 30000, cwd: cfg.root });
        if (res.status !== 0) {
          const excerpt = (res.stderr || res.stdout || "").trim().split("\n")[0].slice(0, 160);
          fails.push(`${id} requires \`${r.value}\` to exit 0 — got ${res.status === null ? "timeout/spawn error" : `exit ${res.status}`}${excerpt ? `: ${excerpt}` : ""}`);
        }
      }
    }
  }
  return fails;
}

// ── repo identity ─────────────────────────────────────────────────────────────
// A conductor resumed in the wrong cwd once burned a full phase building against the
// wrong repo. The plan pins its repo with a "**Repo:** <name>" line in work-phases.md;
// dispatch is refused when the pin matches neither the root folder name nor the git
// remote URL. No pin (or an unfilled <placeholder>) → no check, backwards compatible.
function checkRepoIdentity(content) {
  const m = content.match(/^\*\*Repo:\*\*\s*(.+)$/m);
  if (!m) return [];
  const pin = m[1].trim().replace(/`/g, "");
  if (!pin || /^<.*>$/.test(pin)) return [];
  const folder = basename(cfg.root);
  const remote = spawnSync("git", ["remote", "get-url", "origin"], { encoding: "utf8", cwd: cfg.root }).stdout?.trim() ?? "";
  if (folder === pin || (remote && remote.includes(pin))) return [];
  return [`work-phases.md pins **Repo:** ${pin}, but the working directory is ${folder}${remote ? ` (origin ${remote})` : ""} — wrong repo?`];
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
  fails.push(...checkRequires([id]));
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
  fails.push(...checkRequires(items.filter((i) => i.phase === phase && !i.done).map((i) => i.id)));
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
  // repo identity first — from the wrong repo, every other finding is noise off the wrong plan
  const fails = checkRepoIdentity(content);
  if (fails.length === 0) fails.push(...(isPhase ? checkPhase(id, items) : checkWorkItem(id, items)));

  console.log(`precheck: repo ${basename(cfg.root)} · plan ${cfg.rel(cfg.workPhasesAbs)}`);
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
