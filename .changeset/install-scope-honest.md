---
"thumbgate": patch
---

`npx thumbgate init --project` now writes the Claude Code hooks to `<repo>/.claude/settings.json`, so they run only in that repo. Before, init ignored `--project` and always wrote `~/.claude/settings.local.json`. Plain `init` is unchanged. The install-scope docs (README, guide page, `install-mcp` help) now also say that lessons stay per repo in `<repo>/.thumbgate/` in both scopes. The old table promised a lesson store shared across repos. `install-mcp` help no longer claims it writes hooks.
