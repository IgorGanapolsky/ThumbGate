# Requirements: RLHF Bidirectional Feature Sync

**Defined:** 2026-03-04
**Core Value:** Every synced feature has tests, passes CI, and produces verification evidence — no tech debt

## v1 Requirements

### Contract Alignment

- [x] **CNTR-01**: Export mapping audit confirms all shared function names are compatible between repos
- [x] **CNTR-02**: Schema divergence resolved — rubricEvaluation parameter handled consistently
- [x] **CNTR-03**: Timestamp format normalized (ISO 8601 with Z suffix) across both repos

### ML into rlhf-feedback-loop

- [x] **ML-01**: Thompson Sampling Beta-Bernoulli posteriors compute per-category reliability estimates
- [x] **ML-02**: Exponential time-decay (half-life 7 days) weights recent feedback higher
- [x] **ML-03**: LSTM/Transformer sequence tracking writes feedback-sequences.jsonl with sliding window of N=10
- [x] **ML-04**: Diversity tracking produces per-domain coverage scores and diversityScore metric
- [x] **ML-05**: All ML features have unit tests proving correct behavior
- [x] **ML-06**: Proof report generated in proof/ directory for ML features

### Governance into Subway

- [x] **GOV-01**: Budget guard enforces $10/month cap with atomic ledger in Subway
- [x] **GOV-02**: Intent router with policy bundles provides risk-stratified action planning in Subway
- [x] **GOV-03**: ContextFS with semantic cache (Jaccard, threshold=0.7, TTL=86400s) operates in Subway
- [x] **GOV-04**: Self-healing monitor detects CI failures and runs fix scripts in Subway
- [x] **GOV-05**: All governance features have unit tests proving correct behavior
- [x] **GOV-06**: Proof report generated in proof/ directory for governance features

### LanceDB Vector Storage

- [x] **VEC-01**: LanceDB embedded table stores feedback vectors in rlhf-feedback-loop
- [x] **VEC-02**: ESM/CJS compatibility resolved via dynamic import pattern
- [x] **VEC-03**: apache-arrow pinned to compatible version (<=18.1.0)
- [ ] **VEC-04**: Semantic similarity search returns relevant historical feedback
- [ ] **VEC-05**: LanceDB integration has tests and proof report

### RLAIF and DPO Optimization

- [ ] **DPO-01**: RLAIF self-scoring grades feedback against CLAUDE.md constraints
- [ ] **DPO-02**: DPO batch optimization builds preference pairs from Thompson Sampling posteriors
- [ ] **DPO-03**: Meta-policy rule extraction produces actionable rules from feedback trends
- [ ] **DPO-04**: All RLAIF features have tests and proof report

## v2 Requirements

### Advanced ML

- **ADV-01**: Hybrid semantic search (BM25 + vector fusion) for feedback retrieval
- **ADV-02**: Model snapshot lift comparison (>=5% improvement gate)
- **ADV-03**: Agentic memory evolution (A-Mem Zettelkasten pattern)

### Cross-Platform

- **XPLAT-01**: MCP profile-based tool allowlisting in Subway
- **XPLAT-02**: Subagent profile isolation in Subway

## Out of Scope

| Feature | Reason |
|---------|--------|
| Multi-adapter pattern for Subway | Subway only uses Claude; dead code burden |
| Full repo merge | Repos serve different purposes (product vs app) |
| External database (PostgreSQL, Redis) | $10/month budget; LanceDB + JSONL cost $0 |
| PaperBanana PNG diagrams | Blocked on Gemini API quota; Mermaid sufficient |
| Real-time streaming aggregation | JSONL append is atomic and sufficient at scale |
| Reward model fine-tuning via API | Budget-prohibitive; Thompson Sampling + DPO is local |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CNTR-01 | Phase 1: Contract Alignment | Complete |
| CNTR-02 | Phase 1: Contract Alignment | Complete |
| CNTR-03 | Phase 1: Contract Alignment | Complete |
| ML-01 | Phase 2: ML into rlhf-feedback-loop | Complete |
| ML-02 | Phase 2: ML into rlhf-feedback-loop | Complete |
| ML-03 | Phase 2: ML into rlhf-feedback-loop | Complete |
| ML-04 | Phase 2: ML into rlhf-feedback-loop | Complete |
| ML-05 | Phase 2: ML into rlhf-feedback-loop | Complete |
| ML-06 | Phase 2: ML into rlhf-feedback-loop | Complete |
| GOV-01 | Phase 3: Governance into Subway | Complete |
| GOV-02 | Phase 3: Governance into Subway | Complete |
| GOV-03 | Phase 3: Governance into Subway | Complete |
| GOV-04 | Phase 3: Governance into Subway | Complete |
| GOV-05 | Phase 3: Governance into Subway | Complete |
| GOV-06 | Phase 3: Governance into Subway | Complete |
| VEC-01 | Phase 4: LanceDB Vector Storage | Complete |
| VEC-02 | Phase 4: LanceDB Vector Storage | Complete |
| VEC-03 | Phase 4: LanceDB Vector Storage | Complete |
| VEC-04 | Phase 4: LanceDB Vector Storage | Pending |
| VEC-05 | Phase 4: LanceDB Vector Storage | Pending |
| DPO-01 | Phase 5: RLAIF and DPO Optimization | Pending |
| DPO-02 | Phase 5: RLAIF and DPO Optimization | Pending |
| DPO-03 | Phase 5: RLAIF and DPO Optimization | Pending |
| DPO-04 | Phase 5: RLAIF and DPO Optimization | Pending |

**Coverage:**
- v1 requirements: 24 total
- Mapped to phases: 24
- Unmapped: 0

---
*Requirements defined: 2026-03-04*
*Last updated: 2026-03-04 after roadmap creation*
