# Feature Research

**Domain:** ThumbGate Bidirectional Feature Sync (ML-enhanced feedback systems)
**Researched:** 2026-03-04
**Confidence:** HIGH (direct code inspection of both repos; confirmed feature presence/absence)

---

## Context: What Exists Where

This is not a greenfield project. Both repos are live systems. The sync is surgical:

| Feature | thumbgate | Subway_RN_Demo | Direction |
|---------|-------------------|----------------|-----------|
| Feedback capture + schema validation | YES | YES | Already synced |
| Prevention rules from failures | YES | YES | Already synced |
| Rubric-based scoring | YES | YES | Already synced |
| JSONL feedback storage | YES | YES | Already synced |
| CI pipeline with test gates | YES | YES | Already synced |
| Budget guard (monthly $USD cap) | YES | NO | -> Subway |
| Intent router + policy bundles | YES | NO | -> Subway |
| ContextFS with semantic cache | YES | NO | -> Subway |
| Self-healing monitor + auto-fix | YES | NO | -> Subway |
| Thompson Sampling posteriors (Beta-Bernoulli) | NO | YES | -> thumbgate |
| LanceDB vector storage | NO | YES | -> thumbgate |
| LSTM/Transformer sequence tracking | NO | YES | -> thumbgate |
| Diversity tracking (domain coverage) | NO | YES | -> thumbgate |
| RLAIF self-scoring (DPO batch optimization) | NO | YES | -> thumbgate |

---

## Feature Landscape

### Table Stakes (Users Expect These)

These are features that any ThumbGate sync system must have to be considered complete. Missing these makes the system feel broken or untrustworthy.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Feedback signal capture (thumbs up/down) | Core ThumbGate primitive — no feedback = no learning | LOW | Already in both repos via `feedback-loop.js` and `feedback-schema.js` |
| Schema validation on input | Invalid data corrupts model over time | LOW | Already in both repos via `feedback-schema.js` |
| JSONL persistent storage | Audit trail, reproducibility, ML training input | LOW | Already in both repos |
| Prevention rules from recurring failures | The output of learning must surface as actionable rules | MEDIUM | Already in both repos via `writePreventionRules()` |
| Rubric-based quality scoring | Scalar feedback insufficient — rubrics force structured evaluation | MEDIUM | Already in both repos via `rubric-engine.js` |
| CI test gates | Every sync must have tests; no unproven claims | LOW | Already in both repos |
| Budget enforcement | Cost spikes are catastrophic at $10/month cap | MEDIUM | Exists in `budget-guard.js` in thumbgate only |
| Feedback stats and summary API | Operators need visibility into what's been captured | LOW | Already in both repos via `/v1/feedback/stats` |

### Differentiators (Competitive Advantage)

These are the features that make this system significantly more capable than a basic feedback logger. Each has clear ML grounding.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Thompson Sampling posteriors (Beta-Bernoulli) | Turns raw feedback into per-category reliability estimates with Bayesian uncertainty quantification; enables exploration vs exploitation decisions | HIGH | Fully implemented in Subway via `train_from_feedback.py`; uses Beta(alpha, beta) per category; O(sqrt(T)) regret bound per arXiv:2505.23927 |
| Exponential time-decay on feedback | Recent mistakes matter more than old ones; half-life=7 days prevents stale data from polluting posteriors | MEDIUM | Implemented in Subway with configurable `HALF_LIFE_DAYS`; toggle between step-decay and exponential |
| LanceDB vector storage | Enables semantic similarity search over historical feedback; native FTS via DuckDB/Tantivy integration as of 2026 | HIGH | Subway has live `thumbgate_feedback.lance` table; LanceDB 0.26.1 installed in venv |
| Hybrid semantic search (BM25 + vector fusion) | Lexical + semantic retrieval beats either alone; handles cases where exact keywords appear in different wording | HIGH | Subway's `semantic-memory-v2.py` implements this pattern; LanceDB native FTS added Feb 2026 |
| LSTM/Transformer sequence tracking | Captures temporal patterns across N feedback interactions (window=10); enables sequence-level rather than point-level learning | HIGH | Subway's `capture-feedback.js` writes `feedback-sequences.jsonl`; identified as critical gap in thumbgate |
| Diversity tracking (domain coverage) | Prevents representation collapse — ensures feedback covers all domain categories, not just easy ones | MEDIUM | Subway has live `diversity-tracking.json` with `diversityScore` metric; 10 domain categories tracked |
| RLAIF self-scoring via DPO batch optimization | Builds (chosen, rejected) preference pairs from positive/negative feedback; applies DPO-style closed-form update without explicit reward model | HIGH | Subway's `train_from_feedback.py --dpo-train`; based on Rafailov et al. 2023 (arXiv:2305.18290); integrated with Thompson Sampling |
| Intent router + policy bundles | Structured governance for agentic actions — each intent has risk level (low/medium/high/critical), approval requirements, and allowed actions | MEDIUM | Fully in thumbgate via `intent-router.js` and `config/policy-bundles/*.json`; not in Subway |
| ContextFS with semantic cache | Persistent, file-system-native context store with TTL-aware semantic similarity matching (Jaccard tokenization, threshold=0.7); avoids re-computing identical context packs | MEDIUM | Fully in thumbgate via `contextfs.js`; 5 namespaces (raw_history, memory/error, memory/learning, rules, tools, provenance) |
| Self-healing monitor + auto-fix workflows | System detects its own CI failures and runs fix scripts automatically; generates health report with per-check status | MEDIUM | thumbgate has `self-heal.js` + `self-healing-check.js`; runs lint:fix, format, fix, feedback:rules scripts |
| MCP profile-based tool allowlisting | Limits which tools subagents can use based on named profiles; prevents privilege escalation | MEDIUM | thumbgate has `mcp-policy.js` with `mcp-allowlists.json`; not in Subway |
| DPO pair export for ML training | Produces structured JSONL preference pairs consumable by any DPO training pipeline | MEDIUM | thumbgate has `export-dpo-pairs.js` and `/v1/dpo/export` endpoint |
| Meta-policy rules with trend analysis | Extracts reusable rules from repeated negative feedback patterns; tracks trend (improving/deteriorating/stable) per category | HIGH | Subway's `train_from_feedback.py --extract-rules`; based on Meta-Policy Reflexion arXiv:2509.03990 |
| Model snapshot for lift comparison | Before/after snapshots enable measuring whether a sync actually improved reliability (lift-gate: >=5% required) | LOW | Subway's `save_snapshot()` and `skill_eval.py --lift --gate` |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Multi-adapter pattern for Subway | "One codebase, many providers" sounds good | Subway only uses Claude; adding 4 adapters adds dead code, test burden, and drift risk | Explicitly out of scope per PROJECT.md — Subway stays Claude-only |
| Full repo merge into one codebase | Simpler to maintain one repo | Repos serve different purposes: thumbgate is a productized library, Subway_RN_Demo is an app-level prototype | Cherry-pick sync is the right model; merging destroys the product/prototype boundary |
| Real-time streaming feedback aggregation | Lower latency sounds better | JSONL append is atomic and crash-safe; streaming adds complexity without benefit at this scale | Keep JSONL append model; add batch processing for ML (DPO pairs) |
| External database (PostgreSQL, Redis) for feedback | "Scale to production" | $10/month budget constraint makes external infra risky; LanceDB and file-based JSONL work offline and cost $0 | LanceDB embedded + JSONL; upgrade path exists when budget allows |
| PaperBanana PNG architecture diagrams | Visual documentation is valuable | Blocked on Gemini API quota; explicitly out of scope per PROJECT.md | Mermaid diagrams sufficient; already flagged as out of scope |
| Automatic feedback capture without user signal | "Always on" learning is better | Silent capture violates the explicit feedback contract; captures noise, not signal | Require explicit thumbs up/down; enrich with context automatically |
| Reward model fine-tuning with API calls | "True ThumbGate" | At $10/month, API calls for reward model training are budget-prohibitive | Use local Thompson Sampling + DPO pair construction instead; RLAIF avoids paid inference |
| Cross-repo shared database | One source of truth for both repos | Creates tight coupling between a library and a prototype; CI failures in one break the other | Sync features via code, not shared state |

---

## Feature Dependencies

```
[Feedback Capture]
    └──requires──> [Schema Validation]
    └──requires──> [JSONL Storage]
                       └──feeds──> [Thompson Sampling Posteriors]
                       └──feeds──> [LSTM Sequence Tracking]
                       └──feeds──> [DPO Pair Export]
                       └──feeds──> [Diversity Tracking]
                       └──feeds──> [Prevention Rules]

[Thompson Sampling Posteriors]
    └──enhances──> [RLAIF Self-Scoring (DPO batch)]
    └──feeds──> [Meta-Policy Rules]
    └──feeds──> [Model Snapshot / Lift Gate]

[LanceDB Vector Storage]
    └──enables──> [Hybrid Semantic Search (BM25 + vector)]
    └──enables──> [Agentic Memory Evolution]

[ContextFS]
    └──requires──> [JSONL Storage] (reads from same feedback dirs)
    └──uses──> [Semantic Cache] (Jaccard similarity, TTL)
    └──feeds──> [Context Pack Evaluation] (provenance loop)

[Intent Router]
    └──requires──> [Policy Bundles] (JSON config files)
    └──requires──> [MCP Policy] (profile allowlists)
    └──integrates-with──> [Budget Guard] (cost enforcement before action)

[Self-Healing Monitor]
    └──requires──> [CI Test Gates] (knows what healthy looks like)
    └──uses──> [Budget Guard] (checks budget:status as one of its health checks)

[Budget Guard]
    └──independent──> (no dependencies — file-lock ledger, standalone)

[Rubric Engine]
    └──feeds──> [Context Pack Evaluation] (rubricEvaluation attached to pack outcomes)
    └──feeds──> [Feedback Capture] (rubricScores field in capture payload)
```

### Dependency Notes

- **Thompson Sampling requires JSONL Storage:** posteriors are rebuilt from the JSONL log; no log = no model
- **RLAIF/DPO enhances Thompson Sampling:** DPO adjusts alpha/beta priors based on preference pairs; Thompson Sampling is the online component, DPO is the batch component
- **LanceDB enables hybrid search:** without vector embeddings, search falls back to keyword-only (less accurate)
- **Intent Router conflicts with unconstrained agentic execution:** once intent router is in Subway, all high/critical risk actions will require approval — this is intentional governance, not a blocker
- **ContextFS and LanceDB are parallel, not dependent:** ContextFS uses file-system JSON with Jaccard similarity; LanceDB uses dense vector embeddings; they solve the same retrieval problem differently

---

## MVP Definition

This is a sync milestone, not a greenfield MVP. "MVP" here means minimum viable sync — the features that must land first because others depend on them.

### Sync Phase 1 — ML Features Into thumbgate (v1)

These land first because they are self-contained and have no dependencies on governance features:

- [ ] **Thompson Sampling posteriors** — Core ML upgrade; enables per-category reliability estimation; prerequisite for RLAIF/DPO
- [ ] **Exponential time-decay on feedback** — Pairs with Thompson Sampling; without it, old data pollutes posteriors indefinitely
- [ ] **Diversity tracking** — Lightweight JSON; prevents representation collapse; easy win with high signal value
- [ ] **LSTM/Transformer sequence tracking** — Adds `feedback-sequences.jsonl` output; enables future sequence-level ML training

### Sync Phase 2 — ML Features Continued (v1.x)

After Phase 1 tests pass and CI is green:

- [ ] **LanceDB vector storage** — Requires Python venv setup and embedding model; higher complexity; unlocks hybrid search
- [ ] **RLAIF self-scoring / DPO batch optimization** — Depends on Thompson Sampling landing first; applies preference pair updates on top of posterior

### Sync Phase 3 — Governance Features Into Subway (v1.x)

After Phase 1 is stable; these are independent of ML features:

- [ ] **Budget guard** — Standalone; no dependencies; highest urgency because it prevents cost blowouts
- [ ] **Intent router + policy bundles** — Depends on MCP policy profile config existing in Subway
- [ ] **ContextFS with semantic cache** — Requires feedback directory structure; medium complexity
- [ ] **Self-healing monitor + auto-fix** — Depends on existing npm scripts in Subway's package.json

### Future Consideration (v2+)

Defer until Phase 1-3 are stable and verified:

- [ ] **Agentic memory evolution (A-Mem pattern)** — Subway has this in `agentic-memory.py`; rich but complex; not in sync scope yet
- [ ] **Skill quality tracker with lift gate** — Subway has `skill_eval.py`; requires established model snapshots to compare against
- [ ] **Meta-policy rules with trend analysis** — High value but depends on DPO model being stable first
- [ ] **Cohere rerank integration** — Used in Subway's enhanced RAG; requires external API; deferred due to budget constraint

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Thompson Sampling posteriors | HIGH — directly improves learning signal quality | MEDIUM — Python port or JS implementation | P1 |
| Exponential time-decay | HIGH — prevents posterior poisoning from stale data | LOW — config change + math | P1 |
| Budget guard into Subway | HIGH — prevents surprise bills | LOW — copy `budget-guard.js` + tests | P1 |
| Diversity tracking | HIGH — ensures balanced learning | LOW — JSON tracker + domain categories | P1 |
| LSTM sequence tracking | MEDIUM — enables future sequence-level training | LOW — adds `feedback-sequences.jsonl` writer | P1 |
| Intent router + policy bundles | HIGH — governance without it is ad hoc | MEDIUM — copy files + integrate with Subway's flow | P2 |
| ContextFS + semantic cache | HIGH — reduces redundant context construction | MEDIUM — file structure + Jaccard similarity logic | P2 |
| Self-healing monitor | MEDIUM — reduces manual CI fix cycles | MEDIUM — health check runner + fix plan | P2 |
| LanceDB vector storage | HIGH — semantic retrieval >> keyword | HIGH — venv, embeddings, schema migration | P2 |
| RLAIF/DPO batch optimization | HIGH — batch preference learning without reward model | HIGH — preference pair builder + DPO math | P2 |
| Meta-policy rules | MEDIUM — useful but requires stable base first | HIGH — depends on DPO model convergence | P3 |
| Skill quality tracker + lift gate | MEDIUM — model evaluation discipline | HIGH — depends on model snapshots existing | P3 |

**Priority key:**
- P1: Must have for this milestone — lands in first sync wave
- P2: Should have — lands after P1 tests pass
- P3: Nice to have — future milestone consideration

---

## Ecosystem Benchmarks

### Thompson Sampling in ThumbGate (2026 Research)

Research published May 2025 (arXiv:2505.23927) provides O(sqrt(T)) regret bounds for model-free posterior sampling in online ThumbGate, confirming Thompson Sampling is theoretically sound for this use case. The Beta-Bernoulli implementation in Subway aligns with established practice for Bernoulli reward signals.

### LanceDB State (2026)

LanceDB kicked off 2026 with Lance-native SQL retrieval via DuckDB, Uber-scale multi-bucket storage, and 1.5M IOPS benchmarks. Subway uses version 0.26.1 with native FTS index. The embedded model is the right choice for this budget — no external service required.

### RLAIF vs ThumbGate (Current)

RLAIF (AI feedback replacing human judges) is validated at scale — RLAIF vs ThumbGate paper showed comparable performance at lower cost. The DPO batch optimization in Subway (Rafailov et al. 2023) avoids an explicit reward model entirely, using preference pairs from existing positive/negative feedback. This is the correct approach for a $10/month budget.

### Sequence-to-Sequence Reward Modeling

AAAI 2025 research on seq2seq reward modeling shows language feedback (sequence) outperforms scalar feedback for ThumbGate without additional annotations — achieving 76.9% win rate on NLP tasks. This validates the LSTM/sequence tracking investment as future training data.

---

## Sources

- Direct code inspection: `/Users/ganapolsky_i/workspace/git/igor/ThumbGate/scripts/` (budget-guard.js, contextfs.js, intent-router.js, self-heal.js, self-healing-check.js, rubric-engine.js, mcp-policy.js) — HIGH confidence
- Direct code inspection: `/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/train_from_feedback.py` (Thompson Sampling, DPO, meta-policy rules) — HIGH confidence
- Direct code inspection: `/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/capture-feedback.js` (sequence tracking, diversity tracking, LanceDB) — HIGH confidence
- Direct data inspection: `/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/memory/feedback/diversity-tracking.json` (live diversity score 76.2%) — HIGH confidence
- PROJECT.md constraints: out-of-scope items confirmed by document — HIGH confidence
- arXiv:2505.23927 — Thompson Sampling in Online ThumbGate with General Function Approximation (2025) — MEDIUM confidence
- arXiv:2305.18290 — Rafailov et al. DPO: Direct Preference Optimization — HIGH confidence (foundational paper)
- arXiv:2509.03990 — Meta-Policy Reflexion (referenced directly in Subway code comments) — MEDIUM confidence
- LanceDB official site: https://lancedb.com — 2026 updates confirmed — MEDIUM confidence
- RLAIF vs ThumbGate: arXiv:2309.00267 — MEDIUM confidence
- Sequence-to-Sequence Reward Modeling: AAAI 2025 — https://ojs.aaai.org/index.php/AAAI/article/view/34992 — MEDIUM confidence

---

*Feature research for: ThumbGate Bidirectional Feature Sync*
*Researched: 2026-03-04*
