# Runtime drivers

A **runtime driver** is the tool an agent uses to walk the running app by hand: open the surface, operate the controls and check what happened. `harness.config.json` → `runtime.driver` picks one:

| `runtime.driver`           | Drives                                      | Use when                                                             |
| -------------------------- | ------------------------------------------- | -------------------------------------------------------------------- |
| `playwright-mcp` (default) | a browser, via the Playwright MCP tools     | web UI; Claude Code desktop app, or a CLI with the Playwright plugin |
| `agent-browser`            | a browser, via the `agent-browser` CLI      | web UI; headless CLI sessions (SSH, Remote Control, CI)              |
| `simctl-axe`               | the iOS Simulator, via `xcrun simctl` + AXe | iOS app; CLI sessions                                                |
| `none`                     | nothing (HTTP or CLI checks instead)        | API or other non-UI project                                          |

The driver is separate from the **runtime verifier** (`runtime.verifier`, see `../verifiers/README.md`). The verifier is the automated freeze-canary that the phase gate runs. The driver is what an agent uses for walkthroughs, QA flows and defect checks.

Before the first action, every agent reads its driver's guide (`<driver>.md` in this folder) and runs the preflight. If the preflight fails, that is a blocker; report it and stop. The exception is `none`, which is never a blocker.
