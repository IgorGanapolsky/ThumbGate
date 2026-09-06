# Synthetic customer panel — one decision

Not a digital twin of everyone. One monetizable decision, ranked interventions,
holdout evaluation. Inspired by Simile-style behavioral simulation (process
steal, not a product clone). Complementary to PR #3647's hypothesis gate.

## Decision

Which **public landing-page angle** ranks highest for **qualified install
intent** among operators who already clicked a ThumbGate surface?

| Field | Value |
| --- | --- |
| Population | Operators evaluating a local Pre-Action Check after a public click (ad, compare page, or pricing) |
| Intervention | Three existing public angles: cost-loop, preaction-block, proof-first |
| Outcome | `qualified_install_intent` — start `npx thumbgate doctor` / capture install email, **not** $499 Diagnostic checkout |
| Constraints | ECI pauses paid-pilot buyer outreach; do not promote Diagnostic. Heuristic scorer is not a trained model. No LLM until holdout gaps are measured. |
| Evaluation | Pairwise ranking agreement vs observed holdout labels. Simulated ranks stay `modeledNotMeasured` until that gate passes. |
| Live test | Recommend a 10–20% traffic split of the top two variants. Do not claim the split launched unless observations with `kind=observed` exist. |

## Why this decision

Public copy already exists (`/`, `/agents-cost-savings`, `/compare`). Ranking
those angles is cheaper than inventing a persona OS. Validation is ranking
direction, not prose plausibility.

## Honesty

- Personas encode **public** artifacts (landing H1s, GitHub issues, AGENTS.md
  claim contract). They are not measured sessions.
- Biases (skepticism, comparison shopping, time poverty) are explicit weights,
  not claimed observations.
- Output form: “Variant B is predicted for skeptical comparison shoppers
  because it reduces perceived risk; validate with a 10–20% traffic split.”
  Never “the agents say B wins.”
