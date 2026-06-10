#!/usr/bin/env node
// install.mjs — stand the whole harness up in a target project with ONE command.
//
//   node /path/to/copilot-workflow-harness/install.mjs              # install into the current dir
//   node /path/to/copilot-workflow-harness/install.mjs --target /p  # …into /p
//   node /path/to/copilot-workflow-harness/install.mjs --force      # overwrite an existing harness.config.json
//
// What it does (idempotent — safe to re-run to UPDATE):
//   1. vendors the kit into <target>/copilot-workflow-harness/      (scripts, lib, verifiers, hooks, templates, roles)
//   2. installs the GitHub Copilot bindings into <target>/.github/  (agents/*.agent.md, prompts/*.prompt.md)
//   3. merges the harness block into <target>/.github/copilot-instructions.md (managed-marker block)
//   4. merges harness settings into <target>/.vscode/settings.json  (terminal auto-approve allowlist, edits
//      auto-approve for the plan dir, maxRequests) — falls back to a side-file if settings.json is JSONC
//   5. creates <target>/harness.config.json from the example (only if absent; --force overwrites),
//      autodetecting your package manager's lint/typecheck/test verbs where it can
//   6. creates planDir + statusDir and gitignores the statusDir
//
// Zero dependencies — node:fs / node:path only.

import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync, chmodSync, readdirSync, appendFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const SELF = dirname(fileURLToPath(import.meta.url)); // the harness repo
const VENDOR_NAME = "copilot-workflow-harness"; // the dir name vendored into the target
const MARK_BEGIN = "<!-- copilot-workflow-harness:begin";
const MARK_END = "<!-- copilot-workflow-harness:end -->";

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
const VENDOR_PARTS = ["lib", "scripts", "verifiers", "hooks", "templates", "roles", "harness.config.schema.json", "harness.config.example.json", "package.json", "README.md", "PREFLIGHT.md", ".gitignore"];

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
  ok(`vendored kit → ${VENDOR_NAME}/`);
}

// ── 2. GitHub Copilot bindings (.github/agents + .github/prompts) ────────────
function installGithub(target) {
  const ghSrc = join(SELF, "github");
  const dest = join(target, ".github");
  let counts = {};
  for (const sub of ["agents", "prompts"]) {
    const src = join(ghSrc, sub);
    if (!existsSync(src)) continue;
    const out = join(dest, sub);
    mkdirSync(out, { recursive: true });
    let n = 0;
    for (const entry of readdirSync(src)) {
      cpSync(join(src, entry), join(out, entry), { recursive: true });
      n++;
    }
    counts[sub] = n;
  }
  ok(`installed .github/agents (${counts.agents || 0}), .github/prompts (${counts.prompts || 0})`);
}

// ── 3. managed block in .github/copilot-instructions.md ─────────────────────
function mergeInstructions(target) {
  const block = readFileSync(join(SELF, "github", "copilot-instructions.harness.md"), "utf8").trim();
  const dest = join(target, ".github", "copilot-instructions.md");
  mkdirSync(dirname(dest), { recursive: true });
  if (!existsSync(dest)) {
    writeFileSync(dest, block + "\n");
    ok("created .github/copilot-instructions.md with the harness block");
    return;
  }
  const cur = readFileSync(dest, "utf8");
  const begin = cur.indexOf(MARK_BEGIN);
  const end = cur.indexOf(MARK_END);
  if (begin !== -1 && end !== -1 && end > begin) {
    const next = cur.slice(0, begin) + block + cur.slice(end + MARK_END.length);
    if (next !== cur) {
      writeFileSync(dest, next);
      ok("updated the managed harness block in .github/copilot-instructions.md");
    } else {
      info("harness block in copilot-instructions.md already current — left as is");
    }
  } else {
    writeFileSync(dest, cur.trimEnd() + "\n\n" + block + "\n");
    ok("appended the harness block to existing .github/copilot-instructions.md");
  }
}

// ── 4. merge harness settings into .vscode/settings.json ────────────────────
function mergeSettings(target) {
  const snippet = JSON.parse(readFileSync(join(SELF, "vscode", "settings.harness.json"), "utf8"));
  delete snippet["$comment"];
  const settingsPath = join(target, ".vscode", "settings.json");
  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch {
      const fallback = join(target, ".vscode", "settings.harness.json");
      mkdirSync(dirname(fallback), { recursive: true });
      cpSync(join(SELF, "vscode", "settings.harness.json"), fallback);
      info("existing .vscode/settings.json isn't plain JSON (comments?) — wrote .vscode/settings.harness.json for you to merge by hand");
      return;
    }
  }
  let changed = false;
  for (const [key, val] of Object.entries(snippet)) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      settings[key] = settings[key] || {};
      for (const [k, v] of Object.entries(val)) {
        if (!(k in settings[key])) {
          settings[key][k] = v;
          changed = true;
        }
      }
    } else if (!(key in settings)) {
      settings[key] = val;
      changed = true;
    }
  }
  if (changed) {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    ok("merged harness settings into .vscode/settings.json (auto-approve allowlist, maxRequests)");
  } else {
    info("harness settings already present in .vscode/settings.json — left as is");
  }
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
    appendFileSync(gi, (cur && !cur.endsWith("\n") ? "\n" : "") + `\n# copilot-workflow-harness runtime state\n${rel}\n`);
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

  log(`\nInstalling copilot-workflow-harness into ${target}\n`);
  vendor(target);
  installGithub(target);
  mergeInstructions(target);
  mergeSettings(target);
  writeConfig(target, force);
  scaffoldPlanDir(target);

  log(`\nDone. Next steps:`);
  log(`  1. Review harness.config.json — confirm runner.* verbs + runtime.verifier ("web" needs runtime.web.routes; else "none").`);
  log(`  2. If using the web verifier: npm i -D playwright-core (and ensure Chrome is installed).`);
  log(`  3. Walk ${VENDOR_NAME}/PREFLIGHT.md once on this machine — it validates the Copilot side (agents visible, prompts visible, model names, auto-approve).`);
  log(`  4. Reload VS Code, then in Copilot Chat: /init-harness  →  /plan-work-item <brief>  →  /run-phase P0.\n`);
}

main();
