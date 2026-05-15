---
"thumbgate": minor
---

Add `scripts/eval_gate_classifier.py` — the first end-to-end ML pipeline in the repo. Loads `.thumbgate/feedback-log.jsonl`, builds features (TF-IDF on context + bag-of-tags + bag-of-categories), stratified train/test split, fits `LogisticRegression(class_weight='balanced')`, scores precision/recall/F1 (per-class + macro), ROC-AUC, PR-AUC, and full `classification_report`, then serializes the fitted pipeline with `joblib.dump` and writes a metrics card to `<feedback-dir>/eval/`. Run via `npm run eval:classifier`. sklearn / joblib / scipy are intentionally NOT runtime deps of the npm package — install via `pip install scikit-learn joblib` to enable. Pinned by `tests/eval-gate-classifier.test.js` (skips gracefully if sklearn isn't installed in CI).
