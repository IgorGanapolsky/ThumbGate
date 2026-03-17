# Reddit GTM Playbook

This is the operator playbook for driving the first attributed dollars from Reddit without tripping subreddit spam filters.

## Positioning

Lead with the real wedge:

- local-first feedback loop for coding agents
- retrieval + validation + prevention rules
- reduces repeated mistakes across sessions

Do not lead with generic "persistent memory for Claude" copy. That category is crowded and weakly differentiated.

## Tracking Contract

Every Reddit link should carry explicit attribution because Reddit app/browser flows can lose referrer fidelity.

Recommended URL shape:

```text
https://rlhf-feedback-loop-production.up.railway.app/?utm_source=reddit&utm_medium=organic_social&utm_campaign=reddit_launch&utm_content=comment_problem_solution&community=ClaudeCode&post_id=1rsudq0&comment_id=oa9mqjf&campaign_variant=comment_problem_solution&offer_code=REDDIT-EARLY
```

Required fields:

- `utm_source=reddit`
- `utm_medium=organic_social`
- `utm_campaign=reddit_launch`
- `community=<subreddit>`
- `campaign_variant=<copy angle>`

Optional fields:

- `post_id=<reddit post id>`
- `comment_id=<reddit comment id>`
- `offer_code=REDDIT-EARLY`

These fields are stitched through landing telemetry, checkout metadata, funnel acquisition, and revenue attribution.

## 7-Day Sequence

1. Day 1: Comment on live complaint threads. No new promo post.
2. Day 2: Post a benchmark / lessons-learned thread in `r/ClaudeCode`.
3. Day 3: Post a showcase-compliant build post in `r/ClaudeAI`.
4. Day 4: Add 5 more comments on fresh high-intent threads.
5. Day 5: Post a feedback-seeking version in one builder community.
6. Day 6: Publish a "why MEMORY.md is not enough" follow-up.
7. Day 7: Boost the best-performing Reddit asset only after organic proof.

## Post Angles

### `r/ClaudeCode`

Title:

`I tested 3 ways to stop Claude Code from repeating the same mistakes`

Core points:

- static docs help but are not enough
- structured feedback + retrieval + prevention rules worked better
- self-hosted is free

### `r/ClaudeAI`

Use a showcase-safe format:

- explicitly say you built it
- say Claude Code helped build it
- describe what it does
- say the self-hosted version is free to try
- keep marketing language minimal

## Comment Framework

Use this structure:

1. agree with the concrete pain
2. explain the missing mechanism
3. mention the tool only as an implementation of that mechanism
4. offer the self-hosted link

Example:

```text
I hit the same problem. Static docs helped, but they didn’t stop the agent from repeating operational mistakes. What worked better was turning failures into structured lessons plus retrieval on the next task. I built a local-first version of that loop for coding agents; self-hosted is free if you want to try it.
```

## Success Metrics

Treat these as the real signals:

- `telemetry.visitors.byTrafficChannel.reddit`
- `telemetry.visitors.byCommunity`
- `billing.attribution.acquisitionByCommunity`
- `billing.attribution.acquisitionByOfferCode`
- `billing.attribution.paidByCommunity`
- `billing.attribution.bookedRevenueByOfferCodeCents`

Verification proof for the instrumentation and tests lives in [VERIFICATION_EVIDENCE.md](./VERIFICATION_EVIDENCE.md).
