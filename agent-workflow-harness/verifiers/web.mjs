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
// Reads everything from harness.config.json → runtime.web: { baseUrl, browserChannel, auth?,
// routes: [{ path, auth?, interactions: [{ label, role, name }] }] }. The gate only catches a
// freeze on an interaction it actually drives, so list each route's real controls there.
//
// AUTH: routes behind a session (e.g. RLS-gated pages that notFound() for anon) set auth: true
// and run in a shared context that logged in ONCE via runtime.web.auth — { credentialsFile,
// loginPath, emailLabel, passwordLabel, submit: { role, name } }. Credentials are READ AT RUNTIME
// from the gitignored credentialsFile; they never live in this config or in the report. A failed
// login is SETUP (fails loud) — otherwise auth routes would silently degrade to load-only checks.
//
// HYDRATION: dev-mode SSR paints an interactive-looking page before the framework attaches
// handlers; fills/clicks in that gap are silently swallowed (login flaked SETUP this way under
// Turbopack). Login and route interactions wait for a deterministic hydration marker (framework
// expando keys on the target element) before acting — see waitForHydration.
//
// REQUIRES playwright-core + a Chrome channel (or swap to full `playwright` + `playwright install`).
// Invoke standalone:  node verifiers/web.mjs   ·   HEADED=1 node verifiers/web.mjs

import { readFileSync } from "node:fs";

import { loadConfig } from "../lib/config.mjs";
import { exitCodeFor } from "./index.mjs";

const MIN_FRAMES = 20;
const WINDOW_MS = 800;
const PROBE_HARD_MS = 12000;
const GOTO_MS = 20000;
const ACTION_MS = 6000;
const LOGIN_MS = 20000;
const HYDRATION_MS = 10000;
const LOGIN_ATTEMPTS = 2;

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

// Dev-mode SSR (e.g. Next.js under Turbopack) paints a complete, clickable-looking page long
// before the framework hydrates it. An input filled in that gap is wiped when hydration replays
// the controlled value, and a click is dispatched into a void with no handler attached — the
// action "succeeds" but drives nothing. Waiting for load states can't see this; the DOM is done.
// What CAN see it: React/Vue stamp internal expando keys (__reactFiber$…, __reactProps$…,
// __vueParentComponent) onto every DOM node they hydrate, so their appearance on the target
// element is a deterministic hydration-complete signal. Unknown frameworks (or no client JS)
// never get a marker — fall back to networkidle so this stays best-effort, bounded, and never
// throws.
async function waitForHydration(page, locator, timeoutMs) {
  let handle;
  try {
    handle = await locator.first().elementHandle({ timeout: timeoutMs });
  } catch {
    return false; // element never appeared — the caller's own action will report that properly
  }
  const hydrated = await page
    .waitForFunction(
      (el) => {
        const marked = (node) =>
          Object.keys(node).some(
            (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactProps$") || k.startsWith("__vueParentComponent"),
          );
        for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
          if (marked(n)) return true;
        }
        return false;
      },
      handle,
      { timeout: timeoutMs },
    )
    .then(() => true)
    .catch(() => false);
  if (!hydrated) {
    await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => {});
  }
  return hydrated;
}

// Accepts JSON ({ email, password }), markdown "**Email:** `x`" lines, or plain "email: x" /
// "EMAIL=x" lines — so a human-readable gitignored credentials doc works as-is.
function parseCredentials(text) {
  try {
    const j = JSON.parse(text);
    if (j && typeof j === "object") return { email: j.email, password: j.password };
  } catch {
    // not JSON — fall through to line formats
  }
  const grab = (key) => {
    const md = text.match(new RegExp("\\*\\*" + key + ":?\\*\\*:?\\s*`([^`]+)`", "i"));
    if (md) return md[1];
    const kv = text.match(new RegExp("^\\s*" + key + "\\s*[:=]\\s*(\\S+)\\s*$", "im"));
    return kv ? kv[1] : undefined;
  };
  return { email: grab("email"), password: grab("password") };
}

// Log in once; returns { ctx } on success or { error } (message only — never the credentials).
async function login(browser, auth, BASE, cfg) {
  let creds;
  try {
    creds = parseCredentials(readFileSync(cfg.abs(auth.credentialsFile), "utf8"));
  } catch (e) {
    return { error: `could not read auth credentialsFile ${auth.credentialsFile}: ${e.message}` };
  }
  if (!creds.email || !creds.password) {
    return { error: `no email/password found in ${auth.credentialsFile} (expected JSON, "**Email:** \`x\`", or "email: x" lines)` };
  }
  const loginPath = auth.loginPath || "/login";
  const submit = auth.submit || { role: "button", name: "Sign in" };
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const r = await withTimeout(
    (async () => {
      const emailLoc = page.getByLabel(auth.emailLabel || "Email");
      const passwordLoc = page.getByLabel(auth.passwordLabel || "Password");
      const submitLoc = page.getByRole(submit.role, { name: submit.name });
      await page.goto(BASE + loginPath, { waitUntil: "domcontentloaded", timeout: GOTO_MS });
      let lastError = null;
      for (let attempt = 1; attempt <= LOGIN_ATTEMPTS; attempt++) {
        // never fill/click a form the framework hasn't taken over yet (see waitForHydration)
        await waitForHydration(page, submitLoc, HYDRATION_MS);
        await emailLoc.fill(creds.email, { timeout: ACTION_MS });
        await passwordLoc.fill(creds.password, { timeout: ACTION_MS });
        await submitLoc.click({ timeout: ACTION_MS });
        // success = we navigated off the login page; staying put means bad creds or a broken form
        const navigated = await page
          .waitForURL((u) => new URL(u).pathname !== loginPath, { timeout: LOGIN_MS })
          .then(() => true)
          .catch((e) => {
            lastError = String(e).split("\n")[0];
            return false;
          });
        if (navigated) return { ok: true };
        // Discriminate WHY we're still here: if the email field no longer holds what we typed,
        // the fill/click was swallowed (late hydration wipe or a native no-handler form reload)
        // — tooling race, retry. If it survived, the form is live and the login itself was
        // rejected — retrying identical credentials can't help, fail loud now.
        const wiped = await emailLoc
          .inputValue({ timeout: 2000 })
          .then((v) => v !== creds.email)
          .catch(() => true);
        if (!wiped) return { ok: false, error: "form is interactive but login was rejected (check credentials)" };
      }
      return { ok: false, error: lastError || "stayed on " + loginPath };
    })().catch((e) => ({ ok: false, error: String(e).split("\n")[0] })),
    GOTO_MS + LOGIN_ATTEMPTS * (HYDRATION_MS + 3 * ACTION_MS + LOGIN_MS) + 5000,
    { ok: false, error: "login hard-timed out" },
  );
  await withTimeout(page.close().catch(() => {}), 5000, null);
  if (!r.ok) {
    await withTimeout(ctx.close().catch(() => {}), 5000, null);
    return { error: `login as the ${auth.credentialsFile} user failed (${r.error || "stayed on " + loginPath}) — auth routes cannot be verified` };
  }
  return { ctx };
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

  // Routes marked auth: true share ONE logged-in context (cookie session persists per context).
  // A failed/unconfigured login is SETUP, not a pass — an anon context would notFound() those
  // routes and the declared interactions would silently never fire.
  let authCtx = null;
  if (routes.some((r) => r.auth)) {
    if (!web.auth || !web.auth.credentialsFile) {
      await withTimeout(browser.close().catch(() => {}), 5000, null);
      return { verdict: "SETUP", overall: "SETUP", detail: { error: "routes declare auth: true but runtime.web.auth.credentialsFile is not configured" } };
    }
    const r = await login(browser, web.auth, BASE, cfg);
    if (r.error) {
      await withTimeout(browser.close().catch(() => {}), 5000, null);
      return { verdict: "SETUP", overall: "SETUP", detail: { error: r.error } };
    }
    authCtx = r.ctx;
  }

  const results = [];
  try {
    for (const route of routes) {
      const url = BASE + route.path;
      const page = await (route.auth ? authCtx.newPage() : browser.newPage());
      const errs = [];
      page.on("console", (m) => {
        if (m.type() === "error") errs.push(m.text().slice(0, 120));
      });
      const rr = { route: route.path, authenticated: !!route.auth, stages: [] };
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
            const interactions = route.interactions || [];
            // Same pre-hydration race as login(): a click dispatched before the framework
            // attaches handlers "succeeds" while driving nothing, so the canary would silently
            // verify less than the config declares. Bounded and best-effort — on timeout we fall
            // through to the click, whose own error handling stays authoritative.
            if (interactions.length > 0) {
              const first = interactions[0];
              await waitForHydration(page, page.getByRole(first.role, { name: first.name }), HYDRATION_MS);
            }
            for (const it of interactions) {
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
    if (authCtx) await withTimeout(authCtx.close().catch(() => {}), 5000, null);
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
