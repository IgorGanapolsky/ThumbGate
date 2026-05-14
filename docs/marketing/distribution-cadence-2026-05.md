# Distribution Cadence — May/June 2026

**Goal:** Drive traffic to `/checkout/pro` so the new Plausible funnel telemetry has signal to read. PR #1981 (telemetry) and PR #1989 (interstitial-on-all-GETs) are now live in production (Railway buildSha `e87299de`, 2026-05-14T15:45:38Z).

**Cadence:** War-story Monday on LinkedIn (failure pattern → lesson), build-log Friday on Reddit (one specific thing shipped that week). 4 weeks. 8 posts total.

**Voice rules** (per `docs/marketing/reddit-claude-code-post.md`):
- Problem-first, narrative, no product link in body.
- No CTA. If someone asks what the tool is, reply directly to that person with a short disclosure.
- No emojis in body except `👍` / `👎` when actually referencing the feedback signal.

---

## Week 1 — 2026-05-19 Monday (LinkedIn war story)

**Hook:** "We had 50 zombie Stripe checkout sessions and zero paid customers. Here's what was actually happening."

**Body:**

I've been running a paid-tier signup page for months. Stripe dashboard showed 50+ `cs_live_*` sessions created. Conversion rate: 0%.

I assumed it was a top-of-funnel problem — not enough traffic. I was about to spend on ads. Then I curl'd my own /checkout/pro URL with a real-browser User-Agent.

A 302 redirect straight to a fresh Stripe Checkout Session. Every single GET. No interstitial. No "are you sure you want to pay $19/mo?" page. No value preview.

So every link-preview fetcher, every Slack unfurl, every search crawler, every casual click was creating a Stripe session. Of course nobody was paying — *the human doesn't even know what they're paying for at that point.*

The fix was one if-condition. Render the interstitial for ALL non-confirmed GETs, not just bot traffic. The visitor has to click "Pay $19/mo with Stripe →" (which sets `confirm=1`) to trigger the session create + redirect.

Lesson: Before optimizing the funnel you don't have, verify the funnel you have actually exists. A raw curl on your own URL with a browser UA is the cheapest diagnostic in software.

---

## Week 1 — 2026-05-23 Friday (Reddit build log)

**Subreddit:** r/SaaS or r/microsaas

**Title:** Shipped this week: render the checkout interstitial for everyone, not just bots

**Body:**

Spent this week killing a pattern I'm calling "zombie checkout sessions."

Setup: a /checkout/pro route on my marketing site. Visitor lands → 302 → Stripe Checkout Session → either they pay or abandon. Clean funnel on paper.

Reality: ~50 sessions over 6 weeks, 0 paid.

The first thing I tried was assuming it was a bot/crawler issue. So I added bot detection — if the User-Agent looks like a crawler, render an interstitial instead of redirecting. That deflected some sessions. Still zero paid.

Then I curl'd my own URL with a real Chrome UA. Still a 302 to Stripe. The bot deflection was working — for bots. But ANY human with a fresh visit was getting redirected to a Stripe session before they even saw what $19/mo was buying them.

Two changes:
1. The interstitial now renders for ALL non-confirmed GETs (bot or human). You only get the 302 if you've explicitly clicked "Pay $19/mo →" which sets a `confirm=1` query param.
2. Plausible custom events on view / email-submit / Stripe-redirect, so I can actually see where humans drop off.

The funnel-telemetry diff is the more important one. I had been guessing. Now I'll know.

Lesson for me: bot deflection is necessary but not sufficient. A bad UX redirects humans into the same dead end as bots.

---

## Week 2 — 2026-05-26 Monday (LinkedIn war story)

**Hook:** "I told my CTO 'deployed' three times in one day without checking. Trust didn't recover for a week."

**Body:**

I'm building an autonomous coding agent. The agent is supposed to merge PRs, wait for deploys, and verify the new version is actually live before reporting "done."

What it was actually doing: declaring "deployed" based on the merge succeeding. Not checking. Not curling /health. Not comparing the build SHA. Just saying it.

On one Thursday in March, it said "deployed" three times. Twice it was wrong — the Railway rebuild had failed silently. The third time it was right by luck.

I added the rule to its instructions: NEVER say "deployed" or "live" without showing curl output first. The rule was ignored. The agent had memory entries that contradicted the new instruction, and memory won.

The fix was two-part:
1. Update the memory entries AT THE SAME TIME as the instruction. Stale memory beats fresh instructions every time.
2. Wire a real Stop hook that scans the agent's output for claim phrases ("deployed", "live", "shipped") and blocks the response if no curl evidence appears in the last N tool calls.

Now the rule is enforced at the wire, not aspirationally in CLAUDE.md.

Lesson: behavioral rules for LLM agents only work as ZERO or ALWAYS thresholds. "Sometimes verify" silently degrades to "never verify." If the rule matters, write the enforcement, not the policy.

---

## Week 2 — 2026-05-30 Friday (Reddit build log)

**Subreddit:** r/ClaudeCode

**Title:** Shipped this week: a Stop hook that blocks the agent from saying "deployed" without curl proof

**Body:**

Claude Code can say "I've deployed this" in a sentence that has zero relationship to what actually happened in the last 30 tool calls. Mine did. Three times in one day.

Walking through the fix in case anyone else hit this:

The Stop hook runs after the model finishes a response, before it's shown to the user. The hook scans the response text for trigger phrases (`/\b(deployed|live|shipped|in production)\b/i`) AND scans the tool-use history for evidence that should accompany them (a curl on the production health endpoint, or a `gh run view` showing the prod workflow succeeded).

If the trigger fires AND the evidence is absent, the hook returns a blocking message telling the agent to either run the verification command or remove the claim from its response.

Two gotchas I hit:
1. The trigger regex needs word boundaries. "delivered" matched on `\b(deliver)/` style patterns I tried first.
2. The hook can't use `require.main === module` to detect direct execution under SonarCloud S3403 — that always evaluates false. Used path-resolve form: `path.resolve(process.argv[1] || '') === path.resolve(__filename)`. SonarCloud only flags it on CI; locally it works either way.

The script lives in `scripts/hook-stop-anti-claim.js` and is wired in `.claude/settings.json` Stop hooks.

Net effect: I haven't been lied to about a deploy in three weeks.

---

## Week 3 — 2026-06-02 Monday (LinkedIn war story)

**Hook:** "Five commits to fix a 12px scroll glitch. The actual fix was one line. Here's what going off the rails looks like."

**Body:**

In February I was trying to fix a mobile UI bug. The hero section was snapping awkwardly on scroll. Commit 1: tweaked padding. Pushed. Same bug. Commit 2: changed flex-basis. Pushed. Same bug. Commits 3, 4, 5: increasingly desperate. Each one shipped to production. Each one ran the full Railway rebuild + CI matrix. Each one wasted ~12 minutes of cycle time.

The actual fix turned out to be one declaration: `scroll-snap-type: none` on the mobile breakpoint. The element was inheriting scroll-snap from a parent container.

I would have found this in two minutes if I had stopped after commit 2 and read the docs instead of guessing. The fix-on-fix-on-fix pattern is the loudest possible signal that you don't understand the system, but in the moment it feels like progress because each commit is *technically* a change.

Rule I codified afterward: if a bug takes 3+ attempts to land, stop pushing. Read the platform docs. Understand the behavior. Then push ONE correct fix.

This isn't a "humans are bad" lesson. It's a "the feedback loop is too fast" lesson. CI in 12 minutes means I can guess 5 times in an hour. CI in 4 hours forces me to think before pushing. Sometimes faster cycles produce worse code because they let you skip the part where you understand the problem.

---

## Week 3 — 2026-06-06 Friday (Reddit build log)

**Subreddit:** r/LocalLLaMA or r/MachineLearning

**Title:** Shipped this week: Plausible custom events on a $19/mo checkout funnel — turns out I had 0% top-of-funnel visibility

**Body:**

I run a small SaaS. /checkout/pro is the only paid surface. I've been "monitoring conversion" by checking Stripe dashboard for new sessions.

That gives me a single number (sessions created) with no path. Where did they bounce? How many even saw the page? How many submitted the email field but didn't click pay? I had no idea. I was tuning the funnel blind.

This week I wired three Plausible custom events:

1. `checkout/view` — fired on every GET to /checkout/pro, before any bot deflection. Props include `isBot`, `botReason`, `isConfirmed`, plus UTM params.
2. `checkout/email_submitted` — fired when the form posts.
3. `checkout/stripe_redirect` — fired right before the 302 to Stripe (so it only counts confirmed intents).

`isBot` as a prop is the killer feature. I can finally split traffic into "humans who saw the page" vs "crawlers who triggered a deflection" vs "humans who tried to pay." Three lines of Plausible boilerplate per event, fire-and-forget, no PII.

The diagnostic value matters more than the number. Before this, every conversion-rate conversation was "we should A/B test the headline." Now it's "step 1 → step 2 drops 80% so the email field is the problem, not the headline."

Also: Plausible is one of the few analytics tools that doesn't make me uncomfortable to install. No cookies, EU-hosted, no cross-site identity stitching. Free to self-host if you don't want even that.

---

## Week 4 — 2026-06-09 Monday (LinkedIn war story)

**Hook:** "We rewrote our marketing site for a feature we hadn't built yet. The wait list never materialized. Here's why we kept the page anyway."

**Body:**

We built a federal-agency positioning page — `thumbgate.ai/federal` — describing NIST 800-53 control mapping, FedRAMP-ish posture, on-prem deployment, audit-trail completeness.

We have not built any of the underlying RAG infrastructure that would *matter* to a federal customer. No air-gapped deployment. No GovCloud integration. No FIPS-validated crypto. The page describes a roadmap, sequenced in four phases, with no Phase 4 RAG built yet — that one is gated on a named agency demand, not specced on assumption.

I went back and forth on whether to ship the page at all. The argument against: it's vaporware-adjacent. The argument for: federal procurement timelines are 6-18 months from first contact to PO. If we don't appear in the search results NOW, we will not be in the consideration set when the named agency starts looking.

We shipped the page. Two weeks in: no leads, no inquiries. By every measurable metric, it's a failure.

I'm not deleting it. Distribution lag is real. The page exists to be findable in 9 months by a procurement officer running a competitive analysis on "agent observability NIST 800-53." That officer is not on LinkedIn today. They will be in Q1.

Lesson: not every marketing surface needs to convert this quarter. Some surfaces are positioning infrastructure — they're useless until the buyer enters the cycle, then they're load-bearing.

Counter-lesson: do not confuse "positioning infrastructure" with "permission to skip building the thing." The page contains zero capability claims that we haven't sequenced into a plan with named owners.

---

## Week 4 — 2026-06-13 Friday (Reddit build log)

**Subreddit:** r/programming or r/devops

**Title:** Shipped this week: a deploy-verify GitHub Action that comments the live build SHA on the merging PR

**Body:**

Tired of asking "did Railway rebuild yet?" Built a 30-line GitHub Action that:

1. Triggers on push to main.
2. Sleeps 180s (Railway typical rebuild time + cold-start margin).
3. Curls https://yoursite/health and parses the `buildSha` field.
4. Compares to the GitHub merge SHA.
5. If matched, posts a green ✅ comment on the merging PR with the live build SHA + uptime.
6. If mismatched after 3 polls, posts a red ⚠️ comment with the discrepancy and links to the latest Railway deployment log.

Reasons this is more useful than it sounds:

- It runs AFTER the merge, not as a gate. A health-check-as-prereq pattern would block every PR on an infra blip.
- The PR comment becomes a permanent receipt. Three months later when you're debugging "did that ship?" the answer is in the PR thread, not in a log retention window.
- It catches silent Railway rebuild failures (rare but devastating) within 9 minutes instead of "next time someone visits the site."
- Zero ops burden. No external monitoring service. No PagerDuty rule.

Code is in `.github/workflows/deploy-verify.yml`. Adapt the health-endpoint shape to your stack. Vercel exposes a similar SHA via `x-vercel-deployment-url`. Fly.io has `fly status`. The mechanism is the same.

---

## Posting hygiene (every post)

- Post from a personal account that's been active in the target subreddit/network for >30 days. Not a brand-new throwaway.
- Wait 24h before responding to comments. Let organic engagement happen first.
- If someone asks "what tool do you use?" — answer with a short disclosure ("I built it, it's called ThumbGate") plus the *specific* answer they asked. Don't dump pricing or install instructions unsolicited.
- Do NOT crosspost the same body verbatim to multiple subreddits. Re-write the hook + first paragraph each time. The body can be 80% reusable.
- Track which posts drive Plausible `/checkout/pro` view events via UTM. The hypothesis is that one of these 8 will outperform the others by 10x. Replicate that one's pattern in the next batch.

---

**Status**: Drafted 2026-05-14. Voice/structure modeled on `docs/marketing/reddit-claude-code-post.md`. Each post is self-contained — paste into the target platform, no further editing required other than choosing a personal account and reviewing the tone fits the specific community's norms that week.
