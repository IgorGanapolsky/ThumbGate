# xAI Grok Build CLI — ThumbGate adapter

**Grok Build CLI auto-detects Claude Code conventions, so ThumbGate works on Grok Build with zero new configuration.** This directory exists to make the support explicit on the adapter matrix.

## What Grok Build is

xAI's first agentic CLI ([x.ai/cli](https://x.ai/cli)), launched in early beta May 2026 for SuperGrok Heavy subscribers. From the xAI launch and independent reviews:

- "Deliberately copied the conventions that already won": AGENTS.md, MCP, Skills, Hooks
- Auto-detects on launch: AGENTS.md / CLAUDE.md, hooks (pre/post-action), Skills (Anthropic Skills format), MCP servers
- Inspect detected config via the CLI's `/plugins` / `/hooks` / `/skills` / `/mcps` modals

## How to wire ThumbGate

Use the existing `adapters/claude/.mcp.json` — Grok Build picks it up unchanged. If your project doesn't have one yet:

```bash
npx --yes thumbgate init
```

That writes the Claude-compatible config that Grok Build also reads.

## What Grok Build picks up from ThumbGate

| ThumbGate surface | Grok Build picks it up via |
|---|---|
| MCP server (gate runtime) | auto-detected `.mcp.json` |
| PreToolUse hook | auto-detected `hooks.preToolUse` (Claude Code shape) |
| CLAUDE.md / AGENTS.md rules | auto-detected on launch |
| ThumbGate skills (`skills/thumbgate/SKILL.md`) | auto-detected Anthropic Skills format |
| Custom slash command (`.claude/commands/thumbgate-dashboard.md`) | auto-detected slash command (`/project:thumbgate-dashboard`) |
| Feedback capture | runs through the same `gate-check` command path |

## Local Dashboard Access

Grok Build users can quickly launch the local HTTP dashboard scoped to the current project by running:
```bash
thumbgate-dashboard
```
Or, within the Grok Build CLI, you can trigger it via the custom slash command:
```bash
/project:thumbgate-dashboard
```

## Verifying it works

Inside a project with ThumbGate installed, launch Grok Build and run its inspect command (per [xAI docs](https://docs.x.ai/build/overview)). Confirm:

1. `MCP servers` shows `thumbgate`
2. `Hooks` shows `preToolUse` pointing at `thumbgate gate-check`
3. `Skills` shows the ThumbGate skill if you installed it

If any of those is missing, file an issue at [github.com/IgorGanapolsky/ThumbGate/issues](https://github.com/IgorGanapolsky/ThumbGate/issues) with the inspect output.

## What we are NOT claiming

- We have **not** independently verified the integration end-to-end against a live Grok Build CLI yet. SuperGrok Heavy access is gated behind their tier.
- The claim "works on Grok Build" is based on Grok Build's documented convention-compatibility with Claude Code, plus public reviews confirming auto-detection of MCP/hooks/skills.
- Once an operator confirms end-to-end with screenshots from the `/mcps` modal, this README will be updated to reflect verified-against-live status.
