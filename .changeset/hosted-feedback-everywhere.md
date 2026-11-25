---
"thumbgate": minor
---

Hosted connector at thumbgate.ai/mcp records thumbs feedback from claude.ai, Claude Desktop, Claude projects and cloud sessions: the MCP `initialize` result now tells the model to call `capture_feedback` on a thumbs-up or thumbs-down, and OAuth sign-in survives a redeploy (durable, digest-only store) and supports refresh tokens.
