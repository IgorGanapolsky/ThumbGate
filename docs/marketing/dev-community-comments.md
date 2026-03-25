# DEV Community Article Comments

## Comment 1 — "I Lost 3 Hours of Claude Code Work to Compaction" by gonewx

Compaction is brutal because the context window is the only memory the agent has. I ran into this enough that I built mcp-memory-gateway — it captures feedback and context into persistent JSONL logs outside the context window, then serves bounded "context packs" back to the agent via MCP. When compaction fires, the agent can reconstruct what it was doing from the feedback history instead of starting blind. Might be worth a look: https://github.com/IgorGanapolsky/thumbgate — Disclosure: I built this.

## Comment 2 — "Your AI Has Infinite Knowledge and Zero Habits" by elliotJL

The "zero habits" framing is spot-on. I built mcp-memory-gateway partly to solve this exact problem. It captures up/down feedback on agent actions and, when failure patterns recur, generates prevention_rules — essentially learned habits that persist across sessions and gate future actions. The agent develops behavioral memory instead of repeating the same mistakes. Repo if you're curious: https://github.com/IgorGanapolsky/thumbgate — Disclosure: I built this.

## Comment 3 — "How I Stopped Claude Code From Losing Context After Every Compaction" by chudi_nnorukam

Your dev-docs approach is smart — externalizing context so the agent can recover. mcp-memory-gateway does something similar but automated: it captures structured feedback and context into persistent logs, generates prevention rules from repeated failures, and serves bounded context packs back via MCP tools. No manual doc maintenance needed — the feedback loop builds the recovery state as you work. https://github.com/IgorGanapolsky/thumbgate — Disclosure: I built this.
