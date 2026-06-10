#!/usr/bin/env node
// subagent-status.mjs — surface stuck/dead subagents and carry resumable-handoff state, so a
// hung work-item doesn't sit silently until a human notices. "Still working" and "wedged" look
// identical to an orchestrator without a heartbeat — this is the heartbeat reader.
//
// Convention: each work-item subagent maintains a status file at
//   <config.statusDir>/<work-item-id>.json
// with: { id, state: running|done|blocked, startedAt, lastBeat, step, criteriaDone[],
//         filesTouched[], note }
// It flags any `running` record whose status file hasn't been WRITTEN within the staleness
// window as STUCK. Freshness comes from the file's mtime — kernel-stamped on every write, so an
// agent can't get it wrong. The self-reported `lastBeat` field is informational only: live runs
// caught executors hand-typing plausible-looking epochs that were off by a year, so a lastBeat
// that diverges wildly from the mtime is surfaced as a fabricated-timestamp warning, not used.
//
// Usage:
//   node scripts/subagent-status.mjs                 # report all; flag stale running ones
//   node scripts/subagent-status.mjs --stale-min 5   # custom staleness window (minutes)
//   node scripts/subagent-status.mjs --now <unix-ms> # fixed clock (tests/determinism)
//   node scripts/subagent-status.mjs --dir <path>    # override status dir
// Exit: 0 = no stuck · 1 = a stale running subagent · 2 = a malformed status file.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../lib/config.mjs";

const cfg = loadConfig();
const STATES = new Set(["running", "done", "blocked"]);

function parseArgs(argv) {
  let staleMin = 10;
  let now = null;
  let dir = cfg.statusDirAbs;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--stale-min") staleMin = Number(argv[++i]);
    else if (argv[i] === "--now") now = Number(argv[++i]);
    else if (argv[i] === "--dir") dir = resolve(process.cwd(), argv[++i]);
  }
  return { staleMin, now, dir };
}

function main() {
  const { staleMin, now: nowArg, dir } = parseArgs(process.argv.slice(2));
  if (!existsSync(dir)) {
    console.log(`subagent-status: no status dir (${cfg.rel(dir)}) — no subagents tracked`);
    process.exit(0);
  }
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.log("subagent-status: status dir empty — no subagents tracked");
    process.exit(0);
  }

  const records = [];
  let malformed = 0;
  for (const f of files) {
    const p = resolve(dir, f);
    let data;
    try {
      data = JSON.parse(readFileSync(p, "utf8"));
    } catch {
      console.log(`✗ ${f}: not valid JSON — the status convention is broken for this subagent`);
      malformed++;
      continue;
    }
    const problems = [];
    if (!data.id) problems.push("missing id");
    if (!STATES.has(data.state)) problems.push(`bad state "${data.state}" (want running|done|blocked)`);
    // mtime is the trust anchor (see header) — lastBeat is self-reported and only cross-checked.
    const beat = statSync(p).mtimeMs;
    const claimed = Number(data.lastBeat) || 0;
    const skewMs = claimed ? Math.abs(claimed - beat) : 0;
    records.push({ f, id: data.id || f, state: data.state, beat, skewMs, step: data.step, note: data.note, problems });
    if (problems.length) malformed++;
  }

  const now = nowArg ?? Math.max(...records.map((r) => r.beat), 0);
  const staleMs = staleMin * 60_000;

  let stuck = 0;
  for (const r of records) {
    const ageMin = Math.round(((now - r.beat) / 60_000) * 10) / 10;
    if (r.problems.length) {
      console.log(`✗ ${r.id}: malformed — ${r.problems.join("; ")}`);
      continue;
    }
    if (r.state === "running" && now - r.beat > staleMs) {
      console.log(`✗ ${r.id}: STUCK candidate — running but no heartbeat for ${ageMin} min (> ${staleMin}) · step: ${r.step || "?"}`);
      stuck++;
    } else if (r.state === "running") {
      console.log(`• ${r.id}: running (last beat ${ageMin} min ago) · step: ${r.step || "?"}`);
    } else if (r.state === "blocked") {
      console.log(`⚠ ${r.id}: blocked · ${r.note || "no reason given"}`);
    } else {
      console.log(`✓ ${r.id}: done`);
    }
    if (r.skewMs > 60 * 60_000) {
      console.log(`  ⚠ ${r.id}: self-reported lastBeat is ${Math.round(r.skewMs / 3_600_000)}h off the file mtime — fabricated/hand-typed timestamp; mtime used for freshness`);
    }
  }

  console.log(`\nsubagent-status: ${records.length} tracked · ${stuck} stuck · ${malformed} malformed`);
  if (malformed > 0) process.exit(2);
  process.exit(stuck > 0 ? 1 : 0);
}

main();
