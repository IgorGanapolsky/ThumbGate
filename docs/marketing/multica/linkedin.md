Multica gives your AI agent a VPS, root shell, and a daily cron. That is a gift, until the cron fires the wrong tool call on schedule.

If you are running Multica (or any self-hosted agent orchestrator — OpenDevin, Sweep, Aider on autopilot), the failure mode is not "my agent made a mistake once." It is "my agent makes the same mistake every morning at 9am because autopilot re-runs the same pattern."

Prompt rules don't fix this. The agent reads CLAUDE.md, then the context window rolls, then the autopilot fires the next job with fresh context, then the bad pattern runs again.

ThumbGate is the tool-call-boundary enforcement layer these setups are missing. Local SQLite lesson DB on the same VPS as your agent. Pre-action checks block known-bad patterns — git push --force, rm -rf, curl | sh, cloud mutations — before the command executes.

Setup inside Multica is the same one-liner as anywhere else:

```
npx thumbgate init --agent claude-code
```

No new adapter, because Multica runs the same terminal agents (Claude Code, OpenCode) that ThumbGate already supports. The lesson DB lives in `.thumbgate/memory.sqlite` on your VPS, next to the code Multica is editing.

Guide: https://thumbgate.ai/guides/multica-thumbgate-setup

#Multica #SelfHosted #AIAgents
