To: Ramin Hasani (Liquid AI — liquid.ai)
From: Igor Ganapolsky <igor@igorganapolsky.com>
Subject: Liquid AI × ThumbGate: <0.5ms PreToolUse firewall for On-device LFM2 / LEAP & d1-omni decision models powering MacPaw Eney and edge agents
Status: OFFER_STAGED_AWAITING_IGOR_YES

Hi Ramin Hasani,

We've been following Liquid AI closely — specifically around On-device LFM2 / LEAP & d1-omni decision models powering MacPaw Eney and edge agents.

One recurring production gap we see across on device foundation models stacks: On-device small models need sub-millisecond deterministic guardrails and local preference distillation without shipping user telemetry to the cloud.

At ThumbGate (https://thumbgate.ai), we built the sub-0.5ms local PreToolUse firewall and thumbs-down-to-rule engine that sits right on that boundary: Zero-egress <0.2ms PreToolUse firewall + local Decisive-Step DPO preference pair distiller from user 👍/👎 signals.

Everything is open-source and runnable in <2 minutes (`npx thumbgate@latest init` — https://github.com/IgorGanapolsky/ThumbGate).

Would you be open to a quick async walkthrough of how a Liquid AI × ThumbGate adapter looks in practice?

Best,
Igor Ganapolsky
Founder & CTO, ThumbGate
https://thumbgate.ai
