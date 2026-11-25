# Anti-babysitting gates

These hook gates turn the owner's anti-babysitting laws into blocks on the
action, instead of rules that live only as memory text.

| Law | Script and hook | What happens |
| --- | --- | --- |
| No manual steps for the person | `scripts/reply-discipline-gates.js`, `PreToolUse` on `mcp__hearthbot__post_message`, `request_decision`, `edit_message`; `Stop` for plain replies | Denies "please paste", "you need to", "sign in and", "can you run" and similar. 2FA, verification codes and passkeys are exempt. `Stop` blocks once, never in a loop. |
| Proof before claim | same `PreToolUse` | Denies "done", "deployed", "verified" and similar when nothing since the person's last message proves it (same patterns as `hook-stop-anti-claim.js`, which only sees plain assistant text, not thread replies sent through a tool). |
| Don't stop while your PR is red; no duplicate or oversized PRs | `scripts/pr-discipline-gates.js` (follow-up) | Stop is blocked while a PR the session opened is red, needs-fix or needs-rebase; PR create is denied for a near-duplicate title, file overlap, or over 40 files / 1,000 lines. |

Every gate fails open on an internal error.

## Turn it on

Off unless `THUMBGATE_PR_DISCIPLINE=1` is set or the project has
`config/pr-discipline.json` with `{"enabled": true}`.

Hook wiring (user or project `settings.json`):

```json
{
  "hooks": {
    "PreToolUse": [{ "matcher": "mcp__hearthbot__post_message|mcp__hearthbot__request_decision|mcp__hearthbot__edit_message",
      "hooks": [{ "type": "command", "command": "node /path/to/ThumbGate/scripts/reply-discipline-gates.js pre" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "node /path/to/ThumbGate/scripts/reply-discipline-gates.js stop" }] }]
  }
}
```

## Cloud project threads

Claude project threads start in the parent of the cloned repository, so a
repository's `.claude/settings.json` hooks never load there. To run these gates
in every thread, the cloud environment's setup script writes the wiring above
into the user-level `~/.claude/settings.json`, pointing at the cloned checkout,
and sets `THUMBGATE_PR_DISCIPLINE=1`.
