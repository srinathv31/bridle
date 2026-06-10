// verifiers/index.mjs — the runtime-verifier plugin registry.
//
// "Runtime truth" — does the built thing actually WORK when exercised, not just compile — has a
// different shape per stack: a web app can render a full DOM and still freeze on the first click;
// an HTTP service is "alive" if it answers with a contract-shaped body; a CLI is alive if it runs
// and exits 0. So the gate delegates that judgment to a pluggable VERIFIER selected by
// `runtime.verifier` in harness.config.json.
//
// THE CONTRACT — a verifier module default-exports (or named-exports) an async function:
//
//   export async function verify(cfg) => {
//     verdict:  "LIVE" | "FROZEN" | "BROKEN" | "INCONCLUSIVE" | "SKIPPED" | "SETUP",
//     overall:  "PASS" | "FAIL" | "INCONCLUSIVE" | "SKIPPED",
//     detail:   <any JSON — per-surface results, evidence the caller can re-run/cite>,
//   }
//
//   PASS      → every exercised surface is alive (exit 0)
//   FAIL      → at least one surface is frozen/broken — a real defect (exit 1)
//   INCONCLUSIVE → tooling flakiness, not an app failure (exit 2)
//   SKIPPED   → this project has no runtime surface to verify (exit 0)
//   SETUP     → the verifier itself couldn't run (missing browser/dep) (exit 3)
//
// `runtime.verifier` is either a built-in name ("web" | "none") or a path (relative to the
// project root) to your own adapter module that satisfies the contract above. To add an "api" or
// "cli" verifier, drop a module next to this one (or anywhere) and point the config at it — see
// verifiers/README.md.

import { pathToFileURL } from "node:url";

const BUILTINS = {
  web: new URL("./web.mjs", import.meta.url),
  none: new URL("./none.mjs", import.meta.url),
};

export async function loadVerifier(cfg) {
  const name = (cfg.runtime && cfg.runtime.verifier) || "none";
  const spec = BUILTINS[name] || pathToFileURL(cfg.abs(name));
  let mod;
  try {
    mod = await import(spec);
  } catch (e) {
    throw new Error(`verifier "${name}" could not be loaded (${spec}): ${e.message}`);
  }
  const verify = mod.verify || mod.default;
  if (typeof verify !== "function") {
    throw new Error(`verifier "${name}" must export a verify(cfg) function`);
  }
  return { name, verify };
}

// map a verifier result to a process exit code (used by run-gate and standalone verifier CLIs)
export function exitCodeFor(result) {
  switch (result.overall) {
    case "PASS":
    case "SKIPPED":
      return 0;
    case "FAIL":
      return 1;
    case "INCONCLUSIVE":
      return 2;
    default:
      return 3; // SETUP / unknown
  }
}
