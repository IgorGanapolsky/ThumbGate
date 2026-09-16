---
'thumbgate': patch
---

Steal CobbleDB's three-plane hot-store FORMAT (durable state, batched delivery, query-time MultiGet + hedge + subset) onto existing lesson rails via `cobble-hot-store-split`. Compare-not-clone: no RocksDB/YTsaurus SKU.
