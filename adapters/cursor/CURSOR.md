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
  "command": "npx --yes --package thumbgate@1.39.0 thumbgate cursor-shell-gate",
  "timeout": 10
}
```

Remove any entry that pipes Cursor's payload directly to `thumbgate gate-check` — that hook expects Claude's PreToolUse shape and Cursor will ignore its stdout.