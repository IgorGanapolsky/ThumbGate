# High-ROI Pitch: ThumbGate for Search Engine Land & Mordy Oberstein

**Target:** Mordy Oberstein (Head of SEO Branding at Wix / Contributor at Search Engine Land)
**Channel:** Email / LinkedIn / Twitter DM
**Angle:** Solving the exact "Journalist Cold-Pitch Claude Skill in a Bottle" problem cited in his Search Engine Land article.

---

### Subject:
Solving your "journalist pitch Claude skill in a bottle" with deterministic grading

### Body:
Hi Mordy,

Read your Search Engine Land piece on internal communication and LLM visibility (*"You can't communicate externally what you can't communicate internally"*). 

Your line about trying to build a Claude skill to review research studies through the eyes of a cold-pitch journalist—and struggling to "catch the creator in a bottle"—hit right on the head. LLMs are non-deterministic judges by default; prompt tuning alone keeps shifting the goalposts.

We built a deterministic sub-millisecond evaluation engine in **ThumbGate** (`npx thumbgate init`) that solves this exact problem:

1. **Deterministic 4-Tier Journalist Rubric:** Hard scores (0-100) on Hook Clarity, Empirical Data Density (requiring hard %/sample sizes), Jargon Cleanliness (flags buzzwords like "game-changing" or "groundbreaking"), and Citation Readiness.
2. **Cross-Silo Footprint Harmonizer:** Catches entity definition drift between developer docs, Schema.org markup, and PR releases before search crawlers (Perplexity / ChatGPT Search) misclassify your brand.
3. **Pre-Action Firewall:** Sits on the publishing/agent tool dispatcher boundary to block drifted or low-signal content fail-closed in <1ms.

We published an open architectural breakdown linking to your study:
https://thumbgate.ai/learn/llm-visibility-cross-silo-communication

Would love to run your team's latest research study through our deterministic evaluator or set up a 14-day design partner sandbox for Wix/SE Ranking.

Best regards,

**Igor Ganapolsky**
CTO, ThumbGate
https://thumbgate.ai
