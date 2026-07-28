# How ThumbGate's learned models are evaluated

Written 2026-07-28, after an audit found the risk model was reporting a single number —
in-sample accuracy — and nothing else.

## The defect this fixes

`risk-model.json` reported exactly one quality figure:

```json
"metrics": { "trainingAccuracy": 0.820212171970966, "rounds": 8, "mode": "boosted" }
```

Measured on the same 1,791 rows it was trained on. Three things were wrong with it:

1. **No held-out estimate existed.** There was no split, no cross-validation, and no
   `holdout` anywhere in `risk-scorer.js`. Generalization was not poor — it was *unmeasured*.
2. **It was never compared to the trivial baseline.** The corpus base rate is **0.711**, so
   answering "high-risk" unconditionally scores 71.1%. The headline 82.0% was an 11-point
   in-sample lift being read as an 82-point achievement.
3. **Accuracy is the wrong metric for a 71/29 corpus.** No precision, recall, AUC, MCC, Brier,
   or calibration was recorded.

There was also no test that could fail if quality regressed. The existing suite asserted
mechanics — the artifact is written, a reloaded model predicts consistently, one synthetic row
outranks another. **A model that decayed to the 71% baseline would have passed CI green.**

## What is measured now

Every trained model records three reports (`scripts/model-eval.js`):

| Report | Question it answers |
|---|---|
| `metrics.inSample` | What it scores on its own training rows. Kept only as a reference point, explicitly labelled. |
| `metrics.holdout` | **IID:** does it work on new rows of familiar kinds? |
| `metrics.holdoutNovelContext` | **Distribution shift:** does it work on action types absent from training? |

Each carries `accuracy`, `baselineAccuracy`, `lift`, `precision`, `recall`, `specificity`,
`f1`, `mcc`, `rocAuc`, `brierScore`, `expectedCalibrationError`, and the confusion matrix.
`lift` sits next to `accuracy` in every report so accuracy can never again be quoted without
the baseline it must beat.

## Current results

Real corpus, 1,791 rows, 12 independent group-aware stratified splits
(`node scripts/eval-risk-model.js --corpus ~/.thumbgate/feedback-sequences.jsonl`):

```
in-sample accuracy                    0.8202     <- the number that used to be reported alone

IID held-out (familiar kinds)
  lift over majority baseline        +0.091 ± 0.014     12/12 folds beat baseline
  ROC-AUC                             0.883 ± 0.012
  MCC                                 0.528
  ECE                                 0.063

Novel-context held-out (unseen action types)
  lift over majority baseline        +0.016 ± 0.077     10/12 folds beat baseline
  ROC-AUC                             0.873 ± 0.091
  MCC                                 0.488
  ECE                                 0.144
```

**The honest reading.** On familiar traffic the model is genuinely useful: +9 points over the
trivial baseline, every fold, with AUC 0.88. On *unfamiliar* action types its accuracy lift is
statistically indistinguishable from zero — the spread (±0.077) is five times the mean, and a
re-run at 8 resamples produced −0.017. Ranking still holds up there (AUC 0.87), but the
thresholded decision does not.

For a firewall this distinction is the important one, because novel actions are exactly the
case that matters. Treat the model as a **triage/ranking signal**, not as a binary authority on
unfamiliar input. That is also why the deterministic gate rules — not the model — remain the
enforcement mechanism.

## Why both numbers are reported

The two splits differ only in what defines a "group" that must not straddle the fold boundary:

- IID uses the full feature vector — 1,754 groups over 1,791 rows, so only 37 true duplicates
  are held together.
- Novel-context uses coarse content identity (context, domain, skill, tags) — **375 groups, the
  largest holding 655 rows**, so whole categories of action move as a unit.

Neither is wrong; they answer different questions. Reporting only the first would be the same
error as reporting only in-sample accuracy, one level up.

## Two bugs the tests caught in this work

Both were in the splitter, and both would have inflated every number above.

1. **Tied-hash leakage.** Rows were assigned individually after sorting by hash. Identical rows
   share a hash and sort adjacently, so a cut point landing inside a tied block put one copy in
   train and its twin in test.
2. **Cross-class leakage.** Grouping per class still split duplicates: with label noise, one
   feature vector can carry both labels, so its copies landed in different class buckets and
   different folds.

The fix is group-first assignment across classes with per-class quotas
(`StratifiedGroupKFold` semantics). `tests/risk-model-quality.test.js` asserts no key appears
in both folds.

## The CI gate

`tests/risk-model-quality.test.js` runs against a **deterministic synthetic fixture** (fixed
LCG, never `Math.random()`), because the real corpus is private and CI cannot see it. This
buys a specific diagnostic:

- **These tests fail → the trainer is broken.**
- **They pass but the real corpus shows no lift → the trainer is fine and the data lacks
  signal.**

Those need different fixes, and a suite that cannot tell them apart sends you to debug the
wrong one. The gate asserts held-out lift > 0.15, AUC > 0.75, and MCC > 0.5 on planted signal;
that **pure noise yields < 0.15 lift** (a label-leak canary); that holdout is reported at all;
that every accuracy is accompanied by its baseline; and that splits are reproducible.

## Known weaknesses, not hidden

- **Boosting collapses onto one feature.** On the real corpus six of eight stumps split on
  `recentTrend` — a measure of how the session has been going, not of whether the action is
  dangerous. A `maxPerFeature` cap exists; over 12 paired splits it produced **no significant
  difference** (paired t = −0.31, 6/12 wins), so it is **off by default**. Enabling it on the
  strength of a single lucky split is exactly the mistake this document exists to prevent.
- **Later boosting rounds amplify noise features.** On the fixture, AUC lands at ~0.77 where a
  near-ideal predictor could reach ~0.88, because rounds after the first pick up noise.
- **Calibration and threshold tuning did not help.** Platt scaling and MCC-optimal threshold
  selection (both fitted on the training fold only, `scripts/model-calibration.js`) improved
  MCC from 0.247 to 0.262 and ECE from 0.232 to 0.228 — **not significant** (paired t = −0.72).
  They are implemented and tested but **not wired into the hot path**, because shipping an
  unproven behaviour change into a live PreToolUse firewall is not justified by a
  non-significant gain.
- **`feedback-model.json` is absent on at least one machine**, so the Thompson-sampling
  reliability model has no posterior there.
- **Lesson retrieval is recency-truncated.** `lesson-retrieval.js` reads the memory log with
  `maxLines: 200` and `slice(-200)`, so with 383 lessons on disk roughly half are unreachable
  regardless of relevance — a recency window, not a relevance ranking.

## Running it

```sh
npm run eval:risk                                              # repo-local corpus
node scripts/eval-risk-model.js --corpus ~/.thumbgate/feedback-sequences.jsonl
node scripts/eval-risk-model.js --corpus <path> --compare-caps # paired config comparison
node scripts/eval-risk-model.js --corpus <path> --json         # machine-readable
```

`resolveFeedbackDir` prefers a repo-local `.thumbgate/` over the global one, so inside a
checkout the default corpus is the small fixture. Pass `--corpus` for the real thing.

## The rule this establishes

**No accuracy figure ships without the baseline it beats and the split it was measured on.**
An unqualified accuracy number is not a quality claim; it is a claim waiting to be checked.
