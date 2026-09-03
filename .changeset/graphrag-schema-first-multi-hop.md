---
"thumbgate": minor
---

feat(retrieval): steal GraphRAG — schema-first multi-hop recall over the lesson store

TheNewStack GraphRAG walkthrough (thenewstack.io/graphrag-multi-hop-reasoning-python):
basic vector RAG fails multi-hop questions; schema-first entity extraction plus
typed 1-hop traversal fixes it. Mapped onto the ThumbGate lesson store:

- canonical schema (6 entity types, 5 relation types); degenerate mentions
  ("Acme Corp" / "Acme Corporation" / "Ame") fold to one canonical node
- deterministic LLM-free graph build + traverseOneHop typed expansion
  (VectorCypherRetriever analog)
- ingestion budget guard (costs modeled, tagged modeled=true)
- dumpGraph: human-readable audit surface instead of floating-point arrays
