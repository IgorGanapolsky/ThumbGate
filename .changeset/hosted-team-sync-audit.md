---
"thumbgate": minor
---

Add hosted Team lesson sync and shared audit trail endpoints, plus `thumbgate team-sync --hosted` for Pro/Team users to push local lessons and sanitized audit decisions into a customer-scoped hosted namespace and pull shared lessons back into local agent memory.

Also adds admin-only registration for already-issued manual Pro keys so customer keys created outside checkout can be recognized by hosted Team features without echoing secrets in API responses.
