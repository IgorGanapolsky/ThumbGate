# Daily Monetization Skill

## Purpose

End-to-end daily monetization automation: generate 30 social media content
drafts (3 per platform × 10 platforms), publish one Gumroad micro-ebook product,
track revenue across all channels, and surface observability insights.

**Slash command**: `/daily-monetization`

## Daily Schedule (9:00 AM - 9:05 AM EST)

| Time | Action | Script |
|------|--------|--------|
| 09:00 | Generate 30 social media drafts | `scripts/daily-content-generator.js` |
| 09:02 | Check/publish next Gumroad product | `scripts/gumroad-product-publisher.js` |
| 09:04 | Run revenue observability dashboard | `scripts/revenue-observability-dashboard.js` |
| 09:05 | Poll social analytics | `scripts/social-analytics/daily-poll.js` |

## Pipeline Architecture

```
[Gumroad Product Calendar]
         ↓
   [PDF Generation] ← Draft .md
         ↓
  [Gumroad Publish] ← BrowserOS neo (CDP)
         ↓
  [Social Draft Generator] → 30 .md files (3×10 platforms)
         ↓
  [Revenue Observability] → Stripe + Gumroad + Plausible
         ↓
  [Daily Report] → Agent feedback system
```

## 7-Day Content Calendar

Day 1: ThumbGate Cost Router (published — https://iganapolsky.gumroad.com/l/yhdbza)
Day 2: Session Leasing — One-Writer Checkout Lease
Day 3: Feedback Loop — Thumbs → Lessons → Prevention Rules
Day 4: FORMAT Steal Architecture
Day 5: PreToolUse Gates
Day 6: Local Memory System
Day 7: Claw-Style Enterprise Governance

## Platform Coverage

1. LinkedIn — Professional audience, CTO/CTO positioning
2. X — Real-time discourse, technical depth
3. Skool — Community engagement, educational content
4. BiggerPockets — Real estate audience, infrastructure angle
5. Reddit — Deep-dive technical discussions
6. ZyVOP — Emerging platform, early adopter positioning
7. Hacker News — Technical thought leadership
8. Bluesky — Decentralized social, format-steal community
9. Threads — Instagram-linked audience, casual technical
10. Dev.to — Developer community, code-focused content

## Scheduling

### launchd (macOS)
File: `~/Library/LaunchAgents/com.thumbgate.daily-monetization.plist`
Schedule: 0 9 * * * (daily at 9 AM EST)

### cron (fallback)
Entry: `0 9 * * * node scripts/daily-content-generator.js && node scripts/gumroad-product-publisher.js && node scripts/revenue-observability-dashboard.js`

## Files

- `scripts/daily-content-generator.js` — 30-draft/day generator
- `scripts/gumroad-product-publisher.js` — Product publishing automation
- `scripts/revenue-observability-dashboard.js` — Revenue dashboard
- `.agents/skills/daily-monetization/SKILL.md` — This file
- `~/Documents/AI-Agent-Sync/Email-Drafts/` — Output directory for drafts
- `~/Documents/AI-Agent-Sync/Gumroad-Products/products.json` — Product database

## Success Criteria

- 30 new social drafts generated daily
- 1 Gumroad product published daily (Day 1-7 calendar)
- Revenue dashboard shows updated metrics
- All drafts staged for "send it" human approval
- No unapproved outbound sends (HARD rule)
