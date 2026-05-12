# Hacker News Reply Drafts — 2026-05-11

**Posting workflow:** HN doesn't have a public posting API. CEO logs into news.ycombinator.com in browser, navigates to each comment URL, clicks "reply", pastes draft, clicks "add comment".

**Voice rule:** HN's anti-shilling sensitivity is high. Each draft is a contextual response to the specific commenter's words, with one soft link to thumbgate.ai. No "I'm building" boilerplate.

---

## Reply 1 — to `@ihatemodels` (the explicit "I'd pay" signal)

**Target:** https://news.ycombinator.com/item?id=48057849

**Their comment (verbatim excerpt):** *"You're solving a real problem, and despite beeing a bit broke ATM, I'd be willing to pay for a tool like this given the amount of time I spend on review. My current workf[low...]"*

**Draft reply (open in browser, click "reply", paste):**

```
Free tier of ThumbGate (`npx thumbgate init`) might cover what you need for $0
until you can swing the paid plan — local PreToolUse hook layer, one 👎
creates a rule that blocks the same agent failure on next attempt. Pro at
$19 is for the dashboard / lessons recall across sessions / DPO export to
fine-tune locally. MIT-licensed.

https://thumbgate.ai if you want the long version.
```

**Why this works:** They said they're broke. The pitch leads with "free covers your need," not "buy now." That respects their stated constraint and likely earns goodwill.

---

## Reply 2 — to `@reubenlavin` (the infra-safety concern)

**Target:** https://news.ycombinator.com/item?id=48056665

**Their comment (excerpt):** *"I'm particularly interested in the disable-model-invocation: true safety on /exec and /cleanup. It addresses the biggest hurdle for AI in infra: the fear of an [agent doing something bad]."*

**Draft reply:**

```
Same fear got me deep into this. ThumbGate (`npx thumbgate init`) is a local
PreToolUse hook that gates exactly the /exec /cleanup-flavored commands
you're describing — but as a layer below the runtime instead of a flag on
the model invocation. After one 👎 on a destructive call, the same pattern
blocks on the next attempt, before the tool fires. Open source.

If you want a starter rule against a specific destructive command pattern
you're trying to disarm, drop it here and I'll wire it.
```

**Why this works:** Engages with the technical layer they're talking about (model invocation vs PreToolUse hook), offers a concrete service in the comment thread.

---

## Reply 3 — to `@selfsimilar` (the "trust without reading" admission)

**Target:** https://news.ycombinator.com/item?id=48098105

**Their comment (excerpt):** *"For 7 months I'd been prompting and shipping without ever sitting down and actually reading the code Claude wrote. I'd look at the diff, verify it compiled, test the ha[ppy path]..."*

**Draft reply:**

```
This habit is the most expensive to unlearn — speaking from my own debt.
The thing that helped me wasn't reading every diff (impossible at scale),
it was setting up a local PreToolUse hook so the destructive tool calls
that would have slipped past my rubber-stamp get blocked before they
fire. `npx thumbgate init` if you want a starter set; the failure
patterns you've already lived through are the highest-yield first rules.
```

**Why this works:** Empathetic ("speaking from my own debt"), specific ("destructive tool calls"), no aggressive CTA.

---

## Optional Reply 4 — to the 860-pt "AI deleted production DB" thread

**Target:** https://news.ycombinator.com/item?id=47911524 (the parent thread)

**Or reply to a specific commenter** like `@lowbloodsugar` ([hn:47918606](https://news.ycombinator.com/item?id=47918606)) who quoted the original incident.

**Draft (much more careful — thread is large, shilling sensitivity high):**

```
Built ThumbGate (`npx thumbgate init`, MIT) for exactly this — a local
PreToolUse hook that blocks the destructive API call before the agent
fires it, after one 👎 on the failure pattern. Doesn't fix the underlying
"agent has too much trust" problem but stops the specific repeat. Free
tier covers daily-driver use.

(If anyone wants a starter rule against `terraform destroy` /
`rm -rf /` / `DROP TABLE` patterns, drop the exact command and I'll
post the rule here.)
```

**Posting risk:** A bare "here's my product" comment on a 2-week-old top story will get downvoted as shilling. The "(If anyone wants a starter rule...)" closer offers concrete service and might offset that.

**Recommendation:** Post replies 1, 2, 3 first. Watch reaction. Only attempt reply 4 if the first three land cleanly (no flagged-as-spam).

---

## Tracking

Add to UTM links if used: `?utm_source=hn&utm_medium=comment&utm_campaign=lead_2026_05_11&utm_content=hn_<commentID>`

When a reply happens or someone DMs from HN, log it here.
