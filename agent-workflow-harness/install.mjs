#!/usr/bin/env node
// install.mjs — stand the whole harness up in a target project with ONE command.
//
//   node /path/to/agent-workflow-harness/install.mjs              # install into the current dir
//   node /path/to/agent-workflow-harness/install.mjs --target /p  # …into /p
//   node /path/to/agent-workflow-harness/install.mjs --force      # overwrite an existing harness.config.json
//
// What it does (idempotent — safe to re-run to UPDATE):
//   1. vendors the kit into <target>/agent-workflow-harness/        (scripts, lib, verifiers, hooks, templates, roles)
//   2. installs the Claude Code bindings into <target>/.claude/      (skills/, agents/, workflows/execute-phase.js)
//   3. merges the PostToolUse lint/format hooks into <target>/.claude/settings.json
//   4. creates <target>/harness.config.json from the example (only if absent; --force overwrites),
//      autodetecting your package manager's lint/typecheck/test verbs where it can
//   5. creates planDir + statusDir and gitignores the statusDir
//
// Zero dependencies — node:fs / node:path only.

import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync, chmodSync, readdirSync, appendFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const SELF = dirname(fileURLToPath(import.meta.url)); // the harness repo
const VENDOR_NAME = "agent-workflow-harness"; // the dir name vendored into the target

function parseArgs(argv) {
  let target = process.cwd();
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--target") target = resolve(process.cwd(), argv[++i]);
    else if (argv[i] === "--force") force = true;
  }
  return { target: resolve(target), force };
}

const log = (m) => console.log(m);
const ok = (m) => console.log(`  ✓ ${m}`);
const info = (m) => console.log(`  • ${m}`);

// ── 1. vendor the kit ────────────────────────────────────────────────────────
const VENDOR_PARTS = ["lib", "scripts", "verifiers", "hooks", "templates", "roles", "harness.config.schema.json", "harness.config.example.json", "package.json", "README.md", ".gitignore"];

function vendor(target) {
  const dest = join(target, VENDOR_NAME);
  mkdirSync(dest, { recursive: true });
  for (const part of VENDOR_PARTS) {
    const src = join(SELF, part);
    if (!existsSync(src)) continue;
    cpSync(src, join(dest, part), { recursive: true });
  }
  // make hook scripts executable
  for (const h of ["lint-check.sh", "format-on-write.sh"]) {
    const p = join(dest, "hooks", h);
    if (existsSync(p)) chmodSync(p, 0o755);
  }
  ok(`vendored kit → ${VENDOR_NAME}/`);
}

// ── 2. Claude Code bindings ──────────────────────────────────────────────────
function installClaude(target) {
  const claudeSrc = join(SELF, "claude");
  const dest = join(target, ".claude");
  const counts = {};
  for (const sub of ["skills", "agents", "workflows"]) {
    const src = join(claudeSrc, sub);
    if (!existsSync(src)) continue;
    const out = join(dest, sub);
    mkdirSync(out, { recursive: true });
    // merge: copy each entry, overwriting same-named harness files but leaving others
    for (const entry of readdirSync(src)) {
      cpSync(join(src, entry), join(out, entry), { recursive: true });
    }
    counts[sub] = readdirSync(src).length;
  }
  ok(`installed .claude/skills (${counts.skills}), .claude/agents (${counts.agents}), .claude/workflows/execute-phase.js`);
}

// ── 3. merge hooks into .claude/settings.json ────────────────────────────────
function mergeHooks(target) {
  const snippet = JSON.parse(readFileSync(join(SELF, "claude", "settings.hooks.json"), "utf8"));
  const settingsPath = join(target, ".claude", "settings.json");
  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch {
      const fallback = join(target, ".claude", "settings.hooks.json");
      cpSync(join(SELF, "claude", "settings.hooks.json"), fallback);
      info(`existing .claude/settings.json isn't valid JSON — wrote the hook snippet to ${VENDOR_NAME}-style .claude/settings.hooks.json for you to merge by hand`);
      return;
    }
  }
  settings.hooks = settings.hooks || {};
  settings.hooks.PostToolUse = settings.hooks.PostToolUse || [];
  const wanted = snippet.hooks.PostToolUse[0];
  const already = JSON.stringify(settings.hooks.PostToolUse).includes(`${VENDOR_NAME}/hooks/lint-check.sh`);
  if (already) {
    info("PostToolUse lint/format hooks already present — left as is");
  } else {
    settings.hooks.PostToolUse.push(wanted);
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    ok("merged PostToolUse lint/format hooks into .claude/settings.json");
  }
}

// ── 4. create harness.config.json (autodetect runner verbs) ──────────────────
function detectRunner(target) {
  const has = (f) => existsSync(join(target, f));
  if (has("pnpm-lock.yaml")) return js("pnpm");
  if (has("yarn.lock")) return js("yarn");
  if (has("package-lock.json") || has("package.json")) return js("npm run");
  if (has("pyproject.toml") || has("setup.py")) {
    return { lint: "ruff check .", typecheck: "mypy .", test: "pytest -q", build: "", dev: "" };
  }
  if (has("go.mod")) return { lint: "golangci-lint run", typecheck: "go vet ./...", test: "go test ./...", build: "go build ./...", dev: "" };
  if (has("Gemfile")) return { lint: "bundle exec rubocop", typecheck: "", test: "bundle exec rspec", build: "", dev: "" };
  if (has("Cargo.toml")) return { lint: "cargo clippy", typecheck: "cargo check", test: "cargo test", build: "cargo build", dev: "" };
  return null;
}
function js(pm) {
  const run = pm === "npm run" ? "npm run" : pm;
  return { lint: `${run} lint`, typecheck: `${run} typecheck`, test: `${run} test`, build: `${run} build`, dev: `${run} dev` };
}

function writeConfig(target, force) {
  const dest = join(target, "harness.config.json");
  if (existsSync(dest) && !force) {
    info(`harness.config.json already exists — left as is (use --force to regenerate)`);
    return;
  }
  const cfg = JSON.parse(readFileSync(join(SELF, "harness.config.example.json"), "utf8"));
  const runner = detectRunner(target);
  if (runner) {
    cfg.runner = runner;
    // a non-web stack gets the no-op verifier + safe defaults; web stays as the example
    if (!runner.dev) {
      cfg.runtime = { verifier: "none", uiFilePattern: cfg.runtime.uiFilePattern, web: cfg.runtime.web };
      cfg.hooks = cfg.hooks; // leave example hooks; user edits per linter
    }
    ok(`detected runner verbs (${runner.lint || "—"} …) and wrote harness.config.json`);
  } else {
    info("couldn't autodetect a package manager — wrote harness.config.json from the example; EDIT runner.* for your stack");
  }
  writeFileSync(dest, JSON.stringify(cfg, null, 2) + "\n");
}

// ── 5. plan/status dirs + gitignore ──────────────────────────────────────────
function scaffoldPlanDir(target) {
  const cfg = JSON.parse(readFileSync(join(target, "harness.config.json"), "utf8"));
  const planDir = join(target, cfg.planDir || "docs/redesign");
  const statusDir = join(target, cfg.statusDir || "docs/redesign/.status");
  mkdirSync(planDir, { recursive: true });
  mkdirSync(statusDir, { recursive: true });
  // copy the templates into the plan dir as starting points (don't overwrite real plans)
  const tdir = join(SELF, "templates");
  for (const [tpl, out] of [["work-phases.template.md", "work-phases.md"], ["contracts.template.md", "contracts.md"], ["defect-ledger.template.md", "defect-ledger.md"]]) {
    const o = join(planDir, out);
    if (!existsSync(o) && existsSync(join(tdir, tpl))) cpSync(join(tdir, tpl), o);
  }
  ok(`created ${cfg.planDir} (with work-phases/contracts/defect-ledger templates) + ${cfg.statusDir}`);

  const gi = join(target, ".gitignore");
  const rel = (cfg.statusDir || "docs/redesign/.status") + "/";
  const cur = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  if (!cur.includes(rel)) {
    appendFileSync(gi, (cur && !cur.endsWith("\n") ? "\n" : "") + `\n# agent-workflow-harness runtime state\n${rel}\n`);
    ok(`gitignored ${rel}`);
  } else {
    info(`${rel} already gitignored`);
  }
}

function main() {
  const { target, force } = parseArgs(process.argv.slice(2));
  if (target === SELF || target.startsWith(SELF + "/")) {
    console.error(`install: refusing to install the harness into itself (${target}). Run it from your project, or pass --target.`);
    process.exit(1);
  }
  if (!existsSync(target)) {
    console.error(`install: target does not exist: ${target}`);
    process.exit(1);
  }

  log(`\nInstalling agent-workflow-harness into ${target}\n`);
  vendor(target);
  installClaude(target);
  mergeHooks(target);
  writeConfig(target, force);
  scaffoldPlanDir(target);

  log(`\nDone. Next steps:`);
  log(`  1. Review harness.config.json — confirm runner.* verbs + runtime.verifier ("web" needs runtime.web.routes; else "none").`);
  log(`  2. If using the web verifier: npm i -D playwright-core (and ensure Chrome is installed).`);
  log(`  3. Prove the hooks bite:  node ${VENDOR_NAME}/scripts/hook-selftest.mjs`);
  log(`  4. Plan a feature with the planner skill, then drive it:  /drive-build auto`);
  log(`  (Restart Claude Code so it picks up the new .claude/skills, agents, and workflow.)\n`);
}

main();
