---
thumbgate: minor
---

Fix lesson retrieval silently ignoring relevance past 200 entries. Retrieval read only
the newest 200 lines of the memory log, so the best-matching lesson in the corpus became
unreachable once 200 newer entries existed — measured cliff at exactly 201. The cap is now
5,000 (configurable via THUMBGATE_RETRIEVAL_MAX_LINES), which measurement shows costs
nothing: worst-case retrieval is 2.6 ms/call at both 200 and 5,000 entries.
