# ThumbGate app mods

Mods for the Claude app (desktop, web, mobile) and Claude Code, shipped as a small plugin marketplace.

## usage-bar

A band above the prompt (Claude desktop app and Code on the web; the terminal keeps your own status line) that refreshes every minute and shows:

- tokens used today on this machine (since midnight ET, every session and subagent) and this session, the cost at API prices (an estimate, not a bill; your plan is flat-rate) and the model mix
- context window fill, the weekly limit with its reset time, and the 5-hour window
- the latest ThumbGate version, 👍/👎 counts and a link to the dashboard

👍/👎 counts come from the local ThumbGate MCP server where the session can reach it. In a cloud session a mod can't call tools on your computer, so the band reads a copy at `/mnt/project-files/usage-bar/thumbgate.json` when a project task keeps one there.

Commands:

- `/usage` opens a pane with today's tokens and cost by model, the session, limits and ThumbGate. Minimized on the desktop app it becomes a small widget: today's cost, tokens and thumbs.
- `/usage-bar full|compact|off` sets the band (kept between sessions). Narrow windows get the one-line form on their own.
- `/usage-bar-refresh` re-reads everything now.

Install:

```bash
claude plugin marketplace add ./plugins/claude-app-mods
claude plugin install usage-bar@thumbgate-app-mods --scope user
```

Test: `claude plugin test plugins/claude-app-mods/usage-bar`
