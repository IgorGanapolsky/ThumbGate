---
"thumbgate": patch
---

A first `thumbgate init` now wires Claude Code hooks to the stable launcher at `~/.thumbgate/bin/thumbgate-hook`, which runs `thumbgate@latest`. Before this, the hook table was built before the launcher existed, so every first install pinned its hooks to the version that ran `init` and never picked up a fix or the new upgrade line. Machines already pinned are now detected: the MCP server tells the agent once that `npx thumbgate@latest self-update` updates the hooks, and `self-update` updates the hook runtime first so a failed global install no longer leaves hooks on the old build. The first-block ping now carries the CLI version, platform and minutes since install, and `scripts/recent-commands.js`, `scripts/lesson-effect.js` and `scripts/pilot-request.js` ship in the package (they were required but missing).
