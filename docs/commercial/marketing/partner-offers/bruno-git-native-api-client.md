To: Anoop M D (Bruno (usebruno.com / github.com/usebruno/bruno) — usebruno.com)
From: Igor Ganapolsky <igor@igorganapolsky.com>
Subject: Bruno (usebruno.com / github.com/usebruno/bruno) × ThumbGate: <0.5ms PreToolUse firewall for Bruno `.bru` plain-text Git collections + AI coding agent API exploration
Status: OFFER_STAGED_AWAITING_IGOR_YES

Hi Anoop M D,

We've been following Bruno (usebruno.com / github.com/usebruno/bruno) closely — specifically around Bruno `.bru` plain-text Git collections + AI coding agent API exploration.

One recurring production gap we see across offline first git api client stacks: AI coding agents generating `.bru` API requests can accidentally hardcode literal Bearer/API keys instead of `vars:secret` or trigger destructive production `DELETE`/`POST` endpoints during automated exploration.

At ThumbGate (https://thumbgate.ai), we built the sub-0.5ms local PreToolUse firewall and thumbs-down-to-rule engine that sits right on that boundary: ThumbGate `.bru` PreToolUse Diode (`evaluateBrunoGitNativeCollectionDiode`): blocks literal secrets in `.bru` files, enforces `vars:secret` interpolation, and gates destructive API calls in <0.5ms.

Everything is open-source and runnable in <2 minutes (`npx thumbgate@latest init` — https://github.com/IgorGanapolsky/ThumbGate).

Would you be open to a quick async walkthrough of how a Bruno (usebruno.com / github.com/usebruno/bruno) × ThumbGate adapter looks in practice?

Best,
Igor Ganapolsky
Founder & CTO, ThumbGate
https://thumbgate.ai
