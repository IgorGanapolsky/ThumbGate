# Anti-babysitting gates

These hook gates turn the owner's anti-babysitting laws into blocks on the
action, instead of rules that live only as memory text.

| Law | Script and hook | What happens |
| --- | --- | --- |
| No manual steps for the person | `scripts/reply-discipline-gates.js`, `PreToolUse` on `mcp__hearthbot__post_message`, `request_decision`, `edit_message`; `Stop` for plain replies | Denies "please paste", "you need to", "sign in and", "can you run" and similar. 2FA, verification codes and passkeys are exempt. `Stop` blocks once, never in a loop. |
| Proof before claim | same `PreToolUse` | Denies "done", "deployed", "verified" and similar when nothing since the person's last message proves it (same patterns as `hook-stop-anti-claim.js`, which only sees plain assistant text, not thread replies sent through a tool). |
| Don't stop while your PR is red | `scripts/pr-discipline-gates.js`, `PostToolUse` records PRs the session opens; `Stop` | Stop is blocked while a PR the session opened has a failed check, a `needs-fix` or `needs-rebase` label, or a merge conflict. `needs-igor` and `do-not-merge` are not the agent's to fix. Gives up after 3 blocks and leaves a warning. |
| No duplicate PRs | same script, `PreToolUse` on `mcp__github__create_pull_request` and Bash `gh pr create` or `npm run ship` | Denied when an open PR has a near-identical title or touches at least half the same files (changesets, CHANGELOG and package files ignored). The PR for the same branch is not its own duplicate. |
| Keep PRs small | same `PreToolUse` | Denied over 40 files or 1,000 changed lines (from the local diff for a Bash create, so an unpushed branch is still checked); lockfiles, `dist/`, snapshots and source maps don't count. |

Every gate fails open on an internal error.

## Turn it on

Off unless `THUMBGATE_PR_DISCIPLINE=1` is set or the project has
`config/pr-discipline.json` with `{"enabled": true}`.

Hook wiring (user or project `settings.json`). The PR gates read GitHub with
`GITHUB_TOKEN` or `GH_TOKEN` (not the `gh` login). Private repositories need one
of them set; without it the PR gates fail open:

```json
{
  "hooks": {
    "PreToolUse": [{ "matcher": "mcp__hearthbot__post_message|mcp__hearthbot__request_decision|mcp__hearthbot__edit_message",
      "hooks": [{ "type": "command", "command": "node /path/to/ThumbGate/scripts/reply-discipline-gates.js pre" }] },
      { "matcher": "mcp__github__create_pull_request|Bash", "hooks": [{ "type": "command", "command": "node /path/to/ThumbGate/scripts/pr-discipline-gates.js pre" }] }],
    "PostToolUse": [{ "matcher": "mcp__github__create_pull_request|Bash", "hooks": [{ "type": "command", "command": "node /path/to/ThumbGate/scripts/pr-discipline-gates.js post" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "node /path/to/ThumbGate/scripts/reply-discipline-gates.js stop" },
      { "type": "command", "command": "node /path/to/ThumbGate/scripts/pr-discipline-gates.js stop" }] }]
  }
}
```

## Cloud project threads

Claude project threads start in the parent of the cloned repository, so a
repository's `.claude/settings.json` hooks never load there. To run these gates
in every thread, the cloud environment's setup script writes the wiring above
into the user-level `~/.claude/settings.json`, pointing at the cloned checkout,
and sets `THUMBGATE_PR_DISCIPLINE=1`.
