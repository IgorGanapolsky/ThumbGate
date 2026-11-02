To: Rushikesh More (Tor Router MCP (rushikeshmore/tor-mcp) — github.com/rushikeshmore/tor-mcp)
From: Igor Ganapolsky <igor@igorganapolsky.com>
Subject: Tor Router MCP (rushikeshmore/tor-mcp) × ThumbGate: <0.5ms PreToolUse firewall for tor_private_fetch, tor_new_identity, and selective per-URL SOCKS5h routing on MCP Market
Status: OFFER_STAGED_AWAITING_IGOR_YES

Hi Rushikesh More,

We've been following Tor Router MCP (rushikeshmore/tor-mcp) closely — specifically around tor_private_fetch, tor_new_identity, and selective per-URL SOCKS5h routing on MCP Market.

One recurring production gap we see across mcp privacy egress router stacks: tor-mcp routes agent HTTP requests over Tor SOCKS5h, but its README threat model notes it cannot stop an LLM agent from sending account-deanonymizing Authorization/Cookie headers or plaintext HTTP over malicious exit nodes.

At ThumbGate (https://thumbgate.ai), we built the sub-0.5ms local PreToolUse firewall and thumbs-down-to-rule engine that sits right on that boundary: Pair ThumbGate <0.5ms PreToolUse credential-strip and plaintext-exit blocker (`resolveTorRouterSelectiveRoute`) with tor-mcp selective SOCKS5h routing.

Everything is open-source and runnable in <2 minutes (`npx thumbgate@latest init` — https://github.com/IgorGanapolsky/ThumbGate).

Would you be open to a quick async walkthrough of how a Tor Router MCP (rushikeshmore/tor-mcp) × ThumbGate adapter looks in practice?

Best,
Igor Ganapolsky
Founder & CTO, ThumbGate
https://thumbgate.ai
