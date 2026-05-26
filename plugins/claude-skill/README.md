# ThumbGate Feedback Skill for Claude Code

Capture thumbs up/down feedback into structured prevention rules directly from Claude Code.

## Features

- Activates on feedback triggers: "thumbs up", "thumbs down", "that worked", "that failed"
- Negative triggers prevent false activation on unrelated tasks
- Session-start context loading with `npm run feedback:summary`
- Prevention rules auto-generated from repeated mistakes

## Install

```bash
npx thumbgate init --agent claude
```

Or copy manually:

```bash
cp plugins/claude-skill/SKILL.md .claude/skills/thumbgate-feedback.md
```

## MCP Server

Add to `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "thumbgate": {
      "command": "npx",
      "args": ["--yes", "--package", "thumbgate@latest", "thumbgate", "serve"]
    }
  }
}
```

## Links

- [Documentation](https://thumbgate-production.up.railway.app/guide?utm_source=claude-code)
- [Pro Plan](https://thumbgate-production.up.railway.app/pricing?utm_source=claude-code)
- [GitHub](https://github.com/IgorGanapolsky/ThumbGate)
