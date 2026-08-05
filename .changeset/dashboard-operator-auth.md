---
"thumbgate": patch
---

Allow operator key to read hosted dashboard JSON used by CLI.

`thumbgate dashboard` and north-star call `GET /v1/dashboard` with the operator
key from `~/.config/thumbgate/operator.json`. The general API gate only allowed
operator GET on `/v1/billing/summary` (and a few other paths), so a valid
operator key still returned HTTP 401 with a misleading "key does not match"
message.

Expand the read-only operator allowlist for dashboard GET routes
(`/v1/dashboard`, render-spec, ai-inventory, review-state). Keep write/mutation
surfaces admin-only.
