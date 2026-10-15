---
'thumbgate': patch
---

Add Hotdata DB vector store adapter (`adapters/hotdata/`) and `THUMBGATE_VECTOR_BACKEND=hotdata` swap for LanceDB in `scripts/vector-store.js`, pairing Hotdata's Apache DataFusion / Arrow `vector_search` with ThumbGate's <0.1ms `PreToolUse` loop and write-boundary diodes.
