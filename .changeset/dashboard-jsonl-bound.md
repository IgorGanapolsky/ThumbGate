---
"thumbgate": patch
---

Bound dashboard JSONL reads so hosted `/v1/dashboard` survives large prod logs.

`readJSONL` loaded entire feedback/memory files into one string, which throws
V8's max-string error on oversized Railway volumes and returned HTTP 400 with
a misleading "Invalid dashboard query" title after operator auth was fixed.
Tail-cap reads (32 MiB / 100k lines) and map size/heap failures to HTTP 503.

Also add CLI progress feedback for `thumbgate dashboard` (spinner/step lines)
so long hosted fetches and local fallbacks are not silent.
