# Claude Code: ThumbGate Feedback Skill Install

Install the skill in under 60 seconds. No manual file editing required.

## One-Command Install

```bash
cp plugins/claude-skill/SKILL.md .claude/skills/rlhf-feedback.md
```

Or from the published npm package:

```bash
npx mcp-memory-gateway init
cp node_modules/mcp-memory-gateway/plugins/claude-skill/SKILL.md .claude/skills/rlhf-feedback.md
```

## What This Does

Copies the skill definition to `.claude/skills/` so Claude Code loads it automatically on next launch.

The skill activates on triggers: "thumbs up", "thumbs down", "that worked", "that failed".

## Verify

After copying, restart Claude Code and run:

```bash
# Claude Code will show available skills:
# rlhf-feedback — Capture thumbs up/down feedback into structured memories
```

Then test it:

```bash
node .thumbgate/capture-feedback.js --feedback=up --context="skill install verified" --tags="install"
```

## What You Get

- Automatic feedback capture on quality signals
- Prevention rules generated from repeated mistakes
- Session-start context loading: `npm run feedback:summary && npm run feedback:rules`

## Requirements

- Claude Code (any version)
- Node.js 18+ in PATH
- `.thumbgate/` directory (created by `npx mcp-memory-gateway init`)

## Uninstall

```bash
rm .claude/skills/rlhf-feedback.md
```
