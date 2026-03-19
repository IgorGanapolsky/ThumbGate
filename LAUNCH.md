# v0.7.0 LAUNCH PLAN — Pre-Action Gates (March 13, 2026)

The engineering proof is real. The commercial surface must stay honest.

## 1. The Product

MCP Memory Gateway v0.7.0 introduces **Pre-Action Gates** — configurable checkpoints that fire before every tool call, blocking dangerous actions based on learned failure patterns.

- **Free tier**: Feedback capture, recall, prevention rules, 5 built-in gates, dashboard CLI, DPO/KTO export.
- **Pro tier ($49 one-time)**: Auto-gate promotion, unlimited custom gates, multi-repo sync, CI webhook auto-ingest, priority support.

## 2. Distribution Channels

| Channel | URL |
|---------|-----|
| npm | https://www.npmjs.com/package/mcp-memory-gateway |
| Smithery | https://smithery.ai/server/mcp-memory-gateway |
| MCP Marketplace | https://github.com/anthropics/mcp-marketplace |
| GitHub | https://github.com/IgorGanapolsky/mcp-memory-gateway |
| Hacker News | Show HN post (see outreach below) |

## 3. Acquisition: Social Post Templates

### Twitter/X

> "Your AI agent just mass-deleted prod data. Again.
>
> We built **Pre-Action Gates** for MCP agents — configurable checkpoints that block dangerous tool calls before they execute.
>
> Free: 5 built-in gates + feedback capture + prevention rules
> Pro ($49 one-time): auto-gate promotion, unlimited custom gates, multi-repo sync
>
> OSS core: https://github.com/IgorGanapolsky/mcp-memory-gateway
> Pro: https://rlhf-feedback-loop-production.up.railway.app/checkout/pro"

### LinkedIn

> "Most AI agents run tool calls with no safety net. One bad `rm -rf`, one force-push to main, one leaked secret — and you're cleaning up for hours.
>
> We just shipped Pre-Action Gates in MCP Memory Gateway v0.7.0. Gates fire before every tool call and block dangerous actions based on learned failure patterns.
>
> Free OSS core with 5 built-in gates. Pro at $49 one-time adds auto-gate promotion, unlimited custom gates, and multi-repo sync.
>
> GitHub: https://github.com/IgorGanapolsky/mcp-memory-gateway"

### Show HN

> "Show HN: Pre-Action Gates for AI Agents — block dangerous tool calls before they execute
>
> MCP Memory Gateway is an open-source MCP server that captures thumbs-up/down feedback, generates prevention rules from repeated failures, and now ships with Pre-Action Gates — configurable checkpoints that fire before tool calls.
>
> Built-in gates block: force-push to protected branches, .env edits, secret commits, destructive git ops, and shell injection patterns. The gates engine learns from your feedback history and auto-promotes new gates in the Pro tier.
>
> Free + MIT licensed. Pro at $49 one-time for teams that need auto-gate promotion and multi-repo sync.
>
> https://github.com/IgorGanapolsky/mcp-memory-gateway"

## 4. High-Intent Direct Messages

> "Hey, I just shipped Pre-Action Gates in MCP Memory Gateway v0.7.0 — configurable checkpoints that block dangerous AI agent tool calls before they fire. The OSS core has 5 built-in gates and feedback capture for free. Pro is $49 one-time for auto-gate promotion and multi-repo sync. Would love your honest feedback: https://github.com/IgorGanapolsky/mcp-memory-gateway"

## 5. Commercial Truth

Use [docs/COMMERCIAL_TRUTH.md](docs/COMMERCIAL_TRUTH.md) as the source of truth for pricing, traction, and proof claims. Do not cite GitHub stars, npm downloads, or solo-maintainer activity as customer proof.

## 6. Verification

Engineering is done. Pricing and traction claims must stay evidence-backed.
