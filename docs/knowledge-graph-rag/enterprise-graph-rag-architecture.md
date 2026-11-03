# Enterprise Knowledge Graph RAG (GraphRAG) Architecture & ThumbGate Integration

## 1. Architectural Blueprint (Synthesized from Enterprise AI Knowledge Graph RAG Playbook)
1. **Scope to High-Friction Multi-Hop Questions:**
   - Instead of boiling the ocean, focus our graph ontology strictly on multi-hop questions (e.g., cross-referencing agent tool execution logs, financial ledger events, and agent permissions).
2. **Bounded Domain Ontology:**
   - Define strict entity classes, directional typed relationships, cardinality constraints, and standardized business definitions.
3. **Schema-Guided Entity Extraction & Resolution:**
   - Constrain LLM extraction to defined classes and deduplicate IDs into canonical nodes.
4. **Hybrid Retrieval Architecture:**
   - Combine Standard Vector Retrieval, Local Graph Retrieval, Multi-Hop Hybrid Retrieval, and Global Community Summaries.
5. **Intelligent Query Routing Layer:**
   - Classify queries to route simple lookups to vector search and complex multi-hop queries to graph traversal.
6. **Security & Text-to-Cypher Validation:**
   - Enforce read-only roles, schema validation before query execution, and data-layer permissions.
7. **Temporal Integrity via CDC:**
   - Track incremental changes with `valid_from` and `valid_to` edge timestamps.
8. **Hard ROI Metrics:**
   - Track Faithfulness, Citation Accuracy, and Constraint Violation Rate.

## 2. Integration into ThumbGate & Fleet Systems
- **ThumbGate Guardrails:** Embed ontology schema validation directly into `workflow_sentinel` and `gate_check` to prevent unauthorized or invalid graph traversal queries.
- **Dayglass & Foresight Knowledge Integration:** Enhance on-device SQLite Knowledge Graph and vector search with local graph traversal to power instant pre-meeting briefings and decision governance.

