# Claude Code Call-Budget Gate (Opt-In)

`scripts/hook-call-budget.js` counts tool calls per Claude Code `session_id` and nudges oversized lead sessions to hand mechanical work to a cheaper subagent or side session:

- **PreToolUse:** Tracks `totalCalls` and `mechanicalCalls` (`Bash`/shell, browser automation tools, and chat/transcript/inbox search tools). Once a session passes the threshold (**default `300`**) and calls a mechanical tool, it **denies once** with:
  > `This session is large; hand mechanical work to a Sonnet subagent or side session.`
  Subsequent calls in the same session are allowed (`deniedOnce = true`), and delegation tools (`Agent`, `Task`, `TodoWrite`, `AskUserQuestion`) are never denied.
- **Stop:** Emits a single `systemMessage` line with the session's call count:
  > `Session <session_id> call count: <N> tool calls (<M> mechanical).`

## How to Enable in `~/.claude/settings.json`

Add `scripts/hook-call-budget.js` under `hooks.PreToolUse` and `hooks.Stop` in `~/.claude/settings.json` (left untouched by default so the Claude Code lead can review and enable it):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "node /Users/iganapolsky/workspace/ThumbGate/scripts/hook-call-budget.js"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node /Users/iganapolsky/workspace/ThumbGate/scripts/hook-call-budget.js --stop"
          }
        ]
      }
    ]
  }
}
```

## Optional Environment Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `THUMBGATE_CALL_BUDGET_THRESHOLD` | `300` | Session call threshold (`--threshold=N` CLI flag also supported). |
| `THUMBGATE_CALL_BUDGET_DIR` | `$TMPDIR/thumbgate-call-budget` | Directory storing per-session JSON counters. |
| `THUMBGATE_CALL_BUDGET_GATE` | enabled when hook is wired (`0`/`off` disables) | Also activates the gate inside `scripts/hook-pre-tool-use.js` when set to `1`. |
| `THUMBGATE_CALL_BUDGET_MECHANICAL_RE` | *(unset)* | Optional extra regex matching custom mechanical tool names. |
