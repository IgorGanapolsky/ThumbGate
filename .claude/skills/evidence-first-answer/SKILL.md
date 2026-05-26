---
name: evidence-first-answer
description: Required pre-flight before answering any "why" or "are we" question about revenue, conversion, outbound, traffic, or commercial state. Forces verification of live data and distinguishes planning docs from telemetry. Triggered automatically when the CEO asks "are you sure?" — that phrase means the previous answer was wrong.
allowed-tools:
  - Bash
  - Read
---

# Evidence-First Answer — The "Are You Sure?" Discipline

## When to invoke

- Any user question that contains: "why didn't", "how come no", "are we", "what's our", "did we", "how much", "revenue", "money", "customers", "conversion", "traffic", "leads", "sales"
- Any pushback that contains: **"are you sure?"**, "really?", "is that right?", "verify", "prove it"
- Before writing any phrase that implies traction or its absence

## The hard discipline (4 steps, no skipping)

### 1. Date-check every number you're about to cite

```bash
# For any doc you're about to quote:
git log -1 --format='%ai %s' -- <path>
grep -E "^Updated:|^Status:|2026-" <path> | head -5
```

If the doc's last-updated date is older than 14 days, **treat its numbers as historical, not current.** Say "as of <date>" explicitly.

### 2. Distinguish "plan" from "telemetry"

Words/phrases that mean the number is a **forecast, not an actual**:
- "30-day revenue plan showed..."
- "Modeled target..."
- "Projected..."
- "If we hit..."
- Any number inside `docs/MONETIZATION_EXEC_SUMMARY_*.md` past line 30
- Any number inside `reports/gtm/*` that isn't backed by a same-file `curl` output

Words/phrases that mean the number is **measured**:
- "`getBillingSummary` returned..."
- "`curl /v1/billing/summary` JSON..."
- "Stripe-reconciled charges..."
- A bash code block with the actual command + output

When in doubt, run `revenue-truth` skill — query the live endpoint.

### 3. The "what would change my mind" test

Before submitting an answer, write down: *"What single piece of evidence would prove this answer wrong?"* Then go look for that evidence. If you find it, rewrite. If you can't find a falsifier, your hypothesis is probably too vague — refine it.

### 4. State your uncertainty explicitly

End every answer that touches commercial state with:
- **What I verified:** (curl outputs, file dates, commit SHAs)
- **What I'm assuming:** (and why)
- **What would change the answer:** (the specific check the user can run)

## The "Are You Sure?" rule (from CLAUDE.md)

> When the CEO says "are you sure?" — you're wrong. Dig deeper. Do not defend your current hypothesis. Re-examine from scratch.

Concrete protocol when this triggers:

1. **Do not restate.** Do not add caveats to the previous answer.
2. **Re-read** the docs you cited, checking dates and source labels.
3. **Run the live check** (`revenue-truth` skill or equivalent).
4. **Find what you got wrong** before defending what you got right.
5. **Reply with the correction first**, then the new answer.

If the CEO asks "are you sure?" a **second** time, the answer is structurally wrong — not just numerically off. Look for unstated assumptions:
- Am I treating credentials/tokens as terminal blockers when manual routes exist?
- Am I confusing drafted work with sent work?
- Am I confusing engineering velocity with commercial velocity?
- Am I quoting forecasts as actuals?

If a **third** time: stop, ask the CEO what specific evidence I'm missing, and re-bootstrap from scratch. Do not produce a fourth answer of the same shape.

## Anti-patterns this skill exists to prevent

| Pattern | Why it's wrong |
|---------|----------------|
| Quoting `5,984 visitors` from a "30-day revenue **plan**" as if measured | It's a forecast, not telemetry |
| Citing `docs/VERIFICATION_EVIDENCE.md` March-19 numbers as "current 30d" two months later | Numbers don't auto-refresh |
| Saying "blocked by Gmail SMTP / LinkedIn token" without trying the manual route | Tokens fail; humans don't |
| Conflating "drafted in `gtm-revenue-loop.md`" with "sent" | Drafting is not sending |
| Saying "deployed" or "live" without curl output | Hard-block rule #6 |

## Exit criteria

An answer is ready when you can show:
1. A live curl OR a file path + line number with a date check, for every number
2. A "what would change my mind" sentence
3. No "should", "probably", "I think" without "verified by `<command>`" attached
