---
"thumbgate": minor
---

feat(cli): seamless auto-update — every CLI invocation refreshes thumbgate@latest in the background

Adds `scripts/auto-update-cli.js` and wires it into `bin/cli.js` at the
top of every CLI invocation. On each `thumbgate <command>` call:

1. Check `~/.thumbgate/.last-update-check` — skip if < 24h old.
2. If stale (or never set), spawn a fully-detached
   `npm install -g --silent thumbgate@latest` and touch the marker.
3. The user's command runs immediately; the install completes in
   the background. The next invocation gets the newer version.

**Behavior:**
- Non-blocking. Zero added latency on the user's command.
- Throttled to ≤ 1 install attempt per 24 hours per machine.
- Permission-safe. Silent failure if npm install fails.
- Opt-out via `THUMBGATE_NO_AUTO_UPDATE=1`.
- Auto-skipped in CI environments and `NODE_ENV=test`.

Companion to the Volta hook shim (`scripts/install-shim.js`) which
already handles hook auto-update. This closes the gap for direct CLI calls.
