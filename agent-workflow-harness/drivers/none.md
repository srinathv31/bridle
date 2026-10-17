# Driver: `none`

The project has no UI to drive (an API, a library, a CLI). There is no preflight, and `none` is never a blocker.

## Walkthroughs without a UI

Exercise the changed surface directly:

- **HTTP:** start the server the way `runner.dev` says, then call the endpoints the work-item touches with `curl`. Check the status code, the response shape and any side effect (a row written, a job queued).
- **CLI or library:** run the command or a small script, and check its output and exit code.

Record in your report's coverage notes that the checks were HTTP-only or CLI-only, so nobody mistakes them for a UI walkthrough. Screenshot steps don't apply; cite the request and the response instead.
