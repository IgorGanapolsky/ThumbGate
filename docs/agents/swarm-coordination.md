# Swarm coordination

One read-only census. It does not write the vault, open Linear issues, push GitButler, or call TypeSafe.

```bash
node scripts/swarm-coordination-doctor.js
node scripts/swarm-coordination-doctor.js --json
npx thumbgate swarm-coordination --json
```

| Surface | Role |
| --- | --- |
| Checkout lease | One live session owns the working tree |
| Obsidian | `~/Documents/Igor` is the live vault. `Agents/Claims/` and `Agent-Jobs/running/` hold ThumbGate claims. `~/Documents/AI-Agent-Sync` is included only when that directory exists |
| Linear | Recorded absence when `~/.config/linear/api_key` is missing. GitHub issues stay the board |
| GitHub issues | Open titles must be unique |
| NotebookLM | `~/Documents/Igor/NotebookLM` is a read mirror, not a claim store |
| GitButler | `{conflicted}` on an applied stack is a collision |
| TypeSafe / Jev | Typed questions only. Code owns pass, review, and block. Jev does not coordinate agents |

Exit 2 means a collision. Exit 0 with an absence means that surface was missing and the census said so. The session sweep is `bash .claude/scripts/session-bootstrap/fleet-coordination-check.sh`.
