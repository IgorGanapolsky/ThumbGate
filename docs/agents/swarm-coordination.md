# Swarm coordination

One read-only census. It does not write the vault, open Linear issues, push GitButler, or call TypeSafe.

```bash
node scripts/swarm-coordination-doctor.js
node scripts/swarm-coordination-doctor.js --json
npx thumbgate swarm-coordination --json
```

| Surface | Role |
| --- | --- |
| Session identity | `THUMBGATE_SESSION_AGENT` unset is degraded. A census with no identity cannot tell a foreign claim from itself |
| Checkout lease | One live session owns the working tree |
| Obsidian | `~/Documents/Igor` is the live vault. `Agents/Claims/` and `Agent-Jobs/running/` hold ThumbGate claims. `~/Documents/AI-Agent-Sync` is included only when that directory exists |
| Linear | Absence when `~/.config/linear/api_key` is missing or empty. When the file has a key, the census queries in-flight ThumbGate issues. A failed query is degraded. The key is never printed. GitHub issues stay the board |
| GitHub issues | Open titles must be unique |
| GitHub pull requests | Open titles must be unique. `gh pr list` failing is degraded |
| NotebookLM | `~/Documents/Igor/NotebookLM` is scanned as a read mirror. `Packs/` is not a claim store. `Agents/Claims/`, `Agent-Jobs/running/`, or claim-shaped markdown anywhere else in that folder is a collision |
| GitButler | `{conflicted}` on an applied stack, or a torn `but teardown` workspace, is a collision |
| Herdr | Gateway down or binary missing is an absence. Two or more agents whose cwd is this checkout are a collision. One pane is not a self-collision |
| TypeSafe / Jev | Typed questions only. Code owns pass, review, and block. Jev does not coordinate agents |

Exit 2 means a collision. Exit 0 with an absence means that surface was missing and the census said so. The session sweep is `bash .claude/scripts/session-bootstrap/fleet-coordination-check.sh`.
