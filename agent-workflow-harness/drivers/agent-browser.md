# Driver: `agent-browser`

Drives a headless browser through the `agent-browser` CLI (Vercel Labs), called from Bash. It needs no MCP server and no display, so it works over SSH, Remote Control and CI. For anything not covered here, run `agent-browser skills get core` for the tool's own usage guide.

## Preflight

1. `agent-browser --version` prints a version.
2. `agent-browser open <baseUrl>` then `agent-browser snapshot -i` lists the page's interactive elements with `@e` refs. That is your positive control. Use `harness.config.json` → `runtime.web.baseUrl`, or the URL `runner.dev` prints.
3. If the open or the snapshot fails on a page that loads in `curl`, run `agent-browser doctor`. If it still fails, stop and report a blocker.

Use a named session per agent (`--session <agent-or-item-id>`) when other agents may be driving the browser at the same time.

## Commands

| Need                         | Command                                                                     |
| ---------------------------- | --------------------------------------------------------------------------- |
| Open a route                 | `agent-browser open <url>`                                                  |
| Read the page (refs)         | `agent-browser snapshot -i` (interactive elements only)                     |
| Click                        | `agent-browser click @e3`                                                   |
| Fill a field                 | `agent-browser fill @e5 'text'`                                             |
| Pick an option / check a box | `agent-browser select @e7 'Value'`, `agent-browser check @e8`               |
| Keys                         | `agent-browser press Enter`                                                 |
| Wait for state               | `agent-browser wait <selector>` or `agent-browser wait 500`                 |
| Computed style, JS checks    | `agent-browser eval "getComputedStyle(document.querySelector('h1')).color"` |
| Console output / page errors | `agent-browser console`, `agent-browser errors`                             |
| Screenshot to a file         | `agent-browser screenshot <path>.png`                                       |
| Save or restore a login      | `agent-browser state save <file>`; `agent-browser state load <file>` before `open` |
| Finish                       | `agent-browser close`                                                       |

Refs change when the page changes. Take a new `snapshot -i` after every navigation or state change before using a ref.

## Rules

- **Keep output small.** Use `snapshot -i`, not a full snapshot. Only open a screenshot when you need a visual check; the file path is enough evidence.
- **Prefer `fill` and `click` over key sequences.** On macOS, long runs of `press` are unreliable (agent-browser #2053 floods key events; #2079 can swap the browser and lose cookies). If a flow genuinely needs many key presses, note it in the report.
- A command that hangs or times out is a candidate liveness defect. Re-run the runtime verifier on that route before calling it a tooling problem.
- Save screenshots to the path the skill names (for example `<planDir>/phase-<id>-qa-screenshots/`) and cite the path as evidence.
