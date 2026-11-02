To: Joshua Xu (HeyGen (HyperFrames) — hyperframes.heygen.com)
From: Igor Ganapolsky <igor@igorganapolsky.com>
Subject: HeyGen (HyperFrames) × ThumbGate: <0.5ms PreToolUse firewall for HyperFrames CLI/skill (`npx skills add heygen-com/hyperframes`) + Claude Code / Codex FFmpeg & Remotion rendering
Status: OFFER_STAGED_AWAITING_IGOR_YES

Hi Joshua Xu,

We've been following HeyGen (HyperFrames) closely — specifically around HyperFrames CLI/skill (`npx skills add heygen-com/hyperframes`) + Claude Code / Codex FFmpeg & Remotion rendering.

One recurring production gap we see across agent native video editor stacks: Coding agents running HyperFrames/FFmpeg/Remotion can accidentally overwrite raw camera clips in `footage/` or re-render the entire 4K timeline on every single-sentence text revision instead of rendering a <=15s micro-preview.

At ThumbGate (https://thumbgate.ai), we built the sub-0.5ms local PreToolUse firewall and thumbs-down-to-rule engine that sits right on that boundary: Drop-in <0.5ms PreToolUse Video Agent Guardrail (`evaluateHyperframesVideoAgentGate`): protects raw `footage/`, enforces the 5s smoke test + reversible `cuts-ledger.json`, and forces <=15s micro-previews on revision turns.

Everything is open-source and runnable in <2 minutes (`npx thumbgate@latest init` — https://github.com/IgorGanapolsky/ThumbGate).

Would you be open to a quick async walkthrough of how a HeyGen (HyperFrames) × ThumbGate adapter looks in practice?

Best,
Igor Ganapolsky
Founder & CTO, ThumbGate
https://thumbgate.ai
