---
"thumbgate": minor
---

Hosted connector records thumbs feedback from claude.ai, Claude Desktop, Claude projects and cloud sessions: the MCP `initialize` result now tells the model to call `capture_feedback` on a thumbs-up or thumbs-down, OAuth sign-in survives a redeploy (durable digest-only store) and supports refresh tokens, and the new `thumbgate sync-hosted` command (also run in the background at session start when an operator key is set) pulls hosted feedback into the local store so it becomes local lessons and gates.
