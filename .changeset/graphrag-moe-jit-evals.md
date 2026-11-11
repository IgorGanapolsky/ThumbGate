---
"thumbgate": patch
---

Add the `evals/graphrag-moe-jit` eval: the existing GraphRAG ReAct loop, Claude/Gemini router and JIT context trimmer run with a schema-first Cypher gate and the stdio MCP `gate_check` in front of every graph query. Registers `npm run test:graphrag-moe-jit-evals`; no change to the published package contents.
