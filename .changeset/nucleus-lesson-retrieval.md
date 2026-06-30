---
"thumbgate": patch
---

Add Memora-style nucleus (top-P) "decide when to stop" filtering to per-action lesson retrieval. Operators can set `THUMBGATE_RETRIEVAL_TOP_P` (or pass `options.topP`) to trim the low-relevance tail so a single dominant lesson isn't padded out to `maxResults` — fewer tokens stuffed into each PreToolUse warning and `retrieve_lessons` call. Off by default (`topP=1.0` is a no-op, so existing behaviour is unchanged). Also fixes the previously dead, mis-normalized `filterTopP` (now scale-free with a `minKeep` floor) and removes a duplicate `calculateRetrievalEntropy` definition.
