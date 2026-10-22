---
"thumbgate": minor
---

Add Dream Mode memory consolidation engine (Anthropic Auto Dream inspired) and CUDA-inspired parallel gate batch evaluation. Dream Mode provides 4-phase memory consolidation (orientation → gather signal → consolidation → prune & index) with read-only safety boundary and dual-gate triggering (24h + 5 sessions). CUDA Gate Batch maps the CUDA thread/memory hierarchy (grid → blocks → threads, global/shared/thread-local memory) onto ThumbGate's PreToolUse gate pipeline for sub-0.5ms parallel evaluation with hot-cache acceleration.
