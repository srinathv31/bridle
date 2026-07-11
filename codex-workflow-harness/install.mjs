#!/usr/bin/env node
// install.mjs — stand the whole harness up in a target project with ONE command.
//
//   node /path/to/codex-workflow-harness/install.mjs              # install into the current dir
//   node /path/to/codex-workflow-harness/install.mjs --target /p  # …into /p
//   node /path/to/codex-workflow-harness/install.mjs --force      # overwrite an existing harness.config.json
//
// What it does (idempotent — safe to re-run to UPDATE):
//   1. vendors the kit into <target>/codex-workflow-harness/       (scripts, lib, verifiers, hooks,
//      templates, roles, and codex/ — the drive-phase conductor + binding sources)
//   2. installs the Codex skills into <target>/.agents/skills/     (repo-scoped; Codex discovers
//      them natively — explicit via $mention or /skills, implicit by description)
//   3. merges the harness block into <target>/AGENTS.md            (managed-marker block)
//   4. writes <target>/.codex/config.toml                          (sandbox/approval defaults for the
//      project) — leaves .codex/config.harness.toml beside an existing one for manual merge
//   5. creates <target>/harness.config.json from the example (only if absent; --force overwrites),
//      autodetecting your package manager's lint/typecheck/test verbs where it can
//   6. creates planDir + statusDir and gitignores the statusDir
//
// Zero dependencies — node:fs / node:path only.

import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync, chmodSync, readdirSync, appendFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const SELF = dirname(fileURLToPath(import.meta.url)); // the harness repo
const VENDOR_NAME = "codex-workflow-harness"; // the dir name vendored into the target
const MARK_BEGIN = "<!-- codex-workflow-harness:begin";
const MARK_END = "<!-- codex-workflow-harness:end -->";

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
const VENDOR_PARTS = ["lib", "scripts", "verifiers", "hooks", "templates", "roles", "codex", "harness.config.schema.json", "harness.config.example.json", "package.json", "README.md", "PREFLIGHT.md", ".gitignore"];

function vendor(target) {
  const dest = join(target, VENDOR_NAME);
  mkdirSync(dest, { recursive: true });
  for (const part of VENDOR_PARTS) {
    const src = join(SELF, part);
    if (!existsSync(src)) continue;
    cpSync(src, join(dest, part), { recursive: true });
  }
  for (const h of ["lint-check.sh", "format-on-write.sh"]) {
    const p = join(dest, "hooks", h);
    if (existsSync(p)) chmodSync(p, 0o755);
  }
  ok(`vendored kit → ${VENDOR_NAME}/ (incl. codex/drive-phase.mjs, the conductor)`);
}

// ── 2. Codex skills (.agents/skills/, repo-scoped) ───────────────────────────
function installSkills(target) {
  const src = join(SELF, "codex", "skills");
  const dest = join(target, ".agents", "skills");
  mkdirSync(dest, { recursive: true });
  const names = readdirSync(src);
  for (const entry of names) {
    cpSync(join(src, entry), join(dest, entry), { recursive: true });
  }
  ok(`installed .agents/skills (${names.length}: ${names.join(", ")})`);
}

// ── 3. managed block in AGENTS.md ────────────────────────────────────────────
function mergeInstructions(target) {
  const block = readFileSync(join(SELF, "codex", "AGENTS.harness.md"), "utf8").trim();
  const dest = join(target, "AGENTS.md");
  if (!existsSync(dest)) {
    writeFileSync(dest, block + "\n");
    ok("created AGENTS.md with the harness block");
    return;
  }
  const cur = readFileSync(dest, "utf8");
  const begin = cur.indexOf(MARK_BEGIN);
  const end = cur.indexOf(MARK_END);
  if (begin !== -1 && end !== -1 && end > begin) {
    const next = cur.slice(0, begin) + block + cur.slice(end + MARK_END.length);
    if (next !== cur) {
      writeFileSync(dest, next);
      ok("updated the managed harness block in AGENTS.md");
    } else {
      info("harness block in AGENTS.md already current — left as is");
    }
  } else {
    writeFileSync(dest, cur.trimEnd() + "\n\n" + block + "\n");
    ok("appended the harness block to existing AGENTS.md");
  }
}

// ── 4. project-scoped .codex/config.toml ─────────────────────────────────────
function writeCodexConfig(target) {
  const src = join(SELF, "codex", "config.harness.toml");
  const dest = join(target, ".codex", "config.toml");
  mkdirSync(dirname(dest), { recursive: true });
  if (!existsSync(dest)) {
    cpSync(src, dest);
    ok("wrote .codex/config.toml (workspace-write sandbox, no-network default for children)");
    return;
  }
  const cur = readFileSync(dest, "utf8");
  if (cur.includes("codex-workflow-harness")) {
    info(".codex/config.toml already carries the harness settings — left as is");
    return;
  }
  cpSync(src, join(target, ".codex", "config.harness.toml"));
  info("existing .codex/config.toml found — wrote .codex/config.harness.toml for you to merge by hand");
}

// ── 5. create harness.config.json (autodetect runner verbs) ──────────────────
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
    if (!runner.dev) {
      cfg.runtime = { verifier: "none", uiFilePattern: cfg.runtime.uiFilePattern, web: cfg.runtime.web };
    }
    ok(`detected runner verbs (${runner.lint || "—"} …) and wrote harness.config.json`);
  } else {
    info("couldn't autodetect a package manager — wrote harness.config.json from the example; EDIT runner.* for your stack");
  }
  writeFileSync(dest, JSON.stringify(cfg, null, 2) + "\n");
}

// ── 6. plan/status dirs + gitignore ──────────────────────────────────────────
function scaffoldPlanDir(target) {
  const cfg = JSON.parse(readFileSync(join(target, "harness.config.json"), "utf8"));
  const planDir = join(target, cfg.planDir || "docs/redesign");
  const statusDir = join(target, cfg.statusDir || "docs/redesign/.status");
  mkdirSync(planDir, { recursive: true });
  mkdirSync(statusDir, { recursive: true });
  const tdir = join(SELF, "templates");
  for (const [tpl, out] of [["work-phases.template.md", "work-phases.md"], ["contracts.template.md", "contracts.md"]]) {
    const o = join(planDir, out);
    if (!existsSync(o) && existsSync(join(tdir, tpl))) cpSync(join(tdir, tpl), o);
  }
  ok(`created ${cfg.planDir} (with work-phases/contracts templates) + ${cfg.statusDir}`);

  const gi = join(target, ".gitignore");
  const rel = (cfg.statusDir || "docs/redesign/.status") + "/";
  const cur = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  if (!cur.includes(rel)) {
    appendFileSync(gi, (cur && !cur.endsWith("\n") ? "\n" : "") + `\n# codex-workflow-harness runtime state\n${rel}\n`);
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

  log(`\nInstalling codex-workflow-harness into ${target}\n`);
  vendor(target);
  installSkills(target);
  mergeInstructions(target);
  writeCodexConfig(target);
  writeConfig(target, force);
  scaffoldPlanDir(target);

  log(`\nDone. Next steps:`);
  log(`  1. Review harness.config.json — confirm runner.* verbs + runtime.verifier ("web" needs runtime.web.routes; else "none").`);
  log(`  2. Trust the project in Codex (it prompts on first run there) so .codex/config.toml and the skills load.`);
  log(`  3. If using the web verifier: npm i -D playwright-core (and ensure Chrome is installed).`);
  log(`  4. Walk ${VENDOR_NAME}/PREFLIGHT.md once on this machine — it validates the Codex side (skills visible, exec works, sandbox/network behavior).`);
  log(`  5. Drive: the init-harness skill once per app → plan-work-item with your brief → node ${VENDOR_NAME}/codex/drive-phase.mjs P0.\n`);
}

main();
