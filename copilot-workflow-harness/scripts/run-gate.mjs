#!/usr/bin/env node
// run-gate.mjs — the whole-repo detector gate, run ONCE per phase. Runs the configured static
// checks (runner.lint / runner.typecheck / runner.test, plus runner.build with --build) and then
// the selected runtime verifier (runtime.verifier). Emits ONE structured verdict; exit code is
// the contract.
//
// It is a DETECTOR, not a builder — it never edits code. The caller (an orchestrator/conductor)
// runs it once against a single dev server and attributes failures back to the owning work-item.
//
// The runtime verifier expects the app to already be reachable at runtime.web.baseUrl (the caller
// brings up the dev server). A verifier that can't run (no browser/dep) reports SETUP, and the
// gate fails loud rather than silently passing — "no tooling-excuse without a positive control".
//
// Usage:
//   node scripts/run-gate.mjs               # lint + typecheck + test + runtime verifier
//   node scripts/run-gate.mjs --build       # also run runner.build
//   node scripts/run-gate.mjs --no-runtime  # static checks only (skip the verifier)
//   node scripts/run-gate.mjs --json        # machine-readable verdict only
// Exit: 0 = pass (every check exited 0 / verifier PASS|SKIPPED) · 1 = a failure · 2 = setup.

import { spawnSync } from "node:child_process";
import { loadConfig } from "../lib/config.mjs";
import { loadVerifier } from "../verifiers/index.mjs";

const cfg = loadConfig();
const args = process.argv.slice(2);
const withBuild = args.includes("--build");
const noRuntime = args.includes("--no-runtime");
const jsonOnly = args.includes("--json");

function tail(s, n = 1200) {
  s = (s || "").trim();
  return s.length > n ? "…" + s.slice(-n) : s;
}

function runCmd(label, command) {
  if (!command) return null; // verb not configured → skip
  const r = spawnSync(command, { shell: true, cwd: cfg.root, encoding: "utf8" });
  const exit = r.status ?? (r.error ? 127 : 0);
  return { cmd: label, command, exit, excerpt: exit === 0 ? "" : tail((r.stdout || "") + (r.stderr || "")) };
}

async function main() {
  const failures = [];
  const ran = [];

  const verbs = [
    ["lint", cfg.runner.lint],
    ["typecheck", cfg.runner.typecheck],
    ["test", cfg.runner.test],
  ];
  if (withBuild) verbs.push(["build", cfg.runner.build]);

  for (const [label, command] of verbs) {
    const res = runCmd(label, command);
    if (!res) continue;
    ran.push(label);
    if (!jsonOnly) console.error(`${res.exit === 0 ? "✓" : "✗"} ${label} (${command}) → exit ${res.exit}`);
    if (res.exit !== 0) failures.push(res);
  }

  let runtime = null;
  if (!noRuntime) {
    try {
      const { name, verify } = await loadVerifier(cfg);
      const result = await verify(cfg);
      runtime = { verifier: name, ...result };
      if (!jsonOnly) console.error(`${result.overall === "PASS" || result.overall === "SKIPPED" ? "✓" : "✗"} runtime:${name} → ${result.overall} (${result.verdict})`);
      if (result.overall !== "PASS" && result.overall !== "SKIPPED") {
        failures.push({ cmd: `runtime:${name}`, exit: result.overall === "FAIL" ? 1 : 2, excerpt: JSON.stringify(result.detail).slice(0, 1200) });
      }
    } catch (e) {
      runtime = { verifier: cfg.runtime.verifier, overall: "SETUP", detail: { error: e.message } };
      failures.push({ cmd: `runtime:${cfg.runtime.verifier}`, exit: 2, excerpt: e.message });
    }
  }

  const pass = failures.length === 0;
  const verdict = { pass, ran, withBuild, runtime: runtime ? { verifier: runtime.verifier, overall: runtime.overall, verdict: runtime.verdict } : null, failures };

  if (jsonOnly) console.log(JSON.stringify(verdict, null, 2));
  else {
    console.error(`\nrun-gate: ${pass ? "PASS" : "FAIL"} · ${failures.length} failure(s)`);
    console.log(JSON.stringify(verdict, null, 2));
  }

  // exit 2 only if the sole problem was a verifier setup error; otherwise 1 on any failure
  const onlySetup = failures.length > 0 && failures.every((f) => /^runtime:/.test(f.cmd) && f.exit === 2);
  process.exit(pass ? 0 : onlySetup ? 2 : 1);
}

main();
