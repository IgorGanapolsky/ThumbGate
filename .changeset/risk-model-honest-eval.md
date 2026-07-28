---
thumbgate: minor
---

Measure the learned risk model honestly. Trained models now record held-out metrics
(precision/recall/F1/MCC/ROC-AUC/Brier/ECE) under both an IID split and a
distribution-shift split, each alongside the majority-class baseline it must beat —
replacing a lone in-sample accuracy that scored 0.820 against a 0.711 base rate. Adds
a repeated-resampling harness (`npm run eval:risk`) and a CI quality gate that fails
if the trainer stops learning planted signal or starts finding signal in pure noise.
