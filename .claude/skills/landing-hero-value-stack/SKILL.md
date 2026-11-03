---
tags: [landing-page, conversion, hero-section, value-stack, cta]
domain: conversion
source: freebutter.ai + thumbgate.ai critique
---

# Landing Hero Value-Stack FORMAT Steal

## The Problem

ThumbGate's landing page had a **broken visual hierarchy**: no headline context before
asking for $19/mo or $499, floating spec-chips without context, and conflicting CTAs
in the navbar (mint green + cyan = dilutes focus).

## The Fix (What to Steal from Freebutter + ThumbGate's own critique)

### Value Stack Order (Above the Fold)

```
Eyebrow (technical credibility)     → "Pre-action firewall · <0.5ms local"
Hero-thumbs (visual icon)
H1 (problem agitation)              → "Stop AI agent mistakes before they cost you."
Subheadline (scope + urgency)       → "Battle-tested guardrails for Claude Code, Cursor, Codex, Git, AWS."
Install command (first action)      → npx thumbgate init  [Copy button]
Live demo (concrete proof)          → 3-line terminal DENY output with 0.4ms timing
Rule Packs chips (credibility)      → "Rule Packs: Claude · Cursor · Git · AWS"
Trust strip (social proof)          → "7 CLIs · <0.5ms p95 · Local SQLite"
Pricing (after value is established)
```

### Navbar CTA Fix

**Before:** Two competing buttons
- `Pro · $19/mo` (green solid)
- `Get Started · $499` (green outline)

**After:** Single primary CTA
- `Install Free` (cyan solid) → scrolls to pricing section

### Pricing Tier Repositioning

**Pro ($19/mo)** — Lead with Rule Packs:
1. Unlimited gates + rule packs (Claude, Cursor, Git, AWS)  ← **FIRST**
2. Visual gate debugger, dashboard & multi-hop recall
3. 1-click DPO & HuggingFace exports from 👍/👎

**$499 (below Pro)** — "Team / Enterprise Onboarding":
- Not labeled "Get Started" (which implies low friction)
- Positioned as the premium tier above Pro, not competing with it
- CTA: "Book Team Onboarding — $499"

### Color Unification

- All primary CTAs: `--cyan` (#38d7ff) — NOT `--green` (#56e39f)
- `--green` reserved for accents: checkmarks, eyebrows, section kickers
- ONE primary action color per screen

## Application

Use this value-stack whenever designing a developer tool landing page:
1. Agitate the problem (H1)
2. Scope the solution (subheadline)
3. Lower the barrier (install command)
4. Prove it works (live demo)
5. Build credibility (social proof / trust strip)
6. Ask for money (pricing, below the fold)
