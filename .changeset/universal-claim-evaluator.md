---
"thumbgate": minor
---

Add a universal claim evaluator that parses factual free-text claims (row counts, file lines/bytes/existence, package versions), rechecks configured SQLite/filesystem/JSON verifiers, and fail-closes `verify_claim` / `require_evidence_for_claim` on mismatch or missing verifier.
