To: Keshav Trehan (Alcoy — alcoyai.com)
From: Igor Ganapolsky <igor@igorganapolsky.com>
Subject: Alcoy × ThumbGate: <0.5ms PreToolUse firewall for Alcoy human approval API/SDK/MCP -> ThumbGate HMAC-SHA256 `approvalContextDigest` consumer
Status: OFFER_STAGED_AWAITING_IGOR_YES

Hi Keshav Trehan,

We've been following Alcoy closely — specifically around Alcoy human approval API/SDK/MCP -> ThumbGate HMAC-SHA256 `approvalContextDigest` consumer.

One recurring production gap we see across human in the loop approval layer stacks: Standardizing the upstream human approval ask while guaranteeing the downstream runtime cannot execute a mutated payload or replay a consumed approval.

At ThumbGate (https://thumbgate.ai), we built the sub-0.5ms local PreToolUse firewall and thumbs-down-to-rule engine that sits right on that boundary: Exact-action SHA-256 digest binding (`toolName + toolInput + amountUsd`) + single-use ledger consumption at PreToolUse.

Everything is open-source and runnable in <2 minutes (`npx thumbgate@latest init` — https://github.com/IgorGanapolsky/ThumbGate).

Would you be open to a quick async walkthrough of how a Alcoy × ThumbGate adapter looks in practice?

Best,
Igor Ganapolsky
Founder & CTO, ThumbGate
https://thumbgate.ai
