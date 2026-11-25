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
  "timeout": 10,
  "failClosed": true
}
```

Or after install:

```json
{
  "command": "npx --yes --package thumbgate@latest thumbgate cursor-shell-gate",
  "timeout": 10,
  "failClosed": true
}
```

### What happens when the hook fails

- If ThumbGate's own script errors (unreadable input, engine failure) it answers `deny`, so the command does not run. `tests/cursor-fail-closed.test.js` runs this.
- The Cursor plugin's `gate-check.sh` does the same: no output, a failed command or anything that is not an allow or deny decision is answered `deny` with exit code 2.
- If Cursor itself cannot run the hook (a crash or a timeout), Cursor's own rule applies: per Cursor's hooks documentation a hook that fails that way is allowed through unless its entry sets `failClosed: true`. Every entry ThumbGate ships or writes sets it, and `thumbgate init` adds it to an older entry. We have not made Cursor time out a hook in a test; this part rests on Cursor's documentation, so check it on your Cursor version.
- Dashboard-distributed (Enterprise) hooks do not accept `failClosed`, per the same documentation, so those hooks fail open.

Remove any entry that pipes Cursor's payload directly to `thumbgate gate-check` — that hook expects Claude's PreToolUse shape and Cursor will ignore its stdout.