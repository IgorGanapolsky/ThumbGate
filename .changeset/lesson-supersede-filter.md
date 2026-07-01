---
"thumbgate": patch
---

Add a retrieval-time superseding filter to lesson retrieval. Same-topic lessons are now collapsed before final selection: duplicates drop to the higher-ranked one, and contradictions (opposite signal on the same rule/topic) keep the most recent — which supersedes the stale one. This prevents "context poisoning," where an agent could be handed two contradictory lessons (e.g. "never force-push" and "force-push is fine") at equal relevance. Conservative by design (distinct lessons are never merged); affects only lesson retrieval, not the hard gate rules.
