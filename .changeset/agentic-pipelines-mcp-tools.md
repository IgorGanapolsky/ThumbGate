---
"thumbgate": patch
---

Expose the agentic prompt pipelines as MCP tools: `graphrag_traverse` (schema-first, read-only Neo4j ReAct loop; reports `unavailable` without NEO4J_URI, neo4j-driver or model credentials), `route_workload` (Claude/Gemini routing decision) and `trim_context` (just-in-time context compaction). Routing and trimming stay deterministic unless `useModel` is true.
