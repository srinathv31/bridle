#!/usr/bin/env node
// hook-selftest.mjs — prove the lint/format hooks actually fire and have teeth, so a dead/no-op
// hook can't masquerade as a working safety net. A hook that always exits 0 on bad input is
// indistinguishable from a working one until you feed it something bad on purpose.
//
// For each hook it writes a KNOWN-BAD fixture (from config.hooks.<hook>.selftest) and asserts the
// hook reacts:
//   lint   — given a file the configured linter flags, the hook must SURFACE it (exit 2 or output)
//   format — given a badly-formatted file, the hook must reformat it on disk
//
// The fixture is a CONFIG VALUE, not hardcoded — that's the one irreducibly per-stack piece. Set
// hooks.lint.selftest.{filename,content} to something your linter is guaranteed to flag, and
// hooks.format.selftest.{filename,content} to something your formatter will rewrite.
//
// Run at session start and in CI. Exit: 0 = alive · 1 = a hook is dead/toothless · 2 = setup.

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadConfig } from "../lib/config.mjs";

const cfg = loadConfig();
const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const LINT_HOOK = join(KIT, "hooks", "lint-check.sh");
const FMT_HOOK = join(KIT, "hooks", "format-on-write.sh");
const TMP = join(cfg.root, ".hook-selftest-tmp");

const env = { ...process.env, CLAUDE_PROJECT_DIR: cfg.root };
const envelope = (filePath) => JSON.stringify({ tool_input: { file_path: filePath } });

function runHook(hookPath, filePath) {
  const r = spawnSync("bash", [hookPath], { input: envelope(filePath), encoding: "utf8", env, cwd: cfg.root });
  return { status: r.status ?? 0, out: (r.stdout || "") + (r.stderr || "") };
}

function main() {
  for (const [label, p] of [["lint-check.sh", LINT_HOOK], ["format-on-write.sh", FMT_HOOK]]) {
    if (!existsSync(p)) {
      console.error(`hook-selftest: missing hook ${label} at ${p}`);
      process.exit(2);
    }
  }

  mkdirSync(TMP, { recursive: true });
  let dead = 0;
  try {
    // ---- lint hook ----
    const lintCfg = cfg.hooks && cfg.hooks.lint;
    if (lintCfg && lintCfg.command && lintCfg.selftest) {
      const fx = join(TMP, lintCfg.selftest.filename || "lint-fixture.ts");
      writeFileSync(fx, lintCfg.selftest.content);
      const lint = runHook(LINT_HOOK, fx);
      const reacted = lint.status !== 0 || /error|warning|lint|✗|⚠/i.test(lint.out);
      if (reacted) console.log(`✓ lint-check.sh is ALIVE — surfaced the planted issue (exit ${lint.status})`);
      else {
        console.log("✗ lint-check.sh is DEAD — fixture should be flagged but the hook stayed silent (exit 0, no output)");
        dead++;
      }
    } else {
      console.log("• lint hook not configured (hooks.lint.command/selftest) — skipping");
    }

    // ---- format hook ----
    const fmtCfg = cfg.hooks && cfg.hooks.format;
    if (fmtCfg && fmtCfg.command && fmtCfg.selftest) {
      const fx = join(TMP, fmtCfg.selftest.filename || "fmt-fixture.ts");
      const ugly = fmtCfg.selftest.content;
      writeFileSync(fx, ugly);
      runHook(FMT_HOOK, fx);
      const after = existsSync(fx) ? readFileSync(fx, "utf8") : ugly;
      if (after !== ugly) console.log("✓ format-on-write.sh is ALIVE — reformatted the badly-formatted fixture");
      else {
        console.log("✗ format-on-write.sh is DEAD — fixture was not reformatted (formatter missing or not running)");
        dead++;
      }
    } else {
      console.log("• format hook not configured (hooks.format.command/selftest) — skipping");
    }
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }

  console.log(`\nhook-selftest: ${dead} dead hook(s)`);
  process.exit(dead > 0 ? 1 : 0);
}

main();
