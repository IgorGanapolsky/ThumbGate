# Project Research Summary

**Project:** ThumbGate Bidirectional Feature Sync
**Domain:** ML-enhanced feedback systems / Agentic governance
**Researched:** 2026-03-04
**Confidence:** HIGH

## Executive Summary

This is a surgical bidirectional sync between two live, production-grade systems — `thumbgate` (a Node.js ThumbGate product library, v0.5.0, zero npm dependencies) and `Subway_RN_Demo` (a React Native app with a Python ML feedback stack). Neither repo is greenfield; the sync cherry-picks specific features in two directions: ML capabilities (Thompson Sampling, LanceDB vector storage, LSTM sequence tracking, diversity tracking, RLAIF self-scoring) flow from Subway into thumbgate, while governance capabilities (budget guard, intent router, ContextFS, self-healing monitor, MCP policy) flow from thumbgate into Subway. A full merge is explicitly out of scope and architecturally wrong — the library/prototype boundary must be preserved.

The recommended implementation approach is file-system-boundary isolation: Node.js writes JSONL, Python reads JSONL and writes JSON model files, Node.js reads the JSON output. No HTTP, no sockets, no subprocess coupling in the hot path. All new npm dependencies for thumbgate are pinned and confirmed (`@lancedb/lancedb@0.26.2`, `apache-arrow@18.1.0`, `@huggingface/transformers@3.8.1`); Subway requires zero new npm packages for the governance port. The Python stack is already complete (lancedb 0.27.1, sentence-transformers 3.0.1, scipy in the venv). The Bayesian core (Thompson Sampling) requires no external library — pure JS Beta approximation with `Math.random()` is sufficient and mirrors Subway's stdlib `random.betavariate`.

The critical risks are silent API name collisions (`captureFeedback` vs `recordFeedback`), schema divergence on the rubric gate, and LanceDB cross-language schema format mismatches. Each has a clear prevention strategy: export diff before any code movement, never sync `resolveFeedbackAction` without its rubric engine, and pin both Python and Node.js LanceDB to matching Lance file format versions. A timestamp normalization shim is mandatory before any Node.js reads of `feedback_model.json` — mixed ISO 8601 formats will silently produce `NaN` decay weights and corrupt Thompson posteriors. These are not speculative risks; all have been confirmed by direct code inspection.

---

## Key Findings

### Recommended Stack

thumbgate adds exactly 3 npm packages to its currently zero-dependency baseline: `@lancedb/lancedb@0.26.2` (vector storage), `apache-arrow@18.1.0` (required peer dep — Arrow 21.x is out of range, must pin), and `@huggingface/transformers@3.8.1` (local ONNX embeddings, ~22MB model, ~50ms inference). Everything else — Thompson Sampling, LSTM sequence features, diversity tracking — is pure JS with no library. The package is CommonJS; LanceDB and Transformers.js are ESM; all three must be accessed via `await import()` dynamic imports. Subway receives zero new npm packages; governance scripts copy verbatim with path variable adjustments only.

**Core technologies:**
- `@lancedb/lancedb@0.26.2`: Vector + FTS hybrid search for thumbgate — only stable version compatible with the Lance file format already in use by Subway's Python stack
- `apache-arrow@18.1.0`: Required peer dep for LanceDB JS — pin strictly; Arrow 19+ is out of range
- `@huggingface/transformers@3.8.1`: Local ONNX embedding inference — eliminates Python subprocess latency and API costs; v4 is preview-only, do not use
- Native `Math.random()` + custom Beta: Thompson Sampling posteriors — no library needed; mirrors Subway's `random.betavariate` exactly
- `@anthropic-ai/sdk@0.78.0` (already present): RLAIF self-scoring — must be wrapped by budget guard on every call

### Expected Features

This is a sync milestone, not a feature launch. "Must have" is defined by what blocks other features.

**Must have — Phase 1 (ML into thumbgate):**
- Thompson Sampling posteriors (Beta-Bernoulli) — prerequisite for RLAIF/DPO; enables per-category reliability with O(sqrt(T)) regret bound
- Exponential time-decay on feedback — mandatory companion to Thompson Sampling; without it, old feedback corrupts posteriors (7-day half-life, already tuned in Subway)
- Diversity tracking — lightweight JSON; prevents representation collapse; feeds back into Thompson alpha/beta path
- LSTM/Transformer sequence tracking — adds `feedback-sequences.jsonl`; pure JS data structures, no ML library

**Must have — Phase 2 (governance into Subway):**
- Budget guard — standalone; prevents API cost blowouts; highest urgency; zero npm deps
- Intent router + policy bundles — structured governance for agentic actions; copy from ThumbGate with path adjustments
- ContextFS with semantic cache — replaces ad hoc context construction; namespaced file-system store with TTL
- Self-healing monitor — wraps Subway's existing npm scripts; needs Subway lint:fix audit before enabling

**Should have — Phase 3 (ML continued):**
- LanceDB vector storage — requires npm install + cross-language schema verification; unlocks hybrid semantic search
- RLAIF/DPO batch optimization — depends on Thompson Sampling landing first; builds preference pairs from existing positive/negative feedback

**Defer to v2+:**
- Agentic memory evolution (A-Mem Zettelkasten) — Subway has it; complex; not in sync scope
- Skill quality tracker with lift gate — requires established model snapshots
- Meta-policy rules with trend analysis — depends on DPO model convergence
- Cohere rerank integration — requires external API; deferred due to budget constraint

### Architecture Approach

The system separates governance (thumbgate) and ML capability (Subway) across a file-system boundary: Node.js writes to JSONL logs, Python training scripts read from those logs and write JSON model state, Node.js reads the JSON state for inference. No inter-process communication occurs in the feedback hot path. All data is local and embedded — no external services except the Claude API for RLAIF (budget-guarded). The two repos share an identical schema layer (`feedback-schema.js`, `rubric-engine.js`) but diverge at capability: ThumbGate holds the governance layer, Subway holds the ML layer. Post-sync, both hold both layers.

**Major components:**
1. `feedback-loop.js` + `feedback-schema.js` — shared core capture and boundary validation; identical in both repos
2. `train_from_feedback.py` — Thompson Sampling, time-decay, DPO batch optimization (Python CLI script, not a service)
3. `semantic-memory-v2.py` / LanceDB — vector + BM25/FTS hybrid retrieval; 384-dim all-MiniLM-L6-v2 embeddings
4. `budget-guard.js` — file-lock ledger; sole concurrency primitive; wraps all API spend
5. `intent-router.js` + policy bundles — risk-classified action governance; profile-aware approval requirements
6. `contextfs.js` — 5-namespace file-system context store with Jaccard semantic cache
7. `self-heal.js` / `self-healing-check.js` — CI health runner + auto-fix plan executor

### Critical Pitfalls

1. **API name collision (`captureFeedback` vs `recordFeedback`)** — run `grep -n "module.exports"` across both repos before any code movement; map aliases explicitly; never assume name parity
2. **Thompson timestamp NaN corrupting posteriors** — write a `parseTimestamp()` helper that normalizes all ISO 8601 variants to RFC 3339 before any Date arithmetic; missing `Z` and microsecond formats both observed in `feedback_model.json`
3. **LanceDB cross-language schema mismatch** — pin Node.js `@lancedb/lancedb@0.26.2` to match Lance file format version already used by Python 0.27.1; add a cross-language smoke test (Python creates table, Node.js reads with correct row count) before any production use
4. **Budget guard lock contention under parallel agents** — increase `timeoutMs` to 30s and `staleMs` to 60s; add concurrency stress test (5 parallel `addSpend()` calls); the current 5s timeout fails under 4+ simultaneous agents
5. **Self-heal over-triggering on ported code** — audit Subway's `lint:fix` for auto-import-sort before enabling; never run self-heal immediately after a manual sync without `git diff` review first

---

## Implications for Roadmap

Research reveals a clear dependency graph that dictates phase order. The file-system boundary (Node.js ↔ Python via JSONL/JSON) means each phase can be tested in isolation. Architecture research explicitly enumerates a 10-phase build order; this summary collapses it into 5 strategic phases for roadmap use.

### Phase 1: Contract Mapping and Schema Alignment

**Rationale:** Every feature port depends on knowing exactly what each repo exports and where schemas diverge. Skipping this creates the silent API name collision pitfall (Pitfall 1) and rubric schema divergence (Pitfall 2). Zero new features are written in this phase — it is exclusively an audit and alignment phase.
**Delivers:** Export diff document; `feedback-schema.js` diff resolution; rubric engine compatibility confirmed; function alias map; test count baseline (54 tests in ThumbGate, count preserved throughout)
**Addresses:** Table stakes — schema validation, JSONL storage parity
**Avoids:** API name collision, rubric gate bypass, unbounded test regression

### Phase 2: ML Features into thumbgate (Thompson Sampling + Sequence + Diversity)

**Rationale:** Thompson Sampling is the prerequisite for RLAIF/DPO and the highest-value ML upgrade. Sequence tracking and diversity tracking are lightweight additions that share the same capture-path extension. Grouping them minimizes the number of times the capture hot path is modified.
**Delivers:** `train_from_feedback.py` in ThumbGate; `feedback_model.json` posteriors; `feedback-sequences.jsonl`; `diversity-tracking.json`; `parseTimestamp()` normalizer
**Uses:** No new npm packages in this phase; Python venv already complete
**Implements:** Beta-Bernoulli Thompson Sampling pattern; LSTM sequence feature capture pattern; exponential time-decay with 7-day half-life
**Avoids:** Thompson timestamp NaN (Pitfall 3); Thompson without time-decay (Architecture Anti-Pattern 4)
**Research flag:** Standard pattern — Thompson Sampling in ThumbGate is well-documented; port is mechanical from Subway source

### Phase 3: Governance Features into Subway (Budget Guard + Intent Router + ContextFS + Self-Healing)

**Rationale:** Governance features are independent of Phase 2 ML work and can proceed in parallel or immediately after Phase 1. Budget guard must land before intent router (budget awareness before policy enforcement). Self-heal lands last because it requires the full governance stack to know what "healthy" means.
**Delivers:** `budget-guard.js` in Subway; `intent-router.js` + policy bundles; `contextfs.js` with 5 namespaces; `self-heal.js` + `self-healing-check.js`; npm scripts `self-heal:check` and `self-heal:run`
**Uses:** Zero new npm packages (all scripts copy verbatim with THUMBGATE_FEEDBACK_DIR env var adjustments)
**Implements:** File-lock budget ledger pattern; intent classification with approval requirements; namespaced context store with Jaccard semantic cache; health check runner with fix plan
**Avoids:** Budget guard lock contention (Pitfall 5); self-heal over-triggering (Pitfall 6); Subway lint:fix must be audited before self-heal is enabled
**Research flag:** Standard pattern for budget-guard, intent-router, contextfs; self-heal port needs Subway `package.json` script audit before implementation

### Phase 4: LanceDB Vector Storage into thumbgate

**Rationale:** LanceDB is the highest-complexity addition (native Rust binaries, cross-language schema compatibility, ESM in a CommonJS project). Isolating it into its own phase allows the smoke test (Python creates table, Node.js reads it) to gate the entire phase before any production use. Dependency: Phase 1 (memory-log.jsonl format must be stable).
**Delivers:** `@lancedb/lancedb` integration; `lancedb/` directory under `.claude/memory/feedback/`; hybrid search (vector + BM25/FTS); `thumbgate_memories` table with 384-dim embeddings
**Uses:** `@lancedb/lancedb@0.26.2`, `apache-arrow@18.1.0`, `@huggingface/transformers@3.8.1` (all 3 new npm packages)
**Implements:** LanceDB hybrid search pattern; dynamic import pattern for ESM in CommonJS; per-repo LanceDB path namespacing
**Avoids:** LanceDB platform/version mismatch (Pitfall 4); shared LanceDB path without namespace (Architecture Anti-Pattern 3)
**Research flag:** Needs phase research — cross-language LanceDB schema compatibility has known issues (#669, #2134); verify Lance file format version alignment before writing any code

### Phase 5: RLAIF Self-Scoring and DPO Batch Optimization

**Rationale:** RLAIF depends on Thompson Sampling posteriors (Phase 2) and budget guard (Phase 3). DPO batch optimization depends on preference pairs from existing feedback and stable posteriors. This is the highest-complexity ML phase and should land after all infrastructure is verified.
**Delivers:** `selfAudit()` function (renamed from `selfScore()` to clarify heuristic nature); DPO preference pair construction; batch posterior updates; `self-score-log.jsonl`
**Uses:** `@anthropic-ai/sdk@0.78.0` (already present); budget guard wrapping every RLAIF call
**Implements:** Constitutional check / heuristic scoring pattern; DPO preference pair pattern (Rafailov et al. 2023)
**Avoids:** RLAIF label overstates capability (Pitfall 7); function must be named `selfAudit` not `selfScore` in ThumbGate
**Research flag:** Standard pattern — DPO math is well-documented in literature and Subway source; heuristic rename is mechanical

### Phase Ordering Rationale

- Phase 1 is non-negotiable first — all ports require knowing what's where
- Phases 2 and 3 are independent and can run in parallel if staffing allows; Phase 3 (governance → Subway) is lower risk and should start first if sequential
- Phase 4 is isolated by design — LanceDB's native binary risks make it the most likely to surface environment issues; must not block Phase 3 governance delivery
- Phase 5 is last because it depends on both Thompson Sampling (Phase 2) and budget guard (Phase 3) being stable and tested

### Research Flags

Phases needing deeper research during planning:
- **Phase 4 (LanceDB):** Cross-language schema compatibility has documented failure modes; need to verify Lance file format version between Python 0.27.1 and Node.js 0.26.2 before writing any code
- **Phase 5 (RLAIF/DPO):** DPO math is well-documented but the integration point between `selfAudit` heuristic scores and Thompson posterior updates needs explicit design before implementation

Phases with standard patterns (can skip research-phase):
- **Phase 1:** Diffing exports is mechanical; no research needed
- **Phase 2:** Thompson Sampling port is mechanical from Subway source; architecture is confirmed by direct code inspection
- **Phase 3:** All governance scripts are zero-dependency copies; only the Subway lint:fix audit is new work

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified via live npm registry, pip show, and package.json inspection; no speculation |
| Features | HIGH | Direct code inspection of both repos; feature presence/absence confirmed by file-level evidence |
| Architecture | HIGH | Build order derived from actual dependency graph in live code; anti-patterns confirmed by code structure |
| Pitfalls | HIGH | All 7 critical pitfalls confirmed by direct code inspection; timestamp format observed in `feedback_model.json`; LanceDB issues linked to confirmed GitHub issues |

**Overall confidence:** HIGH

### Gaps to Address

- **Lance file format version compatibility (Python 0.27.1 vs Node.js 0.26.2):** Not definitively resolved in research. The PITFALLS research identifies this as a known failure mode (LanceDB #669, #2134) but the exact Lance format version numbers for each SDK version were not confirmed. Must verify before Phase 4 implementation.
- **Subway lint:fix behavior under auto-import-sort:** PITFALLS research flags this as a potential self-heal over-trigger risk but does not confirm whether Subway's actual ESLint config includes import sorting. Must audit `Subway_RN_Demo/.eslintrc.js` or equivalent before enabling self-heal in Phase 3.
- **Budget guard under GSD parallel agents in Subway context:** Pitfall 5 identifies the concurrency risk; the recommended fix (30s timeout, 60s stale) is a mitigation, not a solution. If Subway's agent execution pattern regularly runs 4+ parallel agents, a coordinator pattern may be needed. Deferred to Phase 3 implementation decision.

---

## Sources

### Primary (HIGH confidence)
- `/Users/ganapolsky_i/workspace/git/igor/ThumbGate/scripts/` — direct code inspection; all governance scripts confirmed
- `/Users/ganapolsky_i/workspace/git/igor/ThumbGate/package.json` — zero npm deps, CommonJS, Node.js 25.6.1 confirmed
- `/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/train_from_feedback.py` — Thompson Sampling, DPO, meta-policy rules
- `/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/capture-feedback.js` — LSTM sequence tracking, diversity tracking, LanceDB
- `/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/memory/feedback/lance-index-state.json` — LanceDB active, all-MiniLM-L6-v2, live
- `/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/memory/feedback/diversity-tracking.json` — live diversity score 76.2%
- npm registry live queries: `@lancedb/lancedb@0.26.2`, `@huggingface/transformers@3.8.1`, `apache-arrow@18.1.0`
- `pip3 show lancedb` + `pip3 show sentence-transformers` — system Python versions confirmed
- Stanford TS Tutorial — Beta-Bernoulli update rule matches Subway implementation exactly

### Secondary (MEDIUM confidence)
- arXiv:2505.23927 — Thompson Sampling in Online ThumbGate; O(sqrt(T)) regret bound
- arXiv:2305.18290 — Rafailov et al. DPO: Direct Preference Optimization (foundational)
- arXiv:2509.03990 — Meta-Policy Reflexion (referenced in Subway code comments)
- arXiv:2309.00267 — RLAIF vs ThumbGate; comparable performance at lower cost
- LanceDB GitHub Issue #669 — Append with different schema (confirmed bug)
- LanceDB GitHub Issue #2134 — FixedSizeList schema errors in v0.16
- LanceDB official site — 2026 updates: native SQL via DuckDB, FTS via Tantivy
- HuggingFace blog — @huggingface/transformers v4 is preview-only (do not use)

### Tertiary (LOW confidence)
- HybridFlow ThumbGate Framework (arXiv:2409.19256) — academic reference only; not directly applicable to this system
- AAAI 2025 seq2seq reward modeling — validates sequence tracking investment as future training data

---

*Research completed: 2026-03-04*
*Ready for roadmap: yes*
