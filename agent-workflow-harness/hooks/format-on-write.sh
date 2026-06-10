#!/usr/bin/env bash
# Claude Code PostToolUse hook — auto-format after Write/Edit.
# Thin wrapper around the stack-agnostic hook-runner, which reads the formatter command from
# harness.config.json (hooks.format) and rewrites the edited file in place. Non-blocking: a
# missing/broken formatter is surfaced on stderr, never a silent no-op.
#
# Wire it up in .claude/settings.json under hooks.PostToolUse (matcher: "Write|Edit").
exec node "$(dirname "$0")/../lib/hook-runner.mjs" format
