// verifiers/none.mjs — the no-op runtime verifier.
//
// For projects with no runtime surface to exercise at the gate: a library, a pure data layer, a
// codegen tool, or a phase that ships only non-runtime files. The gate still runs lint /
// typecheck / test — it just skips the "is it alive when driven" leg.
//
// Selected by `"runtime": { "verifier": "none" }` in harness.config.json.

export async function verify() {
  return { verdict: "SKIPPED", overall: "SKIPPED", detail: { note: "no runtime verifier configured (runtime.verifier = none)" } };
}
