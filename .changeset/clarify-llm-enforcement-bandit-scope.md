---
"thumbgate": patch
---

Clarify three README framings flagged in a peer review on r/ThumbGate (Sad-Pension-5008, 2026-05-15):

1. **"No LLM in enforcement" was sloppy.** The runtime allow/block decision is LLM-free (deterministic pattern matching), but embeddings ARE generated at capture time via the configured embedding API. The README's Layer 2 section now says exactly that — runtime decision LLM-free; offline lesson recall uses embeddings; the two are different paths.

2. **Thompson Sampling is not used for rule selection.** TS tunes per-rule SENSITIVITY (strict / warn-only / needs_review) based on accumulated feedback. Hard-safety rules (destructive SQL on prod, etc.) bypass the bandit entirely and are always at strict enforcement. The previous "adaptive rule selection" wording suggested a bandit decides whether to fire a known-bad rule, which was misleading.

3. **Lead with cross-agent propagation as the differentiator.** For a single codebase + single agent, a hand-rolled `permissions.deny` rule or a per-repo PreToolUse hook is genuinely lighter. ThumbGate's value lands at scale: one thumbs-down protects every agent runtime on every machine on the team. README Layer 4 section now states this explicitly.

No code changes; documentation only.
