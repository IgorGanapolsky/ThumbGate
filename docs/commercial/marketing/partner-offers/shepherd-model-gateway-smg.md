To: SMG Core Maintainers (Shepherd Model Gateway (SMG — smg-project/smg) — github.com/smg-project/smg)
From: Igor Ganapolsky <igor@igorganapolsky.com>
Subject: Shepherd Model Gateway (SMG — smg-project/smg) × ThumbGate: <0.5ms PreToolUse firewall for SMG Rust KV-cache-aware routing + MCP tool execution endpoint
Status: OFFER_STAGED_AWAITING_IGOR_YES

Hi SMG Core Maintainers,

We've been following Shepherd Model Gateway (SMG — smg-project/smg) closely — specifically around SMG Rust KV-cache-aware routing + MCP tool execution endpoint.

One recurring production gap we see across rust llm routing gateway stacks: Volatile request IDs/timestamps break reusable KV prefixes, and SMG MCP tool execution needs a <0.5ms deterministic pre-action security & spend gate.

At ThumbGate (https://thumbgate.ai), we built the sub-0.5ms local PreToolUse firewall and thumbs-down-to-rule engine that sits right on that boundary: Pair ThumbGate static-prefix canonicalizer (`canonicalizePromptForKvCachePrefix`) and <0.5ms PreToolUse firewall with SMG MCP tool routing.

Everything is open-source and runnable in <2 minutes (`npx thumbgate@latest init` — https://github.com/IgorGanapolsky/ThumbGate).

Would you be open to a quick async walkthrough of how a Shepherd Model Gateway (SMG — smg-project/smg) × ThumbGate adapter looks in practice?

Best,
Igor Ganapolsky
Founder & CTO, ThumbGate
https://thumbgate.ai
