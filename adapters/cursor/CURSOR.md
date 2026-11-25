# Cursor `beforeShellExecution` hook

Cursor's shell guard hook speaks a different JSON contract than Claude Code PreToolUse hooks.

| Surface | stdin | stdout |
| --- | --- | --- |
| Cursor `beforeShellExecution` | `{"command":"..."}` | `{"permission":"allow"\|"deny"}` |
| `thumbgate gate-check` | `{"tool_name":"Bash","tool_input":{"command":"..."}}` | `hookSpecificOutput.permissionDecision` |

Wire ThumbGate with `cursor-shell-gate`, which maps both directions and reuses the same `gates-engine` pipeline as `gate-check` (hard floor secret guard, security scan, learned rules). It does **not** turn on `THUMBGATE_STRICT_ENFORCEMENT`.

Add to `~/.cursor/hooks.json` under `beforeShellExecution`:

```json
{
  "command": "node /path/to/ThumbGate/scripts/cursor-shell-gate.js",
  "timeout": 10
}
```

Or after install:

```json
{
  "command": "npx --yes --package thumbgate@1.42.1 thumbgate cursor-shell-gate",
  "timeout": 10
}
```

Remove any entry that pipes Cursor's payload directly to `thumbgate gate-check` — that hook expects Claude's PreToolUse shape and Cursor will ignore its stdout.
## Thumbs-down holds, chat send rules and the claim gate

The marketplace plugin (`plugins/cursor-marketplace/hooks/hooks.json`) also wires:

| Cursor hook | Command | What it does |
| --- | --- | --- |
| `beforeSubmitPrompt` | `scripts/prompt-capture.sh` | A typed thumbs-down is captured and holds the action that drew it before the next tool call |
| `beforeMCPExecution` | `scripts/cursor-hook.sh mcp-gate` | MCP calls (chat sends included) go through the gates: holds, raw URL, "I do not know", second new bubble |
| `afterShellExecution`, `afterMCPExecution`, `afterAgentResponse` | `scripts/cursor-hook.sh record` | Records the turn for the claim gate |
| `stop` | `scripts/cursor-hook.sh stop` | An unchecked status claim ("sign-in is refused", "the host is down") gets one follow-up message sending the agent back to check |

Cursor runs plugin hooks from the plugin directory, so ThumbGate reads the project from `workspace_roots[0]`.
