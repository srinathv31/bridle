#!/usr/bin/env bash
# Post-edit auto-format (agent-runtime hook wrapper).
# Thin wrapper around the stack-agnostic hook-runner, which reads the formatter command from
# harness.config.json (hooks.format) and rewrites the edited file in place. Non-blocking: a
# missing/broken formatter is surfaced on stderr, never a silent no-op.
#
# Optional live wiring: VS Code Copilot agent hooks (preview) — see PREFLIGHT.md §7. hook-selftest drives it directly either way.
exec node "$(dirname "$0")/../lib/hook-runner.mjs" format
