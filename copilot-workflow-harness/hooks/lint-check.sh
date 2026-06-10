#!/usr/bin/env bash
# Post-edit lint gate (agent-runtime hook wrapper).
# Thin wrapper: pipes the tool envelope (stdin) into the stack-agnostic hook-runner, which reads
# the linter command + behavior from harness.config.json (hooks.lint). Real errors BLOCK the
# agent (exit 2, fed back via stderr); warnings are surfaced as non-blocking context.
#
# Optional live wiring: VS Code Copilot agent hooks (preview) — see PREFLIGHT.md §7. hook-selftest drives it directly either way.
exec node "$(dirname "$0")/../lib/hook-runner.mjs" lint
