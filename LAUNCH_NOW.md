# LAUNCH NOW — Revenue Ignition Checklist

**Status as of 2026-04-14:** $0 lifetime revenue. 0 signups. Funnel is wired, product is shipped, copy is written. **Nothing has been posted.** This file is the single-page launch trigger.

Every line is a copy-paste action. Do them in order. Total time: ~45 minutes.

---

## Pre-flight (5 min) — verify the funnel is actually alive

```bash
# 1. Landing page loads
curl -sS https://thumbgate.ai/ | grep -q 'ThumbGate' && echo "✅ landing up" || echo "❌ landing DOWN"

# 2. Checkout endpoint responds
curl -sS -o /dev/null -w "%{http_code}\n" https://thumbgate.ai/checkout/pro

# 3. Health endpoint returns current version
curl -sS https://thumbgate.ai/health | head -c 200
```

If any of those fail: STOP and fix before posting. You do not want to land traffic on a broken funnel.

---

## Step 1 — Show HN  (window: Sun 9 PM ET or Tue 7 AM ET)

**Submit at:** https://news.ycombinator.com/submit

- **Title** (paste exactly): `Show HN: ThumbGate – Persistent memory for AI coding agents`
- **URL:** `https://github.com/IgorGanapolsky/ThumbGate`
- **Text** (leave blank — HN prefers URL-only for Show HN if you have a GitHub link; or paste the body from [docs/marketing/show-hn.md](docs/marketing/show-hn.md) if you want a text post)

**After posting:**
- Post first comment immediately with the 30-sec demo + `npx thumbgate init` command.
- Stay at the keyboard for 2 hours. Every comment gets a reply within 5 minutes. HN ranking decays fast.

---

## Step 2 — X/Twitter thread  (fire 30 min after Show HN goes live)

Source: [docs/marketing/x-launch-thread.md](docs/marketing/x-launch-thread.md) (10 tweets, pre-written)

- Paste Tweet 1 → schedule the rest as a thread reply chain.
- Quote-tweet the Show HN link in tweet 10.
- Attach: [docs/marketing/assets/ai-reliability-system-x-card.svg](docs/marketing/assets/ai-reliability-system-x-card.svg)

---

## Step 3 — Reddit seeding  (90 min after Show HN, one sub per hour)

Post order (rate-limit yourself — Reddit bans burst cross-posting):

| Order | Subreddit | Source file | Status |
|-------|-----------|-------------|--------|
| 1 | r/ClaudeAI | [docs/marketing/reddit-posts/r-claudeai.md](docs/marketing/reddit-posts/r-claudeai.md) | [ ] |
| 2 | r/LocalLLaMA | [docs/marketing/reddit-posts/r-locallama.md](docs/marketing/reddit-posts/r-locallama.md) | [ ] |
| 3 | r/ChatGPTCoding | [docs/marketing/reddit-posts/r-chatgptcoding.md](docs/marketing/reddit-posts/r-chatgptcoding.md) | [ ] |
| 4 | r/node | [docs/marketing/reddit-posts/r-node.md](docs/marketing/reddit-posts/r-node.md) | [ ] |
| 5 | r/webdev | [docs/marketing/reddit-posts/r-webdev.md](docs/marketing/reddit-posts/r-webdev.md) | [ ] |

After each post, tick the STATUS.md file.

**Rule:** Do not paste a store link or `/checkout/pro` in Reddit posts. Reddit kills vendor posts. Link to the GitHub repo only. The README converts from there.

---

## Step 4 — LinkedIn / dev.to  (day 2)

- LinkedIn reliability post: [docs/marketing/linkedin-ai-reliability-post.md](docs/marketing/linkedin-ai-reliability-post.md)
- dev.to article: [docs/marketing/devto-article.md](docs/marketing/devto-article.md)
- Cross-post to hashnode + medium (same body).

---

## Step 5 — Product Hunt  (next Tuesday 12:01 AM PT)

Kit: [docs/marketing/product-hunt-launch-kit.md](docs/marketing/product-hunt-launch-kit.md)

PH wants you to line up 10+ hunters in advance. Start DMing today.

---

## Step 6 — Outbound (parallel to launch)

- Cold outreach (20 targets/day): [docs/marketing/cold-outreach-sequence.md](docs/marketing/cold-outreach-sequence.md)
- Target list: [docs/OUTREACH_TARGETS.md](docs/OUTREACH_TARGETS.md) — List A (consulting firms) first, highest ACV.
- Team intake is your highest-value funnel at $49/seat/mo × 3-seat minimum = $147 MRR per close.

---

## Kill switches — stop immediately if these happen

- Railway returns 5xx on `/` or `/checkout/pro` → pull the launch, post a stickied comment, fix, relaunch.
- Show HN gets downvoted to page 3 inside 30 min → don't amplify with paid, reassess post title and resubmit next cycle.
- Stripe checkout fails → you lose every visitor who clicked. Verify with `curl` BEFORE posting HN.

---

## What success looks like (48h targets)

| Metric | Target | Measure via |
|---|---|---|
| Landing page visits | 500+ | PostHog funnel |
| npm installs | 30+ | `npm view thumbgate` download count |
| GitHub stars | 50+ | repo page |
| Paid Pro conversions | 3+ | `node bin/cli.js cfo --today` |
| Show HN points | 30+ | HN front page |

If 48h hits <100 visits: the problem is the post timing/title, not the product. Rewrite the hook and retry next cycle.

---

## After first sale

```bash
node bin/cli.js cfo --today   # verify the ledger saw it
```

Screenshot. Post it publicly ("first dollar"). That screenshot is more conversion fuel than any ad.
