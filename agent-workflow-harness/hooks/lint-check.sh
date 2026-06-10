#!/usr/bin/env bash
# Claude Code PostToolUse hook — lint gate after Write/Edit.
# Thin wrapper: pipes the tool envelope (stdin) into the stack-agnostic hook-runner, which reads
# the linter command + behavior from harness.config.json (hooks.lint). Real errors BLOCK the
# agent (exit 2, fed back via stderr); warnings are surfaced as non-blocking context.
#
# Wire it up in .claude/settings.json under hooks.PostToolUse (matcher: "Write|Edit").
exec node "$(dirname "$0")/../lib/hook-runner.mjs" lint
