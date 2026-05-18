# $1.4M Sales Anchors — Regulated Industries Reframe (2026-05)

Source citation: Bryan Ross (GitLab Field CTO), ["The hidden cost of build vs. buy for agentic AI in regulated industries"](https://thenewstack.io/agentic-ai-build-buy/), The New Stack, 2026-05-15. The "$1.4M and 18 months" anchor is from his framing of DIY agentic AI platforms in regulated industries.

Use this when talking to: banks, insurers, healthcare orgs, public sector, government contractors, large enterprises facing DORA / EU AI Act / HIPAA / SOX / FedRAMP audit pressure. Do **not** use these anchors with solo developers or seed-stage startups — wrong frame, wrong budget tier.

## One-liners (drop into LinkedIn DMs, cold emails, ad copy)

- "Cheaper than the $1.4M DIY estimate The New Stack put on agent platforms last week."
- "DORA Article 28 wants a per-call decision trail. Building that in-house is $1.4M / 18 months. ThumbGate ships it as npm install."
- "Your bought agent platform decides which tool to call. ThumbGate decides whether the call actually executes. Auditors care about the second part."
- "The New Stack put it at $1.4M to build agent guardrails internally. We charge $4,800/mo for the layer that matters."
- "Bryan Ross at GitLab made the buy case last week. ThumbGate is the layer his article didn't name."

## Subject lines (cold email)

- "The execution-boundary layer the New Stack piece almost named"
- "Skip the $1.4M build — DORA-grade agent gate, npm-installable"
- "Your bought agent platform still executes — here's what audits will ask"
- "Buy the orchestration. Buy the boundary. Same thesis, two layers."

## Discovery questions (live calls)

Use these after the prospect mentions audit pressure, AI agent rollout, or build-vs-buy discussion:

1. "When your auditor asks for the decision trail behind a privileged agent action, what artifact do you hand them today?"
2. "Did you read Bryan Ross's piece in The New Stack on the 15th? The $1.4M figure mapped to your internal estimate?"
3. "Walk me through what's between your agent platform — whether you bought or built — and your production database. What stops a wrong call?"
4. "Under DORA Article 28, who at your org owns the post-market monitoring evidence for agent-attributable actions?"

## ICP gating signals (decide whether to keep selling)

Strong-fit signal: prospect references DORA, EU AI Act high-risk classification, HIPAA, SOX, FedRAMP, or names an internal audit/risk function as a stakeholder. **Continue.**

Weak-fit signal: prospect says "we're not regulated" or "audit isn't a buyer here." **Drop back to Pro/Team tier; do not use the $1.4M anchor.** Wrong frame for them.

Anti-signal: prospect is a single dev evaluating ThumbGate against Mem0 or other memory tools. **Use the [memory-vs-execution-boundary frame](/learn/ai-agent-governance) instead.** The $1.4M number will sound like irrelevant enterprise theater.

## Where this anchor lives in the funnel

| Surface | Where the anchor appears | Status |
|---------|--------------------------|--------|
| `public/learn/regulated-agent-execution-boundary.html` | Hero + table | Shipped 2026-05-18 |
| `public/index.html` Regulated tier card | Body copy + linked footnote | Shipped 2026-05-18 |
| `reports/outreach/bryan-ross-gitlab-2026-05-18.md` | LinkedIn DM + email variants | Shipped 2026-05-18 (CEO approval required to send) |
| LinkedIn outbound to financial-services prospects | One-liner #1 | Not yet wired |
| Reddit r/devops + r/programming organic posts | One-liner #5 | Not yet wired |
| ChatGPT-ads readiness pack | Anchor row | TODO |

## Half-life

The $1.4M number is from a single sponsored New Stack piece. It is strong evidence for ~6 months. After 2026-11-15, retire or re-anchor against a fresher data point. Track via: `docs/marketing/sales-anchors-2026-05.md` is the source of truth; when retired, replace, do not stack anchors.

## CEO directive compliance

Per `CLAUDE.md` and `AGENTS.md`: every outbound touch using these anchors is manual-send only. No auto-posting. Drafts queue to `.thumbgate/reply-drafts.jsonl` for CEO review before send.
