---
"thumbgate": patch
---

Install-scope docs (README, guide page, `install-mcp` help) now say what `init` really writes: Claude Code hooks go machine-wide to `~/.claude/settings.local.json`, the MCP entry goes to the repo's `.mcp.json`, and lessons stay per repo in `<repo>/.thumbgate/`. The old table promised a lesson store shared across repos and a per-project hooks file from `init --project`; neither was true. `install-mcp` help no longer claims it writes hooks or a `--no-hooks` flag.
