# Buyer-list supplement — Stuart Woolley (#13)

This file supplements `docs/marketing/buyer-list-send-ready-2026-05-14.md`. Adds one outreach target identified after the original 12-person list shipped, surfaced by the 2026-05-14 Stuart Woolley Medium piece "Vector Databases Are Not Knowledge Management" (Predict publication).

---

## 13. Dr. Stuart Woolley — Independent technical commentator, Medium / Predict publication *(NEW — hot, send same day as Rob May)*

**Why hot:** Just published a piece arguing that vector DBs / RAG are an "engineering compensation" for the old 4K-token context window — no longer needed at million-token scale, and not actually knowledge management. **That's verbatim ThumbGate's positioning thesis from a credible third party** on a high-distribution outlet. Same pattern as Rob May in The New Stack (buyer #11).

Article: https://medium.com/predict/vector-databases-are-not-knowledge-management-c3d5f4b428ff

Contact path: Medium profile → "About" page typically has Twitter/Mastodon/website. Reply via Medium comment OR direct via his Twitter/website. Find current handle on his profile before sending.

### Pitch

> Subject: Your piece on vector DBs — ThumbGate is the architectural class that sidesteps the RAG debate
>
> Stuart — read "Vector Databases Are Not Knowledge Management." Your diagnosis is exactly right, and the architectural opening it implies is the gap ThumbGate has been built into. We're a *pre-action* gate for AI coding agents — PreToolUse hook intercepts the tool call before it executes, blocks it deterministically against a local rule pack, and captures human thumbs-down events as new rules. Single-digit-millisecond gate decisions, zero model calls, no vector retrieval in the hot path.
>
> The framing your piece lands on — "this is compensation, not management" — is the same line we've been threading through ThumbGate's positioning: behavioral governance, not knowledge management. MIT-licensed, ~750 weekly npm installs, deploys local.
>
> Two-track ask:
> (a) Cover ThumbGate in a follow-up piece — happy to walk you through the architecture and the actual blocked-incident telemetry. Headline candidates: *"What 'Behavioral Governance' Looks Like When You Stop Pretending It's RAG"* or *"The Architectural Class That Doesn't Care About Context Windows."*
> (b) 20-min compare-notes call. I'd value your read on whether the position scales beyond AI coding agents into other agentic systems.
>
> — Igor Ganapolsky, ThumbGate (github.com/IgorGanapolsky/ThumbGate)

### Why this works for him

- Validates and extends his thesis with a concrete production system
- A follow-up piece on the same theme has high reader-overlap with his existing audience
- Co-byline / mention possibility — adds to his "told you so" portfolio

### Why this works for us

- Direct distribution into a Medium audience that just self-selected as "thinks AI infra is over-engineered" — exactly our positioning
- A third-party piece naming ThumbGate as the answer to a problem he's already framed publicly = highest credibility-per-dollar move available
- Mirrors the Rob May / New Stack pattern (buyer #11) — find someone who already said your pitch, agree publicly

### Send priority

Same window as #11 Rob May. Both quote-points are time-sensitive — the freshness of the article is what makes the "saw your piece" opener feel natural. Goes stale in 2-3 weeks.

---

## Send tracker — supplement

| # | Target | Sent? | Date | Reply? | Next step |
|---|---|---|---|---|---|
| 13 | Stuart Woolley | ☐ | | | Find current contact path on Medium profile, send Pitch above |

---

## PC-2. ultrathink-art (agent-architect-kit) — Bluesky reply, 2026-05-14

**Real-time qualified inbound.** Engaged within 16 minutes of the TNS Bluesky post. Their repo: https://github.com/ultrathink-art/agent-architect-kit

Their thesis (verbatim from the reply): *"Role-based tool restrictions are the closest we've found. Our social agent literally can't see the codebase — enforced at config level, not instruction level. Structural separation beats 'please don't touch the DB' in instructions."*

**Why this is a partner-channel target, not a competitor:**
- Their primitive is **config-time structural separation** (which tools an agent can SEE)
- ThumbGate's primitive is **pre-execution behavioral check** (whether an action should EXECUTE given context)
- Strictly orthogonal — the layered combination (their structural restriction + our PreToolUse check) covers both failure modes
- ThumbGate already adopted some of their CLAUDE.md patterns (April 2026, pattern-harvest documented in our own CLAUDE.md)
- Mutual amplification, not zero-sum competition

**Engagement state:** Replied in-thread peer-voice 2026-05-14T21:35Z. Reply posted at `at://...3mltschdrp72c`.

**Next step:** Watch for their counter-reply. If they engage further, escalate to DM with a partnership pitch:
> "Architect-kit's structural separation + ThumbGate's PreToolUse check are the cleanest layered story I've seen in the agent-safety stack. Would love to (a) co-author a blog post on the layered approach, (b) link from our docs to your repo and vice-versa, (c) explore whether agent-architect-kit's config could emit ThumbGate rules as a build target. 20 min?"
