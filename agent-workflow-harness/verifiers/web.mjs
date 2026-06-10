// verifiers/web.mjs — the "web" runtime verifier (Backbone A for browser UIs).
//
// Per route: load → probe responsiveness → drive each interactive control → re-probe. Self-
// bounding (hard timeouts on Node's event loop), so it ALWAYS returns a verdict within seconds
// even if the page's main thread is fully pegged. A page can render a complete DOM, log zero
// console errors, and still be FROZEN — only DRIVING an interaction reveals it. This verifier is
// the sense organ for that.
//
// KEY DISCRIMINATION: an action that times out but leaves the page RESPONSIVE is tooling
// flakiness, NOT a freeze. An action after which the page is UNRESPONSIVE is a real freeze. We
// re-probe after every action to tell them apart.
//
// Reads everything from harness.config.json → runtime.web: { baseUrl, browserChannel, routes:
// [{ path, interactions: [{ label, role, name }] }] }. The gate only catches a freeze on an
// interaction it actually drives, so list each route's real controls there.
//
// REQUIRES playwright-core + a Chrome channel (or swap to full `playwright` + `playwright install`).
// Invoke standalone:  node verifiers/web.mjs   ·   HEADED=1 node verifiers/web.mjs

import { loadConfig } from "../lib/config.mjs";
import { exitCodeFor } from "./index.mjs";

const MIN_FRAMES = 20;
const WINDOW_MS = 800;
const PROBE_HARD_MS = 12000;
const GOTO_MS = 20000;
const ACTION_MS = 6000;

function withTimeout(promise, ms, onTimeout) {
  let t;
  const timer = new Promise((res) => {
    t = setTimeout(() => res(onTimeout), ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(t)), timer]);
}

const canaryFn = (windowMs) =>
  new Promise((resolve) => {
    const start = performance.now();
    let frames = 0,
      timerDelay = null;
    const tReq = performance.now();
    setTimeout(() => {
      timerDelay = Math.round(performance.now() - tReq);
    }, 50);
    (function tick() {
      frames++;
      if (performance.now() - start < windowMs) requestAnimationFrame(tick);
      else resolve({ frames, timerDelay });
    })();
  });

async function probe(page) {
  const r = await withTimeout(
    page
      .evaluate(canaryFn, WINDOW_MS)
      .then((v) => ({ responded: true, ...v }))
      .catch((e) => ({ responded: false, error: String(e).split("\n")[0] })),
    PROBE_HARD_MS,
    { responded: false, timedOut: true },
  );
  let state;
  if (!r.responded) state = "frozen";
  else if (typeof r.frames !== "number") state = "inconclusive";
  else if (r.frames >= MIN_FRAMES) state = "alive";
  else state = "frozen";
  return { state, frames: r.frames ?? null, timerDelay: r.timerDelay ?? null, timedOut: !!r.timedOut };
}

export async function verify(cfg) {
  const web = (cfg.runtime && cfg.runtime.web) || {};
  const BASE = process.env.BASE_URL || web.baseUrl || "http://localhost:3000";
  const HEADED = process.env.HEADED === "1";
  const channel = web.browserChannel || "chrome";
  const routes = web.routes || [];
  const t0 = Date.now();

  let chromium;
  try {
    ({ chromium } = await import("playwright-core"));
  } catch {
    return { verdict: "SETUP", overall: "SETUP", detail: { error: "playwright-core not installed — `npm i -D playwright-core` (or switch to full playwright)" } };
  }

  // Preflight: a server that isn't up is a SETUP problem, not a frozen app. Without this, every
  // route reports FROZEN on ERR_CONNECTION_REFUSED and "you forgot to start the dev server" is
  // indistinguishable from "the app is dead" — wrong verdict, wrong fix. Any HTTP response (even
  // a 500) counts as reachable; a slow/hanging server is left to the per-route probes, which is
  // exactly the failure they exist to judge.
  if (routes.length > 0) {
    const reachable = await fetch(BASE, { signal: AbortSignal.timeout(5000) })
      .then(() => true)
      .catch((e) => e?.name === "TimeoutError");
    if (!reachable) {
      return {
        verdict: "SETUP",
        overall: "SETUP",
        detail: { error: `server unreachable at ${BASE} — start the dev server (runner.dev) or point BASE_URL / runtime.web.baseUrl at the running one` },
      };
    }
  }

  let browser;
  try {
    browser = await chromium.launch({ channel, headless: !HEADED });
  } catch (e) {
    return { verdict: "SETUP", overall: "SETUP", detail: { error: `could not launch browser (channel=${channel}): ${e.message}` } };
  }

  const results = [];
  try {
    for (const route of routes) {
      const url = BASE + route.path;
      const page = await browser.newPage();
      const errs = [];
      page.on("console", (m) => {
        if (m.type() === "error") errs.push(m.text().slice(0, 120));
      });
      const rr = { route: route.path, stages: [] };
      try {
        const goto = await withTimeout(
          page
            .goto(url, { waitUntil: "domcontentloaded", timeout: GOTO_MS })
            .then(() => ({ ok: true }))
            .catch((e) => ({ ok: false, error: String(e).split("\n")[0] })),
          GOTO_MS + 2000,
          { ok: false, timedOut: true },
        );
        if (!goto.ok) {
          rr.stages.push({ stage: "load", state: "frozen", note: goto.error || "navigation timed out" });
          rr.verdict = "FROZEN";
        } else {
          const base = await probe(page);
          rr.stages.push({ stage: "load", ...base });
          if (base.state !== "alive") {
            rr.verdict = base.state === "inconclusive" ? "INCONCLUSIVE" : "FROZEN";
          } else {
            let frozen = false,
              inconclusive = false;
            for (const it of route.interactions || []) {
              const act = await withTimeout(
                page
                  .getByRole(it.role, { name: it.name })
                  .click({ timeout: ACTION_MS })
                  .then(() => ({ acted: true }))
                  .catch((e) => ({ acted: false, error: String(e).split("\n")[0] })),
                ACTION_MS + 2000,
                { acted: false, timedOut: true },
              );
              const after = await probe(page);
              let note;
              if (after.state === "alive")
                note = act.acted ? "responsive after interaction" : "action failed but page stayed responsive (tooling flakiness, NOT a freeze)";
              else note = "PAGE FROZE on this interaction";
              rr.stages.push({ stage: it.label, actionSucceeded: act.acted, ...after, note });
              if (after.state === "frozen") {
                frozen = true;
                break;
              }
              if (after.state === "inconclusive") {
                inconclusive = true;
                break;
              }
            }
            rr.verdict = frozen ? "FROZEN" : inconclusive ? "INCONCLUSIVE" : "LIVE";
          }
        }
        rr.consoleErrors = errs.length;
      } catch (e) {
        rr.verdict = "ERROR";
        rr.error = String(e).split("\n")[0];
      } finally {
        await withTimeout(page.close().catch(() => {}), 5000, null);
      }
      results.push(rr);
    }
  } finally {
    if (browser) await withTimeout(browser.close().catch(() => {}), 5000, null);
  }

  const anyBad = results.some((r) => r.verdict === "FROZEN" || r.verdict === "ERROR");
  const anyInc = results.some((r) => r.verdict === "INCONCLUSIVE");
  const overall = anyBad ? "FAIL" : anyInc ? "INCONCLUSIVE" : results.length === 0 ? "SKIPPED" : "PASS";
  return {
    verdict: anyBad ? "FROZEN" : anyInc ? "INCONCLUSIVE" : "LIVE",
    overall,
    detail: { mode: HEADED ? "headed" : "headless", elapsedMs: Date.now() - t0, routes: results.map((r) => r.route + ": " + r.verdict), surfaces: results },
  };
}

// standalone CLI: `node verifiers/web.mjs` — mirrors the old `pnpm liveness`
if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = loadConfig();
  const result = await verify(cfg);
  console.log(JSON.stringify(result, null, 2));
  process.exit(exitCodeFor(result));
}
