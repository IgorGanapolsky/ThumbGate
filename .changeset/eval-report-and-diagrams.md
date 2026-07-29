---
thumbgate: patch
---

Back the public /evaluations page with verifiable artifacts: the machine-readable
risk-model report (evals/risk-model-report.json, with provenance) is checked in and
linked from the page, the route gets a regression test that boots the real server, and
docs/ML-EVALUATION.md gains three mermaid diagrams (eval pipeline, enforcement loop,
lift chart).
