# Add Agent Memory to Any mcp-use Project

[Manufact's mcp-use SDK](https://github.com/mcp-use/mcp-use) connects AI agents to MCP servers in 6 lines of code. Add persistent memory and prevention rules in 2 more.

## Python (mcp-use)

```python
from mcp_use import MCPClient, MCPAgent
from langchain_openai import ChatOpenAI

# Your existing mcp-use setup
client = MCPClient.from_dict({
    "mcpServers": {
        "your-server": {
            "command": "your-existing-server",
            "args": ["..."]
        },
        "memory": {
            "command": "npx",
            "args": ["-y", "mcp-memory-gateway", "serve"]
        }
    }
})

agent = MCPAgent(
    llm=ChatOpenAI(model="gpt-4o"),
    client=client
)

# Agent now has access to: recall, capture_feedback, prevention_rules
# It will automatically recall past mistakes and capture new feedback
result = await agent.run("Do the task — check memory first")
```

That's it. The agent now has `recall`, `capture_feedback`, and `prevention_rules` tools alongside your existing tools.

## What the agent gets

When the agent calls `recall`:
- Past feedback relevant to the current task (vector similarity search)
- Active prevention rules (auto-generated from repeated failures)
- Recent feedback summary

When the agent calls `capture_feedback`:
- Signal is validated and stored
- Vague feedback is rejected with clarification prompts
- Promoted to searchable memory if specific enough

## TypeScript (mcp-use)

```typescript
import { MCPClient } from "mcp-use";

const client = new MCPClient({
  mcpServers: {
    "your-server": { command: "your-existing-server", args: ["..."] },
    "memory": { command: "npx", args: ["-y", "mcp-memory-gateway", "serve"] }
  }
});
```

## Hosted API (no local server)

If you prefer the hosted API instead of a local MCP server:

```python
import httpx

API = "https://rlhf-feedback-loop-production.up.railway.app"
KEY = "your_api_key"
headers = {"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}

# Recall before task
summary = httpx.get(f"{API}/v1/feedback/summary?recent=10", headers=headers).json()

# Capture after task
httpx.post(f"{API}/v1/feedback/capture", headers=headers, json={
    "signal": "down",
    "context": "Agent recommended wrong product size",
    "whatWentWrong": "Ignored room dimensions from user profile",
    "whatToChange": "Always check dimensions before furniture recommendations",
    "tags": ["sizing", "product_recommendation"]
})
```

## Commerce agents

For agentic commerce use cases, use the `commerce` MCP profile:

```bash
RLHF_MCP_PROFILE=commerce npx mcp-memory-gateway serve
```

This exposes `commerce_recall` with quality scores for: product_recommendation, brand_compliance, sizing, pricing, regulatory.

## Remote review agents

For paired phone + desktop review sessions, use the `dispatch` MCP profile:

```bash
RLHF_MCP_PROFILE=dispatch npx mcp-memory-gateway serve
```

This keeps the surface read-only for metrics, diagnostics, recall, planning, and dashboard access. It intentionally excludes handoffs and mutation tools.

## Links

- [ThumbGate](https://github.com/IgorGanapolsky/thumbgate)
- [mcp-use SDK](https://github.com/mcp-use/mcp-use)
- [npm package](https://www.npmjs.com/package/mcp-memory-gateway)
