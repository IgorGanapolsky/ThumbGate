# ThumbGate app mods

Mods for the Claude app (desktop, web, mobile) and Claude Code, shipped as a small plugin marketplace.

## usage-bar

A band above the prompt that refreshes every minute and shows:

- tokens used in this session, its cost at API prices (an estimate, not a bill) and the model mix
- context window fill, the weekly limit with its reset time, and the 5-hour window
- the latest ThumbGate version, 👍/👎 counts and a link to the dashboard

👍/👎 counts come from the local ThumbGate MCP server where the session can reach it. In a cloud session a mod can't call tools on your computer, so the band reads a copy at `/mnt/project-files/usage-bar/thumbgate.json` when a project task keeps one there.

Install:

```bash
claude plugin marketplace add ./plugins/claude-app-mods
claude plugin install usage-bar@thumbgate-app-mods
```

Test: `claude plugin test plugins/claude-app-mods/usage-bar`
