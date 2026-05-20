---
"thumbgate": patch
---

Add regression test for a previously-shipped class of bug where ThumbGate's hook command builders dropped the subcommand on the fast path (`exec "$BIN"` instead of `exec "$BIN" "<subcommand>"`). When the runtime binary existed (always, after first install), Claude Code would exec bare `thumbgate`, which prints the help screen — that help became users' statusline; the gate-check/cache-update/session-start/hook-auto-capture hooks became silent no-ops; and re-running `thumbgate init` would silently reinstall the broken settings.

The bug is already fixed in current source (`scripts/published-cli.js` correctly includes `${escapedArgs ? \` ${escapedArgs}\` : ''}` on both branches). These tests lock the behavior in:

- `tests/published-cli.test.js` — three new tests asserting the fast-path *independently* contains the subcommand, that every hook subcommand appears exactly twice (once per branch), and that `preferInstalled=false` keeps the subcommand on its exec line.
- `tests/hook-runtime-subcommands.test.js` (new) — higher-level guard over `statuslineCommand`, `preToolHookCommand`, `userPromptHookCommand`, `sessionStartHookCommand`, `cacheUpdateHookCommand`. Asserts each result contains its subcommand AND never matches the `exec PATH` pattern without a subcommand argument.

Together these prevent future refactors of `resolveCliCommand` from re-introducing the bug class even on new branches (Volta shim, source checkout, additional builders).
