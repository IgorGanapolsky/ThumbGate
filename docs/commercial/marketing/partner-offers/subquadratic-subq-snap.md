To: Alex Whedon (Subquadratic (SubQ Snap 384K Decision Model — subq.ai) — subq.ai)
From: Igor Ganapolsky <igor@igorganapolsky.com>
Subject: Subquadratic (SubQ Snap 384K Decision Model — subq.ai) × ThumbGate: <0.5ms PreToolUse firewall for SubQ Snap 384K-token SSA Decision Model + When2Call tool-invocation boundary
Status: OFFER_STAGED_AWAITING_IGOR_YES

Hi Alex Whedon,

We've been following Subquadratic (SubQ Snap 384K Decision Model — subq.ai) closely — specifically around SubQ Snap 384K-token SSA Decision Model + When2Call tool-invocation boundary.

One recurring production gap we see across long context decision model stacks: As The New Stack reported (Oct 14, 2026), SubQ Snap leads on 13 of 16 enterprise benchmarks across 384K tokens, but trails on When2Call (deciding whether an agent should invoke a tool or decline) and needs a deterministic T=0 execution brake.

At ThumbGate (https://thumbgate.ai), we built the sub-0.5ms local PreToolUse firewall and thumbs-down-to-rule engine that sits right on that boundary: Pair SubQ Snap (384K whole-module context evaluation) with ThumbGate <0.5ms PreToolUse (deterministic When2Call tool-execution firewall: `evaluateSubQSnapCoarseModuleRouter`).

Everything is open-source and runnable in <2 minutes (`npx thumbgate@latest init` — https://github.com/IgorGanapolsky/ThumbGate).

Would you be open to a quick async walkthrough of how a Subquadratic (SubQ Snap 384K Decision Model — subq.ai) × ThumbGate adapter looks in practice?

Best,
Igor Ganapolsky
Founder & CTO, ThumbGate
https://thumbgate.ai
