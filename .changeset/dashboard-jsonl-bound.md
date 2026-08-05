---
"thumbgate": patch
---

Bound dashboard JSONL reads, CLI progress for operator commands, and pack the
runtime helpers the published CLI/server actually need.

- Tail-cap feedback/memory JSONL so hosted `/v1/dashboard` survives large volumes
- Map size/heap failures to HTTP 503 instead of misleading 400 invalid-query
- Spinner/step progress for `thumbgate dashboard`, `cfo`, and `north-star`
- Ship `cli-progress` + `dashboard-limits` in the npm pack (ceiling 423)

Also publish a GEO learn page mapping the Hugging Face Context Course to
ThumbGate hooks (repo deploy surface; not npm-packed under public/learn/).
