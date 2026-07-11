#!/usr/bin/env node
// hook-runner.mjs — the stack-agnostic engine behind the lint/format PostToolUse hooks. The
// bash wrappers (hooks/*.sh) just pipe Claude Code's tool envelope into this with a mode arg.
//
//   node lib/hook-runner.mjs lint     < envelope
//   node lib/hook-runner.mjs format   < envelope
//
// All behavior comes from harness.config.json → hooks.{lint,format}:
//   command     "<linter> ... {file}"   ({file} is replaced with the edited file's path)
//   extensions  ["ts","tsx",...]        only these file types are processed
//   ignore      ["node_modules",...]    path-substring skips
//   parser      "eslint-json" | (unset) richer parsing for ESLint; otherwise generic
//   blockOn     "error" | "nonzero"     lint only — when to BLOCK the agent (exit 2)
//
// Generic contract (any linter): if `command` exits non-zero, its output is surfaced to the
// agent — BLOCKING (exit 2) when blockOn fires, else as non-blocking context. eslint-json adds
// the error-vs-warning distinction (errors block, warnings surface). Format hooks are always
// non-blocking: they rewrite the file in place and only note a failure.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, basename } from "node:path";
import { loadConfig } from "./config.mjs";

function readEnvelope() {
  let raw = "";
  try {
    raw = readFileSync(0, "utf8"); // fd 0 = stdin
  } catch {
    /* no stdin */
  }
  try {
    const d = JSON.parse(raw || "{}");
    return (d.tool_input && d.tool_input.file_path) || "";
  } catch {
    return "";
  }
}

function ext(p) {
  return extname(p).replace(/^\./, "").toLowerCase();
}

function runConfigured(command, file) {
  const cmd = command.replace(/\{file\}/g, JSON.stringify(file));
  const cfg = loadConfig();
  return spawnSync(cmd, { shell: true, cwd: cfg.root, encoding: "utf8" });
}

function emitContext(text) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text } }) + "\n",
  );
}

function lint(hook, file) {
  const r = runConfigured(hook.command, file);
  const name = basename(file);

  if (hook.parser === "eslint-json") {
    let data = [];
    try {
      data = JSON.parse(r.stdout || "[]");
    } catch {
      process.exit(0); // eslint crashed/produced no JSON — nothing reliable to gate on
    }
    let errors = 0,
      warnings = 0;
    const lines = [];
    for (const result of data) {
      errors += result.errorCount || 0;
      warnings += result.warningCount || 0;
      for (const m of result.messages || []) {
        const sev = m.severity === 2 ? "error" : "warning";
        lines.push(`  ${m.line ?? "?"}:${m.column ?? "?"}  ${sev}  ${(m.message || "").trim()}  (${m.ruleId || "?"})`);
      }
    }
    const body = lines.join("\n");
    if (errors > 0) {
      process.stderr.write(`Lint found ${errors} error(s) in ${name} — fix before continuing:\n${body}\n`);
      process.exit(2);
    }
    if (warnings > 0) {
      emitContext(`Lint reported ${warnings} warning(s) in ${name}. Treat as real signal, not noise:\n${body}`);
    }
    process.exit(0);
  }

  // generic linter: non-zero exit = findings
  const exit = r.status ?? 0;
  if (exit === 0) process.exit(0);
  const out = ((r.stdout || "") + (r.stderr || "")).trim();
  const block = hook.blockOn === "error" || hook.blockOn === "nonzero";
  if (block) {
    process.stderr.write(`Lint failed on ${name} (exit ${exit}) — fix before continuing:\n${out}\n`);
    process.exit(2);
  }
  emitContext(`Lint reported issues in ${name} (exit ${exit}):\n${out}`);
  process.exit(0);
}

function format(hook, file) {
  const r = runConfigured(hook.command, file);
  if ((r.status ?? 0) !== 0) {
    process.stderr.write(`format-on-write: formatter failed on ${basename(file)}; left unformatted\n`);
  }
  process.exit(0);
}

function main() {
  const mode = process.argv[2]; // "lint" | "format"
  const cfg = loadConfig();
  const hook = cfg.hooks && cfg.hooks[mode];
  if (!hook || !hook.command) process.exit(0); // not configured → no-op

  const file = readEnvelope();
  if (!file || !existsSync(file)) process.exit(0);

  const e = ext(file);
  if (Array.isArray(hook.extensions) && hook.extensions.length && !hook.extensions.includes(e)) process.exit(0);
  if (Array.isArray(hook.ignore) && hook.ignore.some((frag) => file.includes(frag))) process.exit(0);

  if (mode === "lint") lint(hook, file);
  else if (mode === "format") format(hook, file);
  else process.exit(0);
}

main();
