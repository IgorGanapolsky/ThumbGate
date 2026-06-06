---
"thumbgate": patch
---

Statusline now aggregates across every live `statusline_cache.json` so the displayed thumbs-up/down reflects the user's true totals instead of whichever folder happens to be cwd. On a host with multiple per-project caches the same product was previously showing 74% / 20% / 0% approval depending on cwd; the aggregated readout is the correct cross-folder total. Cache writes remain per-folder so attribution is preserved; opt out of aggregation with `THUMBGATE_STATUSLINE_AGGREGATE=0`.
