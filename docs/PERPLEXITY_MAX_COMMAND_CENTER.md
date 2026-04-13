# Perplexity Max Command Center

ThumbGate uses Perplexity Max as an acquisition and GEO intelligence loop, not as a manual research toy. The command center turns the Perplexity APIs into repeatable reports for visibility, lead discovery, and weekly strategy.

## What It Runs

| Command | Purpose | API surface |
| --- | --- | --- |
| `npm run perplexity:visibility` | Checks whether high-intent AI search prompts mention ThumbGate. | Sonar chat completions |
| `npm run perplexity:leads` | Finds and scores live discussions where ThumbGate can help. | Search API |
| `npm run perplexity:brief` | Generates an acquisition/GEO strategy brief. | Agent API |
| `npm run perplexity:mcp-config` | Emits the official Perplexity MCP config for Claude Code, Codex, and other clients. | Local only |
| `npm run perplexity:full` | Runs visibility, lead discovery, Agent API brief, MCP config, and staged memory lessons. | All of the above |

Official references:

- Perplexity Agent API quickstart: https://docs.perplexity.ai/docs/agent-api/quickstart
- Perplexity Sonar quickstart: https://docs.perplexity.ai/docs/sonar/quickstart
- Perplexity Search quickstart: https://docs.perplexity.ai/docs/search/quickstart
- Official Perplexity MCP server: https://github.com/perplexityai/modelcontextprotocol

## Setup

Set the API key once:

```bash
export PERPLEXITY_API_KEY=pplx-your-key
```

Optional controls:

```bash
export PERPLEXITY_TIMEOUT_MS=120000
export PERPLEXITY_AGENT_MODEL=openai/gpt-5.4
```

The GitHub Actions workflow reads the existing `PERPLEXITY_API_KEY` secret. If the secret is missing, the workflow automatically runs in `--dry-run` mode and uploads a manual checklist instead of failing silently.

## Outputs

By default local runs write to:

```text
.thumbgate/perplexity/YYYY-MM-DD/
```

Generated files:

- `summary.json` - machine-readable run summary.
- `visibility.json` and `visibility.md` - AI-search prompt status and score.
- `leads.json` and `leads.md` - deduped, scored acquisition surfaces.
- `agent-brief.md` - Perplexity Agent API acquisition brief.
- `perplexity-mcp-config.json` - official MCP server config.
- `memory-lessons.jsonl` - local ThumbGate lessons staged from visibility gaps and lead wins.

These files are runtime artifacts. Do not commit `.thumbgate/perplexity/*`.

## Automation

GitHub Actions workflow:

```text
.github/workflows/perplexity-command-center.yml
```

Schedule:

- Daily at `12:30 UTC`: runs `visibility`.
- Monday at `12:30 UTC`: runs `full`.

Manual dispatch supports `visibility`, `leads`, `brief`, `mcp-config`, and `full`.

The workflow uploads `.thumbgate/perplexity-ci/**` as the `perplexity-command-center` artifact. It does not commit generated reports or mutate runtime state.

## Official MCP Server

Claude Code:

```bash
claude mcp add perplexity --env PERPLEXITY_API_KEY="your_key_here" -- npx -y @perplexity-ai/mcp-server
```

Codex:

```bash
codex mcp add perplexity --env PERPLEXITY_API_KEY="your_key_here" -- npx -y @perplexity-ai/mcp-server
```

Generic MCP config:

```json
{
  "mcpServers": {
    "perplexity": {
      "command": "npx",
      "args": ["-y", "@perplexity-ai/mcp-server"],
      "env": {
        "PERPLEXITY_API_KEY": "your_key_here"
      }
    }
  }
}
```

## Operating Standard

Use Perplexity for three high-ROI jobs:

1. Prove where ThumbGate is missing from AI-search answers.
2. Find actual conversations where repeated AI-agent mistakes are painful.
3. Convert findings into ThumbGate memory lessons and acquisition tasks.

Do not use it to generate more broadcast-only posts without a lead, query, or visibility gap attached.
