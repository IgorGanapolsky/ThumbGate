# If you're running Claude Code inside Multica (or any self-hosted agent orchestrator), install pre-action checks before autopilot fires.

Multica's pitch is real: VPS + Docker + Postgres + UI, and your Claude Code / OpenCode / Code CLI agents run as jobs on a kanban board. Autopilot schedules recurring work — "every day at 9am, fetch these RSS feeds, do X."

The risk nobody discusses: autopilot magnifies tool-call mistakes. An agent that force-pushes once is a cleanup. An agent that force-pushes every morning at 9am because a scheduled job keeps hitting the same pattern is a production incident on a cron.

Prompt rules (CLAUDE.md, .cursorrules) don't survive this. Context window rolls, autopilot fires fresh context, pattern repeats.

ThumbGate fixes it at the tool-call boundary. SQLite lesson DB on the same VPS as your agent (`.thumbgate/memory.sqlite`). Pre-action checks block known-bad patterns — `git push --force`, `rm -rf`, `curl | sh`, cloud mutations — before execution.

Install is the same one-liner Multica viewers run for any terminal agent:

```
npx thumbgate init --agent claude-code
# or --agent opencode
```

No new adapter needed. Multica runs Claude Code / OpenCode / Code CLI as subprocesses, which already have first-class ThumbGate support.

Setup guide: https://thumbgate.ai/guides/multica-thumbgate-setup
Repo: https://github.com/IgorGanapolsky/ThumbGate

Works the same on local-only Multica and Tailscale-VPS Multica. Lesson memory is portable — if Multica ever gets replaced by the next orchestrator, the SQLite file moves with you.
