---
"thumbgate": patch
---

Authenticated database reads no longer get a hard deny by default. When a secret environment variable is only the request's credential (`curl -H "Authorization: Bearer $ACCESS_TOKEN" https://…/rest/v1/orders`, `-u "app:$DB_PASSWORD"`, a literal SQL-over-HTTP query body) the secret-exfiltration gate now warns instead of denying, and `PGPASSWORD="$DB_PASSWORD" psql …` (a variable, not a pasted password) warns instead of denying. `THUMBGATE_STRICT_ENFORCEMENT=1` keeps the old deny. A secret in the body, URL or any other header, an `@file` body, a form or upload, PUT/PATCH/DELETE, command substitution, a pipe into another network tool, and literal database passwords stay denied in every mode. Synthetic fixtures in `tests/db-read-precision.test.js`.
