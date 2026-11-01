---
name: user-week-job-bench
description: >
  Count ThumbGate feedback by person and week on a fixed job list. A thin
  sample shrinks toward the category norm. A done claim needs a receipt.
  A Pay click is not a paid order. Format taken from the Enterpret personal
  agent ranking. Do not copy their scores or book their product.
---

# User-week job bench

## Goal

Agents working on ThumbGate money talk must separate volume from love.
Twenty notes from one person are one person. A Pay click is not cash.
Saying the work is done requires a receipt id.

## Constraints

| NEVER | ALWAYS |
| --- | --- |
| Copy Enterpret Feedback Scores or their customer stories | Link the method source and score only ThumbGate records |
| Let one person's posts outvote everyone else | One actor, one ISO week, one job |
| Treat a thin sample as certainty | Shrink toward 0.5 until eight people are in that job |
| Call stripe confirms, pay clicks, or checkout intent clicks booked money | paid orders 0, $0.00, and a hosted source line, or retract |
| State a positive booked dollar with no hosted source line | Hosted source in the same turn |
| Claim done with no receipt id | Receipt id on the record, or hold |
| Rank Muse, Hermes, Grok Bot, Hark, Instinct, OpenClaw, Wabi, Gemini Spark, Fo, Cue, Poke, or ChatGPT Dots | Fixed ThumbGate jobs only |

## Reference

- https://www.enterpret.com/guides/the-12-best-personal-ai-agents-in-2026-ranked-by-real-user-sentiment
- `scripts/user-week-job-bench.js`
- Stop hook: `scripts/hook-stop-anti-claim.js` calls `evaluateMoneySpeech` before the completion-claim check

Jobs: said_done_without_receipt, pay_choice_counted_as_paid, setup, always_on, model_choice, control, price, getting_tasks_done.

## Examples

Weak: "stripe confirms mean we booked revenue."

Gold: "paidOrders 0, bookedRevenue $0.00, Source: hosted-http-api."

A done record:

```json
{"actorId":"ada","at":"2026-10-27T15:00:00.000Z","claimedDone":true,"receiptId":"rcpt-1","job":"getting_tasks_done","praise":true}
```

## Procedures

```bash
node scripts/user-week-job-bench.js <<'JSON'
[{"actorId":"ada","at":"2026-10-27T15:00:00.000Z","job":"getting_tasks_done","praise":true}]
JSON
node --test tests/user-week-job-bench.test.js
```

1. Label each feedback record with one fixed job. Do not ask a model to invent themes per run.
2. Drop a record that has no actor id. Collapse the rest to one row per actor, ISO week, and job. A complaint in that row wins over praise.
3. Read `love` only after shrinkage. `rawLove` of 1 from a single person is not the published figure.
4. Before saying the agent finished, require `receiptId`. Before saying money was booked, require the hosted source line from `node scripts/revenue-status.js` in the same turn.
5. Do not spend, email, or book a demo to use this bench.
