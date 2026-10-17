# Driver: `simctl-axe`

Drives an iOS app in the Simulator with `xcrun simctl` (boot, install, launch, deep links, screenshots) and the AXe CLI (read the accessibility tree, tap, swipe, type), both called from Bash. It needs no MCP server and no Simulator window, so it works over SSH and Remote Control. AXe's own guide: `axe --help` and `axe <command> --help`.

## Preflight

1. `axe --version` prints a version, and `xcrun simctl list devices booted` shows a booted simulator. Use its UDID (`<udid>` below) in every command. If several are booted, use the one the work-item targets and name it in your report.
2. The app is built, installed and running. Start it the way `runner.dev` says (for an Expo dev client, start Metro, then launch the app with `xcrun simctl launch <udid> <bundle-id>`).
3. `axe describe-ui --udid <udid>` returns the app's accessibility tree. That is your positive control. **The first call after a boot can fail with "Timed out creating the simulator remote automation session"; retry once.**
4. If the second attempt also fails, stop and report a blocker.

## Reading the screen

`describe-ui` prints a large JSON tree. Never paste it whole into the conversation; filter it to the elements you need:

```bash
axe describe-ui --udid <udid> | python3 -c '
import json, sys
def walk(n):
    if isinstance(n, list):
        for x in n: walk(x)
        return
    if n.get("AXLabel") or n.get("AXUniqueId"):
        print("%s | %s | %s | %s" % (n.get("role"), n.get("AXLabel"), n.get("AXUniqueId"), n.get("AXFrame")))
    for c in n.get("children") or []: walk(c)
walk(json.load(sys.stdin))'
```

Frames are in points: `{{x, y}, {width, height}}`. Use them to check layout (for example, that content stays inside the safe area).

## Commands

| Need                                 | Command                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Tap by identifier                    | `axe tap --id <AXUniqueId> --udid <udid>` (preferred)                                                  |
| Tap by label                         | `axe tap --label '<text>' --element-type Button --udid <udid>`                                         |
| Tap a point                          | `axe tap -x <x> -y <y> --udid <udid>`                                                                  |
| Type into the focused field          | tap the field first, then `axe type '<text>' --udid <udid>`                                            |
| Scroll / swipe                       | `axe swipe --start-x 200 --start-y 550 --end-x 200 --end-y 150 --udid <udid>`                          |
| Go back (no back button in the tree) | edge swipe: `axe swipe --start-x 8 --start-y 340 --end-x 300 --end-y 340 --duration 0.4 --udid <udid>` |
| Several steps in one call            | `axe batch --udid <udid> --step 'tap --id a' --step 'sleep 1' --step 'tap --id b'`                     |
| Deep link                            | `xcrun simctl openurl <udid> '<scheme>://path'`                                                        |
| Screenshot to a file                 | `xcrun simctl io <udid> screenshot <path>.png`                                                         |
| Relaunch the app                     | `xcrun simctl terminate <udid> <bundle-id>` then `xcrun simctl launch <udid> <bundle-id>`              |

## Rules

- **AXe actions are fire-and-forget.** "Tap completed successfully" only means the event was sent. After every action, read the screen again and check the outcome. For typed text, check the field's `AXValue`, not whether the label appears somewhere.
- **Label traps.** `--label` can match the whole-screen `AXApplication` element (for example the app's name) and tap the screen's center. A label shared by several elements taps nothing. Prefer `--id`; otherwise add `--element-type`.
- **Not everything is in the tree.** Some system controls, such as navigation back buttons on some devices, have no element. Use the edge swipe.
- **Deep links on iOS 27 ask first.** `simctl openurl` on a running app shows an "Open in …?" alert; tap its Open button.
- **Screenshots are for visual checks only.** Downscale before viewing (`sips -Z 800 <path>.png`); the accessibility tree is the evidence for structure and text.
- **Liveness.** No built-in freeze-canary exists for the Simulator. If the tree stops changing after actions or the app ignores input, relaunch and repeat once. If it happens again, it is a liveness defect.
- Save screenshots to the path the skill names (for example `<planDir>/phase-<id>-qa-screenshots/`) and cite the path as evidence.

## Expo dev client

- The dev launcher may not find Metro by itself. Tap `Enter URL manually` (`--element-type Button`), tap the field, type `http://localhost:<port>`, then tap `Connect`.
- On a first launch the Expo developer menu covers the app. Close it with `axe tap --id xmark --udid <udid>`.
- Don't `openurl` the dev-client URL within about 10 seconds of a cold launch; wait until the app reports it is ready.
