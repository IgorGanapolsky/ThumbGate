To: Meredith Shubel (The New Stack (Meredith Shubel — AI-Scale Git & Scion Coverage) — thenewstack.io)
From: Igor Ganapolsky <igor@igorganapolsky.com>
Subject: The New Stack (Meredith Shubel — AI-Scale Git & Scion Coverage) × ThumbGate: <0.5ms PreToolUse firewall for Editorial follow-up to "Anthropic built its own git replacement for AI-scale coding. But you can’t have it"
Status: OFFER_STAGED_AWAITING_IGOR_YES

Hi Meredith Shubel,

We've been following The New Stack (Meredith Shubel — AI-Scale Git & Scion Coverage) closely — specifically around Editorial follow-up to "Anthropic built its own git replacement for AI-scale coding. But you can’t have it".

One recurring production gap we see across ai engineering media and benchmarks stacks: Engineering teams hitting agent-scale git bottlenecks cannot use Anthropic’s proprietary Scion and need open-source guardrails for multi-agent worktrees, checkout leases, and clone-free history queries on standard Git.

At ThumbGate (https://thumbgate.ai), we built the sub-0.5ms local PreToolUse firewall and thumbs-down-to-rule engine that sits right on that boundary: ThumbGate Open-Source Git-at-Scale & Scion Guardrail (`scripts/git-at-scale.js`, `scripts/session-lease.js`, and `evaluateScionAgentScaleVcsGate`).

Everything is open-source and runnable in <2 minutes (`npx thumbgate@latest init` — https://github.com/IgorGanapolsky/ThumbGate).

Would you be open to a quick async walkthrough of how a The New Stack (Meredith Shubel — AI-Scale Git & Scion Coverage) × ThumbGate adapter looks in practice?

Best,
Igor Ganapolsky
Founder & CTO, ThumbGate
https://thumbgate.ai
