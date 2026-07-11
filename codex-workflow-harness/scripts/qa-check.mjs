#!/usr/bin/env node
// qa-check.mjs — the mechanical verification of agent-claim truth. A QA report is a pile of
// CLAIMS; this checks the load-bearing ones against ground truth so a bare assertion or a
// confabulated quote can't pass as a result. It judges whether the REPORT is honest about its
// own evidence — not whether the app works (that's the runtime verifier).
//
// Hard checks (→ exit 1):
//   MISSING_ARTIFACT   — a cited screenshot/image, or a `path:line` reference, not on disk.
//   CONFABULATED_QUOTE — a blockquote attributed to a local file whose text is NOT in that file
//                        ANYWHERE. (A quote present in the file but at a drifted line is NOT a
//                        confabulation — see STALE_CITATION below.)
// Soft checks (warn; fail only with --strict):
//   STALE_CITATION     — quote present in the file but not within the cited line window, or a
//                        line ref past EOF. The evidence is real; the line number drifted (e.g.
//                        a later fix shifted lines). Bump the citation; don't rewrite the report.
//   UNBACKED_VERDICT   — a PASS/FIXED block with no citation of any kind.
//   UNVERIFIABLE       — a quote pointing at a transcript/URL this script can't reach.
//
// App-agnostic: the path/extension allowlist that decides "what is a citable artifact" is built
// from harness.config.json (source.dirs + source.extensions). Add your language's extensions
// there or non-JS source citations silently escape both checks (fail-open) — the one porting
// trap in this script.
//
// Usage: node scripts/qa-check.mjs [--strict] [report.md ...]   (default: newest in planDir)
// Exit: 0 = clean · 1 = hard violation (or soft under --strict) · 2 = usage / read error

import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { loadConfig } from "../lib/config.mjs";

const cfg = loadConfig();
const ROOT = cfg.root;
const REPORTS_DIR = cfg.planDirAbs;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const dirAlt = cfg.source.dirs.map(esc).join("|");
const extAlt = cfg.source.extensions.map(esc).join("|");

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg)$/i;
const PATH_TOKEN = new RegExp(`(?:^|[\\s(\`"'])((?:${dirAlt})\\/[\\w./@-]+\\.(?:${extAlt}))(:\\d+)?`, "g");
const CITE = /(?:—|–|--|source:|src:|see:)\s*(\S[^\s]*?)(?::(\d+))?\s*$/i;
const VERDICT = /\b(?:FIXED|Fixed|fixed|PASS|PASSED|passes|passed|passing|ready to advance|all green)\b|✓|✅/;

const norm = (s) => s.replace(/[“”„]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
const stripQuotes = (s) => s.replace(/^["'`]+/, "").replace(/["'`]+$/, "").trim();
const looksLikePath = (t) => {
  const s = stripQuotes(t);
  return /^https?:\/\//i.test(s) || s.includes("/") || /\.\w{1,5}(:\d+)?$/.test(s);
};

function classifyTarget(rawTarget, rawLine) {
  const target = stripQuotes(rawTarget);
  if (/^https?:\/\//i.test(target)) return { kind: "url", target };
  if (target.startsWith("~") || /\/\.claude\//.test(target) || /\.jsonl$/.test(target)) return { kind: "transcript", target };
  const m = target.match(/^(.*?):(\d+)$/);
  const path = m ? m[1] : target;
  const line = rawLine ? Number(rawLine) : m ? Number(m[2]) : null;
  return { kind: "local", target: path, line };
}

function readFileSafe(absPath) {
  try {
    return readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
}

function extractCitedQuotes(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (!/^\s*>/.test(lines[i])) {
      i++;
      continue;
    }
    const group = [];
    while (i < lines.length && /^\s*>/.test(lines[i])) {
      group.push(lines[i].replace(/^\s*>\s?/, ""));
      i++;
    }
    let candidate = null;
    let quoteLines = group.slice();
    for (let g = group.length - 1; g >= 0; g--) {
      if (group[g].trim() === "") continue;
      if (CITE.test(group[g])) {
        candidate = group[g];
        quoteLines = group.slice(0, g);
      }
      break;
    }
    if (!candidate) {
      let k = i;
      while (k < lines.length && lines[k].trim() === "") k++;
      if (k < lines.length && CITE.test(lines[k])) candidate = lines[k];
    }
    let cite = null;
    if (candidate) {
      const m = candidate.match(CITE);
      if (m && looksLikePath(m[1])) cite = classifyTarget(m[1], m[2]);
    }
    if (!cite) {
      const text = stripQuotes(norm(group.join(" ")));
      if (/["“”]/.test(text) && text.length > 0) out.push({ text, cite: null });
      continue;
    }
    out.push({ text: stripQuotes(norm(quoteLines.join(" "))), cite });
  }
  return out;
}

function checkQuote(q, violations, warnings) {
  if (!q.cite) {
    warnings.push({ type: "UNCITED_QUOTE", detail: `quote with no source: "${truncate(q.text)}"` });
    return;
  }
  if (q.cite.kind !== "local") {
    warnings.push({ type: "UNVERIFIABLE", detail: `${q.cite.kind} quote (script can't reach it — verify by hand): ${q.cite.target}` });
    return;
  }
  if (q.text.length < 12) {
    warnings.push({ type: "UNVERIFIABLE", detail: `quote too short to grep reliably: "${q.text}" (${q.cite.target})` });
    return;
  }
  const abs = resolve(ROOT, q.cite.target);
  const body = readFileSafe(abs);
  if (body === null) {
    violations.push({ type: "MISSING_ARTIFACT", detail: `quote cites a file that doesn't exist: ${q.cite.target}` });
    return;
  }
  // Ground-truth check, drift-tolerant:
  //  - present in the file ANYWHERE? if not → CONFABULATED (hard).
  //  - present, and a line was cited but the quote isn't in that line's window → STALE_CITATION
  //    (soft): the evidence is real, only the line number drifted. This is the single most
  //    common false-positive — a mid-phase fix shifts lines a report already cited — and it must
  //    NOT read as fabrication.
  const whole = norm(body);
  if (!whole.includes(q.text)) {
    violations.push({ type: "CONFABULATED_QUOTE", detail: `quote not found anywhere in ${q.cite.target} → "${truncate(q.text)}"` });
    return;
  }
  if (q.cite.line) {
    const fileLines = body.split("\n");
    const lo = Math.max(0, q.cite.line - 3);
    const hi = Math.min(fileLines.length, q.cite.line + 2);
    const windowed = norm(fileLines.slice(lo, hi).join(" "));
    if (!windowed.includes(q.text)) {
      warnings.push({ type: "STALE_CITATION", detail: `quote is in ${q.cite.target} but not near line ${q.cite.line} — bump the line ref → "${truncate(q.text)}"` });
    }
  }
}

function checkArtifacts(content, violations, warnings) {
  const seen = new Set();
  let m;
  PATH_TOKEN.lastIndex = 0;
  while ((m = PATH_TOKEN.exec(content)) !== null) {
    const path = m[1];
    const line = m[2] ? Number(m[2].slice(1)) : null;
    const key = path + (line ? ":" + line : "");
    if (seen.has(key)) continue;
    seen.add(key);
    const isImage = IMAGE_EXT.test(path);
    if (!isImage && line === null) continue;
    const abs = resolve(ROOT, path);
    if (!existsSync(abs)) {
      violations.push({ type: "MISSING_ARTIFACT", detail: `cited path does not exist: ${key}` });
      continue;
    }
    const st = statSync(abs);
    if (isImage && st.size === 0) {
      violations.push({ type: "MISSING_ARTIFACT", detail: `cited screenshot is empty (0 bytes): ${path}` });
    }
    if (line !== null) {
      const n = readFileSafe(abs)?.split("\n").length ?? 0;
      if (line > n) warnings.push({ type: "STALE_CITATION", detail: `cited line past EOF: ${key} (file has ${n} lines) — fix the line ref` });
    }
  }
}

function checkUnbackedVerdicts(content, warnings) {
  const blocks = content.split(/^(?=#{1,6}\s)/m);
  for (const block of blocks) {
    const head = block.split("\n", 1)[0].trim();
    if (!/^#{1,6}\s/.test(head)) continue;
    if (!VERDICT.test(block)) continue;
    const hasArtifact =
      /```/.test(block) ||
      new RegExp(PATH_TOKEN.source, "i").test(block) ||
      /:\d+\b/.test(block) ||
      /(?:—|--|source:)/i.test(block);
    if (!hasArtifact) warnings.push({ type: "UNBACKED_VERDICT", detail: `verdict with no cited artifact under: ${head}` });
  }
}

function truncate(s, n = 70) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function checkReport(reportPath) {
  const content = readFileSafe(reportPath);
  if (content === null) return { reportPath, readable: false, violations: [], warnings: [] };
  const violations = [];
  const warnings = [];
  const lines = content.split("\n");
  for (const q of extractCitedQuotes(lines)) checkQuote(q, violations, warnings);
  checkArtifacts(content, violations, warnings);
  checkUnbackedVerdicts(content, warnings);
  return { reportPath, readable: true, violations, warnings };
}

function discoverNewest() {
  const glob = new RegExp(cfg.report.discoverGlob);
  let entries = [];
  try {
    entries = readdirSync(REPORTS_DIR).filter((f) => glob.test(f));
  } catch {
    return [];
  }
  if (entries.length === 0) return [];
  const withTime = entries.map((f) => {
    const p = join(REPORTS_DIR, f);
    return { p, mtime: statSync(p).mtimeMs };
  });
  withTime.sort((a, b) => b.mtime - a.mtime);
  return [withTime[0].p];
}

function main() {
  const argv = process.argv.slice(2);
  const strict = argv.includes("--strict");
  const fileArgs = argv.filter((a) => a !== "--strict");
  const reports = fileArgs.length ? fileArgs.map((a) => resolve(process.cwd(), a)) : discoverNewest();

  if (reports.length === 0) {
    console.error(`qa-check: no report given and none found under ${cfg.rel(REPORTS_DIR)}/ (glob ${cfg.report.discoverGlob})`);
    process.exit(2);
  }

  let hardTotal = 0;
  let softTotal = 0;
  let unreadable = 0;

  for (const r of reports) {
    const { readable, violations, warnings } = checkReport(r);
    const rel = cfg.rel(r);
    if (!readable) {
      console.error(`✗ ${rel} — cannot read report`);
      unreadable++;
      continue;
    }
    hardTotal += violations.length;
    softTotal += warnings.length;
    if (violations.length === 0 && warnings.length === 0) {
      console.log(`✓ ${rel} — all cited evidence resolves; no confabulated quotes`);
      continue;
    }
    console.log(`\n${rel}`);
    for (const v of violations) console.log(`  ✗ ${v.type}: ${v.detail}`);
    for (const w of warnings) console.log(`  ⚠ ${w.type}: ${w.detail}`);
  }

  console.log(`\nqa-check: ${reports.length} report(s) · ${hardTotal} violation(s) · ${softTotal} warning(s)` + (strict ? " · strict" : ""));

  if (unreadable > 0) process.exit(2);
  if (hardTotal > 0) process.exit(1);
  if (strict && softTotal > 0) process.exit(1);
  process.exit(0);
}

main();
