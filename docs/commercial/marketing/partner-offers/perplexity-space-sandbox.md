To: Zibi Braniecki (Perplexity AI (SPACE Open-Source AI Sandbox) — perplexity.ai)
From: Igor Ganapolsky <igor@igorganapolsky.com>
Subject: Perplexity AI (SPACE Open-Source AI Sandbox) × ThumbGate: <0.5ms PreToolUse firewall for Perplexity SPACE AI Sandbox (on CoreWeave, Akamai, Crusoe) + pplx-decider
Status: OFFER_STAGED_AWAITING_IGOR_YES

Hi Zibi Braniecki,

We've been following Perplexity AI (SPACE Open-Source AI Sandbox) closely — specifically around Perplexity SPACE AI Sandbox (on CoreWeave, Akamai, Crusoe) + pplx-decider.

One recurring production gap we see across agent containment sandbox stacks: SPACE prevents OS/container breakouts (0/118 escape rate), but an agent inside the sandbox still holds authorized API tokens (GitHub, Stripe, DB, email) and can abuse those tools without breaking out of the container.

At ThumbGate (https://thumbgate.ai), we built the sub-0.5ms local PreToolUse firewall and thumbs-down-to-rule engine that sits right on that boundary: Pair Perplexity SPACE (Layer-1 container containment) with ThumbGate <0.5ms PreToolUse (Layer-2 in-sandbox authorized-tool firewall: `evaluateSpaceSandboxPlusThumbGateFirewall`).

Everything is open-source and runnable in <2 minutes (`npx thumbgate@latest init` — https://github.com/IgorGanapolsky/ThumbGate).

Would you be open to a quick async walkthrough of how a Perplexity AI (SPACE Open-Source AI Sandbox) × ThumbGate adapter looks in practice?

Best,
Igor Ganapolsky
Founder & CTO, ThumbGate
https://thumbgate.ai
