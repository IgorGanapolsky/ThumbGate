# Cache Engineering: Rolling-Drop Context (27.7% Cost Reduction)

## Steal Source
arXiv:2610.28577 "Cache Engineering for Agents" (Oct 2026)

## Problem
As agent trajectories grow, KV cache I/O becomes the dominant cost. Simply summarizing/trimming old context invalidates cached states and triggers costly re-prefilling.

## Pattern Stolen
**Tool-response rolling-drop**: Keep only the N most recent tool-response entries in active context. Archive older entries to a persistent store. This avoids re-prefill costs while maintaining accuracy.

**History-dependent cache state**: Identical token sequences yield different cache states under different operation sequences — so cache keys must account for the operation sequence, not just content hash.

## How ThumbGate Applies It
- `scripts/contextfs.js` — `constructContextPack` implements rolling selection: keeps top-N relevant items by score, not all items
- `asyncExecution` config — `maxConcurrency: 5` bounds parallel cache access
- Cache key includes `sourceHash` (from `getSourceHash`) which captures the operation sequence

## Implementation
- `context/verifier-criteria.json` — `asyncExecution.independentChecks` array defines which checks participate in the rolling cache
- `scripts/contextfs.js` — `selectFlatContextItems` enforces `maxItems` and `maxChars` budgets

## Pro Value
Pro adds:
- Multi-tier cache (hot L1, warm L2, cold SQLite archive)
- Adaptive drop policies (learns which context blocks to drop based on retrieval success)
- Cross-session cache reuse with operation-sequence fingerprinting

**Steal command**: `npx thumbgate init` → select "rolling-cache-pack"
