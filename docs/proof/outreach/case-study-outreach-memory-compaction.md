# Outreach pack — Agent memory crowded by near-duplicate lessons

Case id: `memory-compaction`

## Links (tracked)

- Case study: https://thumbgate.ai/case-studies?utm_source=case_study_outreach&utm_medium=case_study&utm_campaign=case_memory_compaction&cta_id=case_memory_compaction_case_study#memory-compaction
- Scorecard: https://thumbgate.ai/eval-scorecard?utm_source=case_study_outreach&utm_medium=scorecard&utm_campaign=case_memory_compaction&cta_id=case_memory_compaction_scorecard
- White paper: https://thumbgate.ai/whitepaper?utm_source=case_study_outreach&utm_medium=whitepaper&utm_campaign=case_memory_compaction&cta_id=case_memory_compaction_whitepaper
- Diagnostic $499: https://thumbgate.ai/diagnostic?utm_source=case_study_outreach&utm_medium=diagnostic&utm_campaign=case_memory_compaction&cta_id=case_memory_compaction_diagnostic
- Pro: https://thumbgate.ai/checkout/pro?utm_source=case_study_outreach&utm_medium=pro&utm_campaign=case_memory_compaction&cta_id=case_memory_compaction_pro

## LinkedIn

Your agent memory fills with the same lesson five times, so the distinct lesson never surfaces.

We dogfooded this on ThumbGate itself: 3 dupe records → 1 survivor per cluster; slot budget back to full.
Retrieval dedupes the candidate pool before ranking, and a compaction CLI merges near-duplicates with summed occurrence counts (opposite-signal lessons never merge); a July 2026 audit found ~86% of promoted lessons were near-duplicates.

Full write-up (no fabricated logos): https://thumbgate.ai/case-studies?utm_source=case_study_outreach&utm_medium=case_study&utm_campaign=case_memory_compaction&cta_id=case_memory_compaction_case_study#memory-compaction
Live bench scorecard: https://thumbgate.ai/eval-scorecard?utm_source=case_study_outreach&utm_medium=scorecard&utm_campaign=case_memory_compaction&cta_id=case_memory_compaction_scorecard

If one repeated AI-agent failure is already costing you, the $499 Diagnostic installs one hard gate with regression proof: https://thumbgate.ai/diagnostic?utm_source=case_study_outreach&utm_medium=diagnostic&utm_campaign=case_memory_compaction&cta_id=case_memory_compaction_diagnostic

## Email

```
Subject: Agent memory crowded by near-duplicate lessons

Hi —

Your agent memory fills with the same lesson five times, so the distinct lesson never surfaces.

Concrete proof from our own product loop (not a customer logo page):
- 3 dupe records → 1 survivor per cluster; slot budget back to full
- Retrieval dedupes the candidate pool before ranking, and a compaction CLI merges near-duplicates with summed occurrence counts (opposite-signal lessons never merge); a July 2026 audit found ~86% of promoted lessons were near-duplicates.

Case study: https://thumbgate.ai/case-studies?utm_source=case_study_outreach&utm_medium=case_study&utm_campaign=case_memory_compaction&cta_id=case_memory_compaction_case_study#memory-compaction
Scorecard: https://thumbgate.ai/eval-scorecard?utm_source=case_study_outreach&utm_medium=scorecard&utm_campaign=case_memory_compaction&cta_id=case_memory_compaction_scorecard
White paper: https://thumbgate.ai/whitepaper?utm_source=case_study_outreach&utm_medium=whitepaper&utm_campaign=case_memory_compaction&cta_id=case_memory_compaction_whitepaper

If you want this on one painful workflow this week: https://thumbgate.ai/diagnostic?utm_source=case_study_outreach&utm_medium=diagnostic&utm_campaign=case_memory_compaction&cta_id=case_memory_compaction_diagnostic
Self-serve Pro: https://thumbgate.ai/checkout/pro?utm_source=case_study_outreach&utm_medium=pro&utm_campaign=case_memory_compaction&cta_id=case_memory_compaction_pro

— Igor
```

## Reddit / forum

**Problem:** Promoted lessons accumulated paraphrases of the same failure, so one real lesson could occupy every retrieval slot and starve distinct ones.

**What we measured:** 3 dupe records → 1 survivor per cluster; slot budget back to full

**What fixed it:** Retrieval dedupes the candidate pool before ranking, and a compaction CLI merges near-duplicates with summed occurrence counts (opposite-signal lessons never merge); a July 2026 audit found ~86% of promoted lessons were near-duplicates.

Public case study (dogfood, not a fake logo wall): https://thumbgate.ai/case-studies?utm_source=case_study_outreach&utm_medium=case_study&utm_campaign=case_memory_compaction&cta_id=case_memory_compaction_case_study#memory-compaction
Bench scorecard: https://thumbgate.ai/eval-scorecard?utm_source=case_study_outreach&utm_medium=scorecard&utm_campaign=case_memory_compaction&cta_id=case_memory_compaction_scorecard

## Honesty

First-party dogfood narrative only. Do not imply third-party customer endorsement.
