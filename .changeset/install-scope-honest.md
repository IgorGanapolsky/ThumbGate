---
"thumbgate": patch
---

**Claude Code hooks now actually run after `npx thumbgate init`.** init used to write them to `~/.claude/settings.local.json`, which Claude Code does not read (it reads `~/.claude/settings.json` user-wide; checked with Claude Code 2.1.332). Default init now writes `~/.claude/settings.json` and removes ThumbGate's own entries from the old file, keeping everything else in it. `npx thumbgate doctor` now fails with a clear message when the hooks are only in the unread file. Re-run `npx thumbgate init` once to move them.

`npx thumbgate init --project` now writes the hooks to `<repo>/.claude/settings.json`, so they run only in that repo. Before, init ignored `--project`. The install-scope docs (README, guide page, `install-mcp` help) now also say that lessons stay per repo in `<repo>/.thumbgate/` in both scopes. The old table promised a lesson store shared across repos.
