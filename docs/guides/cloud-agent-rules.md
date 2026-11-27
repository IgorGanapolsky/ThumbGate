# Cloud agents and ThumbGate rules

ThumbGate's gates run as hooks on your machine. Cloud agents never load those hooks. That covers claude.ai projects, Claude Code on the web, Codex cloud tasks and Cursor background agents. Each one works in a fresh clone of your repo, so a rule ThumbGate learned from your thumbs-downs never fires on their turns.

What those agents do read is instruction files in the repo. Claude Code loads every `.claude/rules/*.md`, and Codex, Cursor and most other agents read `AGENTS.md`. `thumbgate export-rules` writes your learned rules there.

```bash
npx thumbgate export-rules                 # .claude/rules/thumbgate.md (Claude Code)
npx thumbgate export-rules --target=agents # a marked block in AGENTS.md (Codex, Cursor, others)
npx thumbgate export-rules --target=all    # both
git add .claude/rules/thumbgate.md && git commit -m "chore: export ThumbGate rules"
```

## What goes in

- Live auto-promoted gates, split into "Blocked: do not run" and "Ask the user first", each with its regex. Expired and inactive gates stay out.
- Claim rules: the kinds of status claim that need a check in the same turn.
- Prevention rules from `thumbgate rules`, as one line each.
- Lessons, only with `--include-lessons`. They are raw feedback text, so they stay out by default.

Every line is run through secret and PII redaction, and home paths become `~`. The file has no timestamp or fire counts, so it only changes when a rule changes.

## Keeping it current

Once the file exists, `thumbgate session-start` (the SessionStart hook) rewrites it whenever the rules change. It only touches files that carry the export marker, and it never creates one. Commit the change with your normal work. In CI, `npx thumbgate export-rules --check` exits 1 when the committed file is stale.

## What it does not do

A cloud agent follows these rules by reading them. Nothing blocks the call the way a local PreToolUse hook does. For hard enforcement, run the agent where the hooks are installed.
