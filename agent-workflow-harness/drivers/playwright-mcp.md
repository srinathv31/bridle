# Driver: `playwright-mcp`

Drives a browser through the Playwright MCP tools (`mcp__plugin_playwright_playwright__*`). This is the default driver.

## Preflight

1. Say `use playwright mcp` before the first browser action in the conversation. Without that cue the tools may not be used.
2. Confirm the tools are available, then `browser_navigate` to the dev server (`harness.config.json` → `runtime.web.baseUrl`, or the URL `runner.dev` prints) and take a `browser_snapshot`. A snapshot with the page's controls is your positive control.
3. If the tools are missing or the snapshot fails on a page that loads elsewhere, stop and report a blocker.

## Commands

| Need                       | Tool                                                 |
| -------------------------- | ---------------------------------------------------- |
| Open a route               | `browser_navigate`                                   |
| Read the page (refs)       | `browser_snapshot`                                   |
| Click / type / fill a form | `browser_click`, `browser_type`, `browser_fill_form` |
| Pick an option             | `browser_select_option`                              |
| Keys                       | `browser_press_key`                                  |
| Wait for state             | `browser_wait_for`                                   |
| Computed style, JS checks  | `browser_evaluate` (e.g. `getComputedStyle`)         |
| Console errors             | `browser_console_messages`                           |
| Screenshot to a file       | `browser_take_screenshot` with a `filename`          |
| Finish                     | `browser_close`                                      |

## Rules

- A browser action that hangs or times out is a candidate liveness defect. Re-run the runtime verifier on that route before calling it a tooling problem.
- Save screenshots to the path the skill names (for example `<planDir>/phase-<id>-qa-screenshots/`) and cite the path as evidence.
