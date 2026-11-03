---
name: viral-carousel-monetizer
description: Automate the 8-step high-converting social carousel and lead-magnet workflow (list-style topic ranking by saves/shares, pre-verified lead-magnet gate, hook slide formula, 2 verified stat boxes per slide, visual self-QA, per-account anti-duplicate variations, LinkedIn caption-link final slide adaptation, and skill self-learning) at $0 outbound spend without paying for Blotato.
---

# Viral Carousel & Lead-Magnet Monetizer ($0 Outbound Spend — Native Playwright Engine)

> Steals the 8-step Claude Code + Blotato carousel workflow (`https://www.youtube.com/watch?v=dKUgGN4Q_Hs`) natively at **`$0.00` outbound spend** (never buy paid Blotato subscriptions; render locally with Playwright Chromium and stage for 1-click approval).

## The 8-Step Daily Carousel & Money Workflow

### Step 1: Pick List-Style Topics from Real Save & Share Metrics
- Rank historical posts by `score = (saves * 3) + (shares * 2) + (ctaClicks * 5) + (views * 0.01)`.
- Convert top-performing technical pain points into **numbered list-style carousels** (lists drive the highest save and bookmark rates).

### Step 2: Pre-Verify the Lead Magnet & 4-Tier Checkout Funnel (Zero Dead Ends)
- Every carousel must route to a live, `HTTP 200` verified lead magnet and checkout ladder **before** rendering or staging:
  - **Free Lead Magnet / CLI:** `npx thumbgate@latest init` (`https://github.com/IgorGanapolsky/ThumbGate`)
  - **`$9.99` Playbook:** `https://iganapolsky.gumroad.com/l/odrkon`
  - **`$49.00` One-Time Corporate-Expense Bundle:** `https://iganapolsky.gumroad.com/l/vcrho`
  - **`$100.00` Founding Tier:** `https://thumbgate.ai/go/pro-direct`
  - **`$499.00` Workflow Gate Diagnostic:** `https://thumbgate.ai/diagnostic`

### Step 3: Engineer the Hook Slide (Slide 1)
- **Visuals:** Consistent brand mark / mascot facing the viewer + actual tool logo (`Claude Code`, `Poolside`, `GitHub`, `OpenAI`) in a clean, prop-free dark terminal scene.
- **Headline Formula:** `1 clear sentence + specific number + brand name + ALL-CAPS power word (FREE / INSANE / ZERO-TAX) + 👉`:
  - Example: *"7 Claude Code & Poolside Firewall Rules That Cut Agent Token Bills by 64% (FREE Open-Source Setup) 👉"*

### Step 4: Format Body Slides (1 Idea + 2 Same-Day Verified Stat Boxes)
- Each body slide contains:
  1. Large step number (`01`–`05`)
  2. Short punchy headline (`<= 8` words)
  3. 2–3 plain-English sentences (zero bot-slop)
  4. Real terminal command or code snippet
  5. **Exactly 2 same-day verified stat boxes** (e.g. `0.041ms p95 Eval` + `64% Lower Thread Cost`). **Rule:** If a metric cannot be verified live today, omit it — never guess or fabricate stats.

### Step 5: Run Automated Visual & Structural Self-QA
- Before surfacing to Igor, verify:
  - `overlappingElementsCount === 0` (slide counter never overlaps brand logo)
  - Sequential step numbers (`1..N` with no gaps or duplicates)
  - Zero broken copyright/encoding characters or unoriginal filler phrasing

### Step 6: Generate Unique Variations Per Account / Channel
- Never post identical slide decks across accounts. Vary color accents (`#38d7ff` cyan vs `#ff90e8` magenta vs `#22c55e` emerald), headline hooks, and captions per profile to prevent duplicate-content suppression.

### Step 7: Channel-Adapted Final Slide & Staggered Cross-Posting (Approval-Gated)
- **Hard Guardrail:** Never auto-publish without Igor's explicit `"send it"` approval.
- **Instagram / Threads Variant:** Final slide prompts keyword reply + repurposes 3 slides into Stories; caption uses **3 lines + 5 hashtags**.
- **LinkedIn Variant:** Because LinkedIn lacks comment-to-DM automation, the LinkedIn final slide explicitly directs readers to the **clickable checkout/guide link in the caption**, spaced $\ge 2$ hours apart from other platforms.

### Step 8: Log Every Revision Into This Skill
- Whenever Igor gives feedback or thumbs-down on a slide or caption, append the rule to the **Learned Revision Rules** section below and capture it in ThumbGate (`capture_feedback`).

## CLI Commands

```bash
# Generate today's verified HTML/PDF carousel deck + LinkedIn & Instagram variants
node scripts/fast-money-engine.js --carousel

# Audit carousel compliance via RRSI Doctor
node scripts/rrsi-doctor.js --viral-carousel
```

## Learned Revision Rules
- **Rule 1 (2026-10-26):** Always include the `$49` one-time corporate-expensable bundle alongside the `$100` Founding Tier and `$499` Diagnostic so engineers with `<$50` card limits can buy without manager approval.
- **Rule 2 (2026-10-26):** LinkedIn final slides must point to the caption URL, never "Comment KEYWORD for a DM".
