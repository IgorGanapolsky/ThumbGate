# Platform Research (As Of March 3, 2026)

This research was done on March 3, 2026 using official documentation or official product pages.

## Executive Summary

1. ChatGPT distribution should prioritize Custom GPT + GPT Actions (OpenAPI), not legacy plugin flow.
2. Claude and Codex both support MCP workflows; shipping an MCP server is the fastest integration path.
3. Gemini should be packaged via function-calling tools backed by the same API.
4. Amp should be packaged as skills-based automation (custom commands have been removed).
5. One shared API and one shared MCP server minimize maintenance cost and fit a tight budget.
6. Semantic cache is a high-ROI control for repeated queries: lower cost, lower latency, bounded correctness risk via similarity threshold + guardrails.
7. Meta-prompting should be used for prompt quality iteration, but only behind explicit evaluation gates (rubrics/tests) to avoid optimization drift.

## Evidence and Sources

### OpenAI / ChatGPT / Codex

- OpenAI plugin waitlist page states no new plugins are accepted.
  Source: https://openai.com/waitlist/plugins
- OpenAI plugin docs page indicates plugins have been superseded by GPTs.
  Source: https://platform.openai.com/docs/plugins/
- Custom GPT publishing docs define GPT Store distribution.
  Source: https://help.openai.com/en/articles/8798878-building-and-publishing-a-gpt
- OpenAI docs include MCP support for tools and Codex integration guidance.
  Source: https://platform.openai.com/docs/docs-mcp
- Codex GA announcement confirms broad availability.
  Source: https://openai.com/index/codex-now-generally-available/

### Anthropic / Claude

- Anthropic Claude Code docs provide MCP integration details.
  Source: https://docs.anthropic.com/en/docs/claude-code/mcp
- Anthropic agent tools docs include MCP connector capabilities/limits.
  Source: https://docs.anthropic.com/en/docs/agents-and-tools/mcp-connector

### Google / Gemini

- Gemini API docs support function calling (tool invocation).
  Source: https://ai.google.dev/gemini-api/docs/function-calling

### Amp

- Amp manual centers automation around skills.
  Source: https://ampcode.com/manual
- Amp release note indicates custom commands were removed in favor of skills.
  Source: https://ampcode.com/news/slashing-custom-commands

### Autonomous agent marketplaces / orchestration

- Agentplace positioning emphasizes intent-driven autonomous execution and human-in-the-loop oversight.
  Source: https://venturebeat.com/business/agentplace-wants-to-replace-the-entire-web-with-autonomous-agents-and-anyone

### PaperBanana

- PaperBanana project provides CLI-based diagram generation from captions.
  Source: https://github.com/llmsresearch/paperbanana
- PaperBanana package docs provide installation and API key requirements.
  Source: https://pypi.org/project/paperbanana/

### Semantic cache

- HackerNoon article highlights semantic cache as an LLM cost optimization pattern (Feb 24, 2026).
  Source: https://hackernoon.com/optimise-llm-usage-costs-with-semantic-cache
- Research evidence: embedding-driven semantic cache can reduce API calls substantially while preserving high positive-hit accuracy.
  Source: https://arxiv.org/abs/2411.05276
- Agentic workloads also benefit from semantic-aware caching under remote retrieval constraints.
  Source: https://arxiv.org/abs/2509.17360

### LLM routing / gateway

- Tetrate positions Agent Router/LLM Gateway for fallback, cost management, and usage monitoring.
  Sources:
  - https://tetrate.io/products/llm-gateway
  - https://tetrate.io/blog/announcing-tetrate-agent-router-service

## Packaging Decision

- Core product: RLHF API + MCP server.
- Distribution wrappers: ChatGPT Actions spec, Claude MCP config, Codex MCP config, Gemini tool definitions, Amp skill template.
- Add policy-driven intent routing with checkpoint gates as the cross-platform orchestration layer.
- Revenue path: OSS core + hosted control plane + enterprise support.
