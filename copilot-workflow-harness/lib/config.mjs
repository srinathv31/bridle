// config.mjs — the single source of truth that turns the app-agnostic scripts into
// project-specific ones. Every harness script imports `loadConfig()` instead of hardcoding
// paths, id schemes, runner verbs, or file extensions.
//
// Resolution order for the manifest:
//   1. $HARNESS_CONFIG (absolute path), if set
//   2. the nearest harness.config.json walking UP from process.cwd()
//   3. harness.config.json sitting next to this kit (the shipped example)
//
// The directory that CONTAINS the resolved manifest is the PROJECT ROOT. All relative paths in
// the manifest (planDir, statusDir, …) resolve against that root — so the scripts run the same
// whether invoked from the repo root, a subdir, or CI.

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const KIT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULTS = {
  planDir: "docs/redesign",
  statusDir: "docs/redesign/.status",
  ids: {
    checklistItem: "(?<id>W(?<phase>\\d+)\\.\\d+)",
    phaseLabel: "P{phase}",
    phaseArg: "^P\\d+$",
  },
  source: {
    dirs: ["src", "docs", "scripts", "app", "lib", "components", "public", "tests", "test", ".claude", ".github"],
    extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg", "ts", "tsx", "js", "jsx", "mjs", "cjs", "md", "json", "css", "sql"],
  },
  report: { namePattern: "phase-{phase}-qa.md", discoverGlob: "^phase-.*-qa.*\\.md$" },
  runner: { lint: "", typecheck: "", test: "", build: "", dev: "" },
  gate: { blockOn: ["critical", "major"] },
  runtime: { verifier: "none", uiFilePattern: "^(?:src/)?app/.+\\.(?:tsx|jsx)$", web: { baseUrl: "http://localhost:3000", browserChannel: "chrome", routes: [] } },
  hooks: { lint: null, format: null },
};

function findManifest() {
  if (process.env.HARNESS_CONFIG) {
    const p = resolve(process.env.HARNESS_CONFIG);
    if (existsSync(p)) return p;
    throw new Error(`HARNESS_CONFIG points at a missing file: ${p}`);
  }
  let dir = process.cwd();
  for (;;) {
    const candidate = join(dir, "harness.config.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const shipped = join(KIT_DIR, "harness.config.json");
  if (existsSync(shipped)) return shipped;
  const example = join(KIT_DIR, "harness.config.example.json");
  if (existsSync(example)) return example;
  throw new Error("no harness.config.json found (searched up from cwd, then the kit dir). Run install.mjs in your project, or create harness.config.json at your repo root.");
}

// shallow-merge user manifest over defaults, one level into the known sub-objects
function merge(base, over) {
  const out = { ...base, ...over };
  for (const k of ["ids", "source", "report", "runner", "gate", "runtime", "hooks"]) {
    if (over && over[k] && typeof over[k] === "object" && !Array.isArray(over[k])) {
      out[k] = { ...base[k], ...over[k] };
    }
  }
  return out;
}

let cached = null;

export function loadConfig() {
  if (cached) return cached;
  const manifestPath = findManifest();
  let raw;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    throw new Error(`harness.config.json is not valid JSON (${manifestPath}): ${e.message}`);
  }
  const cfg = merge(DEFAULTS, raw);
  // The PROJECT ROOT is the dir containing the manifest, UNLESS the manifest sets `root`
  // (relative to itself). The shipped example sits in harness/ and sets "root": ".." so it runs
  // against this repo in place; a manifest placed at your repo root omits `root`.
  const manifestDir = dirname(manifestPath);
  const root = raw.root ? resolve(manifestDir, raw.root) : manifestDir;

  // resolved, absolute conveniences used everywhere downstream
  cfg.manifestPath = manifestPath;
  cfg.root = root;
  cfg.kitDir = KIT_DIR;
  cfg.abs = (rel) => resolve(root, rel);
  cfg.rel = (abs) => (abs.startsWith(root) ? abs.slice(root.length + 1) : abs);

  cfg.planDirAbs = resolve(root, cfg.planDir);
  cfg.statusDirAbs = resolve(root, cfg.statusDir);
  cfg.workPhasesAbs = join(cfg.planDirAbs, "work-phases.md");

  // compiled id matchers
  cfg.itemRe = (flags = "gm") => new RegExp("^\\s*-\\s*\\[( |x|X)\\]\\s*" + cfg.ids.checklistItem, flags);
  cfg.phaseArgRe = new RegExp(cfg.ids.phaseArg, "i");
  cfg.phaseLabel = (phaseNum) => cfg.ids.phaseLabel.replace("{phase}", String(phaseNum));

  cfg.reportPath = (phase) => join(cfg.planDirAbs, cfg.report.namePattern.replace("{phase}", phase));

  cached = cfg;
  return cfg;
}

// reset cache (tests only)
export function _reset() {
  cached = null;
}
