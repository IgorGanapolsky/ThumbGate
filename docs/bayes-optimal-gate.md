# Bayes-Optimal Gate

ThumbGate's pre-tool-use hook can now decide to block or allow a tool call
using a cost-weighted Bayes-optimal rule instead of a single global risk
threshold. This document explains the math, the configuration surface, and
how the new decision rule is wired in without regressing the legacy path.

## Why this exists

The legacy rule lived in `scripts/hook-pre-tool-use.js:maybeBlockOnRisk` and
boiled down to:

```
if any(tag.riskScore ≥ THUMBGATE_HOOKS_ENFORCE_THRESHOLD) → block
```

That rule cannot express two facts that matter in practice:

1. **Different tags carry different empirical harm rates.** A tag that
   historically produces thumbs-down feedback 85% of the time deserves more
   evidentiary weight than a tag that's been flagged once in ten attempts.
2. **Mis-classification is asymmetric.** Letting a harmful `deploy-prod`
   call through costs real hours of recovery and credibility. Briefly
   blocking a safe `lint` fix costs one explicit override flag. A single
   global threshold cannot reflect that asymmetry, and trying to encode it
   in the threshold alone pushes it to the wrong point for every other tag.

## The decision rule

For an observed tag set `T`, the Bayes-optimal classifier under an
asymmetric loss matrix is:

```
decision(T) = argmin_{a ∈ {allow, block}} E[loss | a, T]

E[loss | allow, T] = P(harmful | T) · cost(false_allow | T)
E[loss | block, T] = P(safe    | T) · cost(false_block | T)
```

Block iff `E[loss | allow] > E[loss | block]`.

### Posterior `P(harmful | T)`

We compute it as a naïve-Bayes update over a starting probability:

1. **Seed.** If the trained scorer (`scripts/risk-scorer.js`) produced a
   direct `probability` for this row, start from it — it fuses many
   features. Otherwise start from the base rate.
2. **Evidence.** For each observed tag with a known empirical risk rate
   (`highRiskTags[i].riskRate` from `buildPatternSummary`), multiply the
   current odds by a Bayes factor `rate / prior`. Convert back to a
   probability.
3. **Clip.** Clip the Bayes factor to `[0.25, 4.0]`. Without this, a tag
   observed a single time as harmful produces a factor large enough to pin
   the posterior at 1.0 — one observation must not veto on its own.

### Cost resolution

`resolveCost(matrixSide, tags)` takes the **maximum** applicable cost
across all tags on the call. A single high-cost tag (`deploy-prod`,
`secrets`) dominates. This is deliberate: we want a risky tag in a bundle
of otherwise innocuous tags to still flip the decision.

## Configuration surface

`config/enforcement.json`:

```json
{
  "lossMatrix": {
    "falseAllow": {
      "default": 1.0,
      "deploy-prod": 100.0,
      "destructive": 50.0,
      "secrets": 1000.0,
      "force-push-main": 200.0,
      "data-loss": 500.0
    },
    "falseBlock": {
      "default": 1.0
    }
  },
  "bayesOptimalEnabled": true,
  "bayesPosteriorFloor": 0.05
}
```

**Enablement order of precedence:**

1. `THUMBGATE_HOOKS_BAYES_OPTIMAL=1` env var (any truthy value).
2. `bayesOptimalEnabled: true` in `config/enforcement.json`.
3. Otherwise, the legacy threshold rule runs.

The enforcement hook itself still requires `THUMBGATE_HOOKS_ENFORCE=1`.
Bayes-optimal only chooses _how_ the hook decides, not _whether_ it
enforces at all.

## Bayes error rate as a stopping rule

`gate-stats` now reports `bayesErrorRate` — the irreducible error floor of
the current feature set (tag signatures). The formatter annotates it:

- **< 2%** → scorer is near-optimal; add new features, don't tune thresholds.
- **2–10%** → modest headroom; threshold tuning may help.
- **≥ 10%** → the feature set cannot discriminate; add features (commit
  SHA, hot-path flag, author, recency).

This tells operators when threshold-tuning has paid out and when it's time
to engineer features instead.

## Thompson Sampling: exploit-mode counterpart

`scripts/thompson-sampling.js` keeps its `samplePosteriors()` for learning
mode (explicit exploration) and now also exports `argmaxPosteriors()` +
`pickBestCategory()` for production/exploit paths. Use:

- `samplePosteriors` in training / review loops.
- `argmaxPosteriors` / `pickBestCategory` on hot paths where we want the
  best-known arm now and explicit exploration is out of scope.

## Fail-open guarantees

The hook must never deadlock the agent. The Bayes layer:

- Returns `null` (defer to legacy rule) when the risk-scorer has no data,
  when `config/enforcement.json` is malformed, or when any helper throws.
- Keeps the legacy `maybeBlockOnRisk` path intact; Bayes-optimal runs
  _before_ it, and any failure transparently falls through.
- Never writes to the filesystem.

## Tests

- `tests/bayes-optimal-gate.test.js` — 37 tests covering the pure-function
  layer end-to-end (posterior math, cost resolution, decision rule, Bayes
  error rate, tag-signature bucketing).
- `tests/gate-stats.test.js` — 5 new tests asserting `bayesErrorRate` is
  emitted and correctly annotated by `formatStats`.
- `tests/thompson-sampling.test.js` — 7 new tests for `argmaxPosteriors`
  and `pickBestCategory` (determinism, tie-breaking, edge cases).
- `tests/enforcement-teeth.test.js` — continues to pass unchanged; the
  new Bayes path is wired in but off by default in that test harness.
