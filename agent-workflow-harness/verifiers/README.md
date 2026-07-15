# Runtime verifiers — the pluggable "is it actually alive?" check

Static checks (lint, typecheck, test) tell you the code is well-formed. They do **not** tell you
the built thing _works when exercised_. That question has a different shape on every stack:

- a **web** page can render a full DOM, log zero console errors, and still **freeze on the first
  click** — only driving an interaction reveals it;
- an **HTTP service** is "alive" if it answers a real request with a contract-shaped body;
- a **CLI** is alive if it runs and exits 0 with the expected output.

So the gate delegates this judgment to a **runtime verifier** selected by `runtime.verifier` in
`harness.config.json`. `web` (Playwright freeze-canary) ships built-in and is **only invoked for
web apps**. Everything else is a plugin you drop in.

## The contract

A verifier is an ES module that exports an async `verify(cfg)`:

```js
// verifiers/my-verifier.mjs
export async function verify(cfg) {
  // ...exercise the real surfaces, gather re-runnable evidence...
  return {
    verdict: "LIVE", // LIVE | FROZEN | BROKEN | INCONCLUSIVE | SKIPPED | SETUP
    overall: "PASS", // PASS | FAIL | INCONCLUSIVE | SKIPPED | SETUP
    detail: {
      /* any JSON: per-surface results the caller can cite/re-run */
    },
  };
}
```

`overall` maps to the gate's exit code (see `exitCodeFor` in `index.mjs`):

| `overall`      | Meaning                                             | Exit |
| -------------- | --------------------------------------------------- | ---- |
| `PASS`         | every exercised surface is alive                    | 0    |
| `SKIPPED`      | nothing to verify on this project/phase             | 0    |
| `FAIL`         | a surface is frozen/broken — a **real defect**      | 1    |
| `INCONCLUSIVE` | tooling flakiness, not an app failure               | 2    |
| `SETUP`        | the verifier itself couldn't run (missing dep/tool) | 3    |

`INCONCLUSIVE` and `SETUP` do **not** silently pass the gate — _"no tooling-excuse without a
positive control."_ A verifier that can't prove the app is alive fails loud.

## Selecting one

```jsonc
// harness.config.json
"runtime": {
  "verifier": "web",                 // built-in name…
  // "verifier": "none",             // …or no-op (libraries, non-runtime phases)
  // "verifier": "verifiers/api.mjs" // …or a path (relative to project root) to your adapter
}
```

`run-gate.mjs` runs the verifier after the static checks. It does **not** manage your app's
lifecycle — the conductor/QA brings the dev server up first (the web verifier hits
`runtime.web.baseUrl`); a verifier that can't reach the app returns `SETUP`.

A work-item triggers the runtime leg when one of its files matches `runtime.uiFilePattern`
(`phase-items.mjs` sets `isUI` from it). Point that pattern at whatever files imply a runtime
surface on your stack (web pages, route handlers, endpoints).

## Built-ins

- **`web`** (`web.mjs`) — loads each `runtime.web.routes[]` entry, probes the main thread with an
  animation-frame + timer canary, drives each declared interaction (`getByRole(role, {name})`),
  and **re-probes after every action** to distinguish a real freeze (page unresponsive) from
  Playwright flakiness (action failed but page still responsive). Routes behind a session (RLS,
  auth guards) set `auth: true` and share one context logged in via `runtime.web.auth` — the
  credentials stay in a gitignored `credentialsFile`, and a failed login is `SETUP`, never a
  silent load-only pass. Requires `playwright-core` + a Chrome channel. Runnable standalone:
  `node verifiers/web.mjs`.
- **`none`** (`none.mjs`) — returns `SKIPPED`. The gate runs static checks only.

## Writing an `api` verifier (sketch)

No browser needed — just drive endpoints and assert the response shape. ~40 lines:

```js
// verifiers/api.mjs
export async function verify(cfg) {
  const base = cfg.runtime.api?.baseUrl ?? "http://localhost:8000";
  const probes = cfg.runtime.api?.probes ?? []; // [{ method, path, expectStatus, expectKeys }]
  const surfaces = [];
  for (const p of probes) {
    try {
      const res = await fetch(base + p.path, { method: p.method ?? "GET" });
      const body = await res.json().catch(() => ({}));
      const okStatus = res.status === (p.expectStatus ?? 200);
      const okShape = (p.expectKeys ?? []).every((k) => k in body);
      surfaces.push({
        path: p.path,
        status: res.status,
        ok: okStatus && okShape,
      });
    } catch (e) {
      surfaces.push({ path: p.path, ok: false, error: String(e) });
    }
  }
  const allOk = surfaces.length > 0 && surfaces.every((s) => s.ok);
  return {
    verdict: allOk ? "LIVE" : "BROKEN",
    overall: surfaces.length === 0 ? "SKIPPED" : allOk ? "PASS" : "FAIL",
    detail: { base, surfaces },
  };
}
```

Then: add `"runtime": { "verifier": "verifiers/api.mjs", "api": { "baseUrl": "...", "probes": [...] } }`.
The harness's own P8 QA did exactly this matrix by hand against a live server — promoting it to a
verifier makes it a re-runnable gate. A `cli` verifier follows the same shape: `spawnSync` the
built binary, assert exit 0 + stdout against a golden file.
