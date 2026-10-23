To: Thomas Paul Mann (Raycast — raycast.com)
From: Igor Ganapolsky <igor@igorganapolsky.com>
Subject: Raycast × ThumbGate: <0.5ms PreToolUse firewall for Raycast AI Extensions & MCP tool execution on macOS
Status: OFFER_STAGED_AWAITING_IGOR_YES

Hi Thomas Paul Mann,

We've been following Raycast closely — specifically around Raycast AI Extensions & MCP tool execution on macOS.

One recurring production gap we see across proactive macos assistant stacks: Raycast AI extensions can execute shell/API mutations across local repos and cloud SaaS without a unified pre-action spend/secret firewall.

At ThumbGate (https://thumbgate.ai), we built the sub-0.5ms local PreToolUse firewall and thumbs-down-to-rule engine that sits right on that boundary: <0.5ms local MCP & extension PreToolUse gate with user thumbs-down to prevention-rule compilation.

Everything is open-source and runnable in <2 minutes (`npx thumbgate@latest init` — https://github.com/IgorGanapolsky/ThumbGate).

Would you be open to a quick async walkthrough of how a Raycast × ThumbGate adapter looks in practice?

Best,
Igor Ganapolsky
Founder & CTO, ThumbGate
https://thumbgate.ai
