# Distribution Runbook — Daily Operating Rhythm

Goal: first $1 of Pro revenue in 7 days. Sustain 3+ signups/day by day 14.

This is the **daily rhythm** after the initial launch fires in [LAUNCH_NOW.md](LAUNCH_NOW.md).

---

## Daily ops (30 min/day)

### Morning (10 min)

```bash
# Revenue check
node bin/cli.js cfo --today

# Funnel check — any movement?
npm run feedback:stats

# PostHog dashboard
open "https://thumbgate-production.up.railway.app/dashboard"

# Open PRs / CI health
gh run list --branch main --limit 3
npm run pr:manage
```

### Midday (10 min) — reply/engage

- Reply to every Reddit comment within 4h of post-time.
- Reply to HN thread comments within 30 min (HN gives heavy ranking weight to author engagement in first 6h).
- LinkedIn comment = LinkedIn comment back. Every single one.
- X: quote-tweet or reply to every mention.

### Evening (10 min) — schedule tomorrow

Pick ONE channel to push tomorrow. Don't try to hit everything daily; that's how founders burn out and quality drops. Rotation:

| Day | Channel | Content source |
|---|---|---|
| Mon | r/ClaudeAI or r/ChatGPTCoding | [docs/marketing/reddit-posts/](docs/marketing/reddit-posts/) |
| Tue | LinkedIn | [docs/marketing/linkedin-ai-reliability-post.md](docs/marketing/linkedin-ai-reliability-post.md) |
| Wed | Dev.to cross-post | [docs/marketing/devto-article.md](docs/marketing/devto-article.md) |
| Thu | X/Twitter thread | [docs/marketing/x-launch-thread.md](docs/marketing/x-launch-thread.md) (or original) |
| Fri | Cold email batch (20 targets) | [docs/marketing/cold-outreach-sequence.md](docs/marketing/cold-outreach-sequence.md) |
| Sat | YouTube short or TikTok repurpose | `public/assets/tiktok-agent-memory.mp4` |
| Sun | Newsletter / Substack (if you have one) | — |

---

## Post-launch metrics tracking

Keep a single `REVENUE_LOG.md` appendable from CLI:

```bash
# After each channel push:
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) | channel=<x> | url=<url> | initial_impressions=<n>" >> REVENUE_LOG.md
```

Weekly review: which channel drove the most `/checkout/pro` clicks in PostHog? Double down. Cut the bottom 2.

---

## Conversion ratchet — when something works

If a single post/thread crosses 1000 views:

1. **Same day:** cross-post the exact copy to 2 adjacent channels (different sub, different network).
2. **Next day:** turn it into a LinkedIn carousel using the SVG slides in `docs/marketing/assets/`.
3. **Day 3:** rewrite as a dev.to long-form.
4. **Day 7:** package as a case study on the landing page itself.

This is **content recompilation**, not repetition. Same idea, 4 surfaces.

---

## Paid test (conditional — only after organic data)

Don't spend a dollar until you have:
- 200+ organic landing visits (PostHog).
- A channel with >2% CTA click rate.
- Sub-identified highest-CTR copy variant.

Then: **$50 total** on that one channel, one ad creative. If CPA < $40 (one Pro monthly sub = $19 recurring, so CPA $40 gives ~2mo payback), scale in 2x steps. If > $40, kill and retry with different copy.

Never spend on a cold channel. Amplify what's already working.

---

## Outbound cadence (B2B Team plan — highest ACV)

Target: 10 cold outreaches/day. Close ratio industry average ~2% → ~1 closed Team account/month = $147 MRR.

```bash
# Target list
cat docs/OUTREACH_TARGETS.md

# Sequence
cat docs/marketing/cold-outreach-sequence.md
```

Prioritize List A (consulting firms) — they have budget and repeat-failure pain.

Track in a simple spreadsheet: company, contact, date sent, replied Y/N, stage.

---

## Weekly report template

Every Monday morning, post this to your own slack/note:

```
Week of <date>
---
Landing visits:       <posthog>
npm installs:         <from npm stats>
GitHub stars:         <diff from last week>
Pro clicks:           <from posthog>
Pro trials started:   <from stripe>
Pro paid:             <from cfo --today>
Team intake leads:    <from cfo --today>
MRR:                  $<amount>
```

If MRR is flat or declining 2 weeks in a row → full strategy re-examination, not tactical tweaks.

---

## What kills a launch that was working

- Silence after strong initial response. Founders post, get 500 views, go radio silent. **Reply for 48h solid.**
- Switching channels before one works. Pick one. Stay 3 weeks.
- Adding features instead of shipping testimonials. Early traction = get quotes, not new code.
- Paid ads before organic validation. Burns cash, teaches nothing.

---

## Kill criteria

If at day 30:
- MRR still $0, AND
- Organic traffic < 50 visits/day, AND
- No inbound inquiries

…then the positioning is wrong, not the execution. Re-do `primer.md` and the hero H1. Do NOT just post more of the same copy.
