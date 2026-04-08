# Architecture Research

**Domain:** Bidirectional ThumbGate Feature Sync (Node.js + Python ML scripts)
**Researched:** 2026-03-04
**Confidence:** HIGH (based on direct code inspection of both repos)

---

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                     SHARED ThumbGate CORE (BOTH REPOS)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │
│  │feedback-loop │  │feedback-     │  │rubric-engine.js          │   │
│  │.js           │  │schema.js     │  │(weighted criteria +      │   │
│  │(capture,     │  │(typed schema,│  │ guardrails + DPO export) │   │
│  │ RLAIF self-  │  │ action disco.│  │                          │   │
│  │ score,       │  │ union, bdry  │  │                          │   │
│  │ prevention   │  │ validation)  │  │                          │   │
│  │ rules)       │  │              │  │                          │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────────┘  │
│         │                 │                      │                   │
│  ┌──────▼─────────────────▼──────────────────────▼───────────────┐  │
│  │                   JSONL Storage Layer                          │  │
│  │  feedback-log.jsonl | memory-log.jsonl | dpo-pairs.jsonl       │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────┐   ┌──────────────────────────────┐
│   thumbgate (product)   │   │   Subway_RN_Demo (app)        │
│                                  │   │                              │
│ GOVERNANCE LAYER                 │   │ ML LAYER                     │
│  budget-guard.js                 │◄──►  train_from_feedback.py      │
│  intent-router.js                │   │  (Thompson Sampling)         │
│  mcp-policy.js                   │   │                              │
│  subagent-profiles.js            │   │  semantic-memory-v2.py       │
│  policy-bundles/*.json           │   │  (LanceDB + BM25/FTS hybrid) │
│                                  │   │                              │
│ CONTEXT LAYER                    │   │  capture-feedback.js         │
│  contextfs.js                    │   │  (LSTM sequence features)    │
│  (namespaced file-system store)  │   │                              │
│                                  │   │  agentic-memory.py           │
│ HEALING LAYER                    │   │  (A-Mem Zettelkasten         │
│  self-heal.js                    │   │   + LanceDB tables)          │
│  self-healing-check.js           │   │                              │
│                                  │   │ AUTONOMY LAYER               │
│ API LAYER                        │   │  autonomy-decision-engine.js │
│  src/api/server.js               │   │  context-engine.js           │
│  adapters/{claude,amp,chatgpt,   │   │  (knowledge bundles,         │
│           codex,gemini,mcp}/     │   │   quality-log, routing)      │
└──────────────────────────────────┘   └──────────────────────────────┘
        SYNC DIRECTION: bidirectional (cherry-pick, not full merge)
```

### Component Responsibilities

| Component | Responsibility | Typical Location |
|-----------|----------------|-----------------|
| `feedback-loop.js` | Capture thumbs signals, invoke RLAIF self-score, propagate to autonomy/context engines, write JSONL | Both repos (shared core) |
| `feedback-schema.js` | Typed schema validation; discriminated union of action types; reject invalid data at boundary | Both repos (identical) |
| `rubric-engine.js` | Load weighted criteria JSON, score responses, flag guardrail failures, emit promotion-eligible flag | Both repos |
| `export-dpo-pairs.js` | Read memory-log.jsonl, pair errors+learnings into DPO triples, write dpo-pairs.jsonl | thumbgate |
| `train_from_feedback.py` | Beta-Bernoulli Thompson Sampling; per-category alpha/beta posteriors; exponential time decay; DPO batch optimization | Subway (to receive in ThumbGate) |
| `semantic-memory-v2.py` / `agentic-memory.py` | LanceDB vector + FTS hybrid search; A-Mem Zettelkasten linking; BM25 fusion | Subway (to receive in ThumbGate) |
| `capture-feedback.js` (Subway variant) | LSTM/Transformer sequence tracking; diversity tracking; action-outcome patterns; streak analytics | Subway (to receive in ThumbGate) |
| `budget-guard.js` | File-lock ledger; monthly spending cap enforcement; per-operation cost recording | ThumbGate (to receive in Subway) |
| `intent-router.js` | Load policy bundle JSON; classify action intents; resolve approval requirements per MCP profile | ThumbGate (to receive in Subway) |
| `contextfs.js` | Namespaced file-system context store; provenance tracking; bounded context pack construction | ThumbGate (to receive in Subway) |
| `self-heal.js` / `self-healing-check.js` | Run fix-plan scripts (lint:fix, format, feedback:rules); diff before/after; report changed files | ThumbGate (to receive in Subway) |
| `mcp-policy.js` / `subagent-profiles.js` | MCP tool allowlists per profile; subagent profile → MCP profile mapping; validate consistency | ThumbGate (to receive in Subway) |
| `autonomy-decision-engine.js` | Dual risk×autonomy scoring; interrupt history learning; catalog-based action scoring | Subway (existing) |
| `context-engine.js` | Knowledge bundle pre-computation; category routing; quality-log; prompt registry | Subway (existing) |
| `src/api/server.js` | 10 REST endpoints; routes to all scripts; no framework dependency | ThumbGate only |
| `adapters/{platform}/` | Platform shims for Claude, AMP, ChatGPT, Codex, Gemini, MCP STDIO | ThumbGate only |

---

## Recommended Project Structure

### thumbgate (after receiving Subway ML features)

```
scripts/
├── feedback-loop.js          # Core: capture + RLAIF + propagation
├── feedback-schema.js        # Boundary validation
├── rubric-engine.js          # Scoring engine
├── export-dpo-pairs.js       # DPO pair builder
├── budget-guard.js           # Cost ledger (existing)
├── contextfs.js              # Context pack store (existing)
├── intent-router.js          # Policy + intent classification (existing)
├── self-heal.js              # Auto-fix runner (existing)
├── self-healing-check.js     # Health check runner (existing)
├── mcp-policy.js             # MCP allowlists (existing)
├── subagent-profiles.js      # Profile mappings (existing)
├── train_from_feedback.py    # [NEW from Subway] Thompson Sampling
└── capture-feedback-ml.js    # [NEW from Subway] Sequence/LSTM tracking

.claude/memory/feedback/
├── feedback-log.jsonl        # Raw feedback events
├── memory-log.jsonl          # Validated memory records
├── dpo-pairs.jsonl           # Preference pairs for training
├── feedback_model.json       # Beta-Bernoulli posteriors
├── feedback-sequences.jsonl  # LSTM sequence features
├── diversity-tracking.json   # Domain coverage stats
├── model_snapshots/          # Thompson Sampling snapshots
└── lancedb/                  # [NEW] LanceDB vector + FTS index

config/
├── rubrics/default-v1.json   # Rubric criteria + weights
├── policy-bundles/           # Intent risk definitions
├── mcp-allowlists.json       # Tool allowlists per profile
└── subagent-profiles.json    # Profile → MCP profile map

src/api/server.js             # REST API
adapters/                     # Platform shims
tests/                        # 15 test files (54+ tests)
```

### Subway_RN_Demo (after receiving thumbgate governance)

```
scripts/
├── feedback-loop.js          # Updated: add ContextFS propagation
├── feedback-schema.js        # Already identical
├── feedback-to-memory.js     # Existing memory writer
├── autonomy-decision-engine.js # Existing (unchanged)
├── context-engine.js         # Existing (unchanged)
└── budget-guard.js           # [NEW from ThumbGate]

.claude/scripts/
├── intent-router.js          # [NEW from ThumbGate]
├── mcp-policy.js             # [NEW from ThumbGate]
├── subagent-profiles.js      # [NEW from ThumbGate]
├── self-heal.js              # [NEW from ThumbGate]
├── self-healing-check.js     # [NEW from ThumbGate]
└── contextfs.js              # [NEW from ThumbGate]

config/
└── policy-bundles/default-v1.json  # [NEW from ThumbGate]
```

### Structure Rationale

- **scripts/ vs .claude/scripts/:** Subway keeps repo-visible scripts in `scripts/`; agent-only scripts live in `.claude/scripts/`. The governance components (budget-guard, intent-router, contextfs) belong in `.claude/scripts/` in Subway because they are agent-facing, not app-facing.
- **lancedb/ under .claude/memory/feedback/:** Matches the LanceDB path convention already in Subway (`~/.shieldcortex/lancedb/` for teams-rag, `memory/feedback/lancedb/` for ThumbGate). Keeps vector index co-located with JSONL logs.
- **train_from_feedback.py as a script, not a service:** Both repos treat ML training as a CLI script invoked by npm scripts, not a long-running process. This matches the $10/month budget constraint — no persistent compute.

---

## Architectural Patterns

### Pattern 1: Boundary Validation Gate

**What:** All feedback data is validated at entry (schema.js) before reaching storage or downstream consumers. Bad data is rejected with structured errors, never silently dropped.

**When to use:** On every captureFeedback() call and every MCP tool invocation.

**Trade-offs:** Slightly more upfront code; prevents silent data corruption that would poison ML model.

**Example:**
```javascript
// feedback-loop.js — validation gate pattern
const action = resolveFeedbackAction({ signal, context, tags });
if (action.type === 'no-action') {
  return { accepted: false, reason: action.reason };
}
const prepared = prepareForStorage(action.memory);
if (!prepared.ok) {
  return { accepted: false, reason: prepared.issues.join('; ') };
}
appendJSONL(FEEDBACK_LOG_PATH, feedbackEvent);
```

### Pattern 2: Beta-Bernoulli Thompson Sampling (Bayesian Bandit)

**What:** Each task category (code_edit, git, testing, etc.) maintains an alpha/beta posterior. Positive feedback increments alpha, negative increments beta. Weighted by exponential time decay (half-life = 7 days). Sample from posteriors to estimate current reliability.

**When to use:** To rank which categories need intervention, select highest-confidence action strategies, and drive DPO training batch selection.

**Trade-offs:** Requires 10+ feedback entries per category to converge. With 264+ entries in Subway, posteriors are already meaningful. thumbgate starts with uniform Beta(1,1) priors.

**Example:**
```python
# train_from_feedback.py — incremental update
def update_category(model, cat_name, positive, weight=1.0):
    cat = model["categories"][cat_name]
    if positive:
        cat["alpha"] += weight   # Bayesian update: success
    else:
        cat["beta"] += weight    # Bayesian update: failure
    cat["samples"] += 1
```

### Pattern 3: LSTM Sequence Feature Capture

**What:** Every feedback event saves a sliding window (last 10 interactions) of reward sequence, tag frequency, temporal gaps, and action-outcome patterns. This builds a JSONL corpus for time-series model training.

**When to use:** Alongside every feedback capture. No separate invocation needed.

**Trade-offs:** Adds ~5ms per capture event (file read + feature extraction). Sequence file grows at ~1KB/entry; manageable for 264+ entries (< 1MB). For thumbgate at 54 tests with fewer feedback entries, the corpus is thin initially.

**Example:**
```javascript
// capture-feedback.js — sequence builder
function buildSequenceFeatures(recentFeedback, currentEntry) {
  return {
    rewardSequence: sequence.map(f => f.reward),    // [-1,1,1,-1,...]
    tagFrequency: ...,                               // domain coverage
    recentTrend: calculateTrend(sequence.slice(-5)), // momentum
    timeGaps: calculateTimeGaps(sequence),           // temporal patterns
    actionPatterns: extractActionPatterns(sequence), // what actions → outcomes
  };
}
```

### Pattern 4: LanceDB Hybrid Search (Vector + BM25/FTS)

**What:** LanceDB stores memory embeddings (384-dim all-MiniLM-L6-v2 or OpenAI fallback) and exposes both vector similarity search and native FTS (Tantivy/BM25). Both results are fused (Reciprocal Rank Fusion) before reranking.

**When to use:** For context retrieval in semantic-memory-v2.py and agentic-memory.py. LanceDB path at `memory/feedback/lancedb/` in both repos.

**Trade-offs:** LanceDB is embedded (zero server overhead, ~50ms query latency). Requires `@lancedb/lancedb` npm package (Rust-native via napi-rs). The `vectordb` npm package is the older API; use `@lancedb/lancedb` for FTS support (2026 feature).

**Example:**
```python
# semantic-memory-v2.py — hybrid search
lancedb_results = table.search(query_embedding).limit(top_k).to_list()
fts_results = table.search(query_text, query_type="fts").limit(top_k).to_list()
combined = reciprocal_rank_fusion(lancedb_results, fts_results)
```

### Pattern 5: File-Lock Budget Ledger

**What:** `budget-guard.js` uses a `.lock` file (OS-level `wx` flag) to ensure atomic read-modify-write of a monthly ledger. Stale locks (> 15s) auto-expire. This is the only concurrency primitive needed at this scale.

**When to use:** Wrap every operation that consumes external API budget (embedding generation, Claude API calls for RLAIF).

**Trade-offs:** Synchronous spin-wait with 20ms sleep. Acceptable at ThumbGate feedback rates (not high-throughput). Fails loudly if lock cannot be acquired in 5s.

---

## Data Flow

### Feedback Capture Flow (both repos, shared core)

```
User thumbs signal
        |
        v
captureFeedback(params)
        |
        +--> feedback-schema.js: validate + resolve action
        |         |
        |    [rejected] --> return { accepted: false }
        |         |
        |    [accepted]
        |         v
        +--> budget-guard.js: check monthly cap [ThumbGate] / [new in Subway]
        |
        v
appendJSONL(feedback-log.jsonl)
        |
        +--> autonomy-decision-engine.js: update risk history [Subway]
        |         via recordOutcome(action, 'approved'|'interrupted')
        |
        +--> context-engine.js: logQualityResult [Subway]
        |         (precision/recall tracking for context bundles)
        |
        +--> buildSequenceFeatures() --> feedback-sequences.jsonl [Subway ML → ThumbGate]
        |
        +--> updateDiversityTracking() --> diversity-tracking.json [Subway ML → ThumbGate]
        |
        v
appendJSONL(memory-log.jsonl) [validated memory record]
```

### Thompson Sampling Training Flow (Subway → thumbgate)

```
feedback-log.jsonl
        |
        v
train_from_feedback.py --train
        |
        +--> classify_entry() → per-category label
        +--> time_decay_weight() → exponential decay (half-life 7d)
        +--> update alpha/beta per category
        |
        v
feedback_model.json (Beta-Bernoulli posteriors)
        |
        v
--sample → sample_from_posteriors() → reliability table
--snapshot → model_snapshots/{timestamp}.json
--dpo-train → batch DPO optimization from posteriors
```

### LanceDB Context Retrieval Flow (Subway → thumbgate)

```
query string
        |
        v
semantic-memory-v2.py / agentic-memory.py
        |
        +--> generate embedding (OpenAI → local MiniLM fallback)
        |
        +--> LanceDB vector search (ANN, 384-dim)
        +--> LanceDB FTS search (Tantivy/BM25)
        |
        v
Reciprocal Rank Fusion → top-k results
        |
        v
[optional] Cohere Rerank
        |
        v
context pack → injected into CLAUDE.md or session prompt
```

### Self-Healing Flow (ThumbGate → Subway)

```
Trigger: CI failure / scheduled check / manual
        |
        v
self-healing-check.js: collectHealthReport()
        |
        +--> budget:status (npm run)
        +--> npm test
        +--> prove:adapters (npm run)
        +--> prove:automation (npm run)
        |
        v
[unhealthy] → self-heal.js: runSelfHeal()
        |
        +--> listChangedFiles() [git diff before]
        +--> buildFixPlan() → [lint:fix, format, feedback:rules]
        +--> runFixPlan() → spawnSync each script
        +--> listChangedFiles() [git diff after]
        |
        v
healReport: { fixed, changedFiles, results }
```

### Intent Router + Policy Bundle Flow (ThumbGate → Subway)

```
agent action request
        |
        v
intent-router.js: planIntent(intentId)
        |
        +--> loadPolicyBundle(bundleId) → validate JSON
        +--> getActiveMcpProfile() [from THUMBGATE_MCP_PROFILE or subagent profile]
        +--> getRequiredApprovalRisks(bundle, profile)
        |
        v
intent plan: { actions[], requiresApproval, mcpProfile, toolsAllowed }
        |
        +--> [requiresApproval=true] → pause for human confirmation
        +--> [requiresApproval=false] → execute actions
```

### ContextFS Flow (ThumbGate → Subway)

```
agent context retrieval request
        |
        v
constructContextPack(query, options)
        |
        +--> normalizeNamespaces() → resolve aliases
        +--> read from: raw_history/, memory/error/, memory/learning/,
        |              rules/, tools/, provenance/
        |
        v
context pack (bounded by maxItems/maxChars from subagent profile)
        |
        v
evaluateContextPack(packId, outcome) [after session]
        |
        v
provenance tracking → precision/recall learning
```

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Anthropic Claude API | adapter/claude/ shim | Used for RLAIF self-scoring; capped by budget-guard |
| OpenAI Embeddings | Direct HTTP in vectorize-content.js | Fallback from local MiniLM; budget-guarded |
| Voyage AI Embeddings | Direct HTTP fallback | Optional; only if VOYAGE_API_KEY set |
| Cohere Rerank | Optional HTTP in local-rag-enhanced.py | $2/1M requests; skipped if no key |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| feedback-loop.js ↔ autonomy-decision-engine.js | Direct require() + recordOutcome() | Lazy-loaded to allow test mocking |
| feedback-loop.js ↔ context-engine.js | Direct require() + logQualityResult() | Lazy-loaded; graceful failure if unavailable |
| feedback-loop.js ↔ feedback-schema.js | Direct require(); validates at every boundary | No lazy load — always required |
| intent-router.js ↔ mcp-policy.js | Direct require() + getAllowedTools() | Validates profile consistency at startup |
| contextfs.js ↔ file system | fs.readFileSync / appendFileSync | No db dependency; JSONL + JSON files |
| budget-guard.js ↔ ledger | File lock (wx flag) + JSON ledger | Only concurrency primitive; no DB needed |
| train_from_feedback.py ↔ feedback-log.jsonl | File read (no socket) | Python → Node boundary is file-system only |
| semantic-memory-v2.py ↔ LanceDB | lancedb Python SDK | Tables: memories, links, boxes |
| vectorize-content.js ↔ LanceDB | @lancedb/lancedb npm (napi-rs) | Uses same ~/.shieldcortex/lancedb path |

---

## Suggested Build Order (Dependencies)

The dependency graph dictates this sequence. Each phase must be complete and tested before the next.

```
Phase 1 — Shared Core Alignment (no new features, verify parity)
  Confirm feedback-schema.js is identical in both repos
  Confirm rubric-engine.js is compatible
  Dependency: none

Phase 2 — ThumbGate receives Thompson Sampling (Subway ML → ThumbGate)
  Port train_from_feedback.py
  Wire: feedback-log.jsonl → Python trainer → feedback_model.json
  Dependency: Phase 1 (feedback-log.jsonl format must be stable)

Phase 3 — ThumbGate receives LanceDB (Subway ML → ThumbGate)
  Port semantic-memory-v2.py and/or agentic-memory.py
  Install @lancedb/lancedb npm package
  Wire: memory-log.jsonl → LanceDB indexer → hybrid search
  Dependency: Phase 1 (memory-log.jsonl format must be stable)

Phase 4 — ThumbGate receives LSTM Sequence Tracking (Subway ML → ThumbGate)
  Port capture-feedback.js sequence features into ThumbGate capture path
  Wire: every captureFeedback() → buildSequenceFeatures() → sequences.jsonl
  Dependency: Phase 1 (capture path must be finalized)

Phase 5 — ThumbGate receives Diversity Tracking (Subway ML → ThumbGate)
  Port updateDiversityTracking() + DOMAIN_CATEGORIES
  Wire: every capture → diversity-tracking.json update
  Dependency: Phase 4 (same capture path extension)

Phase 6 — ThumbGate receives RLAIF Self-Scoring (Subway ML → ThumbGate)
  Port RLAIF heuristic scoring from Subway feedback-loop.js
  Wire: capture → rlaif score → self-score-log.jsonl
  Dependency: Phase 1, budget-guard already present in ThumbGate

Phase 7 — Subway receives Budget Guard (ThumbGate → Subway)
  Port budget-guard.js to Subway
  Wire: any API-calling script checks budget before calling
  Dependency: none (self-contained)

Phase 8 — Subway receives Intent Router + Policy Bundles (ThumbGate → Subway)
  Port intent-router.js + mcp-policy.js + subagent-profiles.js
  Port config/policy-bundles/default-v1.json
  Wire: autonomy-decision-engine → intent classification before approval
  Dependency: Phase 7 (budget awareness before policy enforcement)

Phase 9 — Subway receives ContextFS (ThumbGate → Subway)
  Port contextfs.js
  Wire: session context retrieval → contextfs namespaces
  Replace or augment context-engine.js knowledge bundles
  Dependency: Phase 8 (subagent profiles drive context.maxItems limits)

Phase 10 — Subway receives Self-Healing Monitor (ThumbGate → Subway)
  Port self-heal.js + self-healing-check.js
  Add npm scripts: self-heal:check, self-heal:run
  Wire: CI failure hook → self-healing-check → self-heal
  Dependency: Phase 9 (full governance stack present before auto-fix)
```

---

## Anti-Patterns

### Anti-Pattern 1: Full Merge Instead of Cherry-Pick

**What people do:** Attempt to merge the entire thumbgate codebase into Subway or vice versa.
**Why it's wrong:** Repos serve different purposes. Subway is a React Native app; thumbgate is a Node.js product library with 5 platform adapters. A full merge would pollute the app with API server code, and pollute the library with RN-specific scripts.
**Do this instead:** Cherry-pick specific scripts. Each script is designed to be standalone (no framework coupling, lazy peer requires).

### Anti-Pattern 2: Direct Python → Node.js API Calls

**What people do:** Call Python ML scripts over HTTP or a subprocess socket to integrate Thompson Sampling into the Node.js capture flow.
**Why it's wrong:** Creates a runtime dependency that breaks budget guard, tests, and CI when Python is unavailable. Subway's Python scripts are marked LOCAL ONLY and should not become required services.
**Do this instead:** Use the file-system boundary. Node.js writes JSONL; Python reads JSONL and writes JSON model files; Node.js reads JSON model files. No HTTP, no sockets, no subprocess coupling in hot path.

### Anti-Pattern 3: Shared LanceDB Path Without Table Namespacing

**What people do:** Point thumbgate's new LanceDB integration at the same path as Subway's `~/.shieldcortex/lancedb/`.
**Why it's wrong:** Cross-repo table writes cause schema conflicts. Subway uses tables: `teams_messages`, `memories`, `links`, `boxes`. ThumbGate needs its own namespace.
**Do this instead:** Use a per-repo LanceDB path: `memory/feedback/lancedb/` in each repo's local directory structure. Tables: `thumbgate_memories`, `thumbgate_errors`, `thumbgate_learnings`.

### Anti-Pattern 4: Thompson Sampling Without Time Decay

**What people do:** Update alpha/beta with uniform weight for all historical feedback.
**Why it's wrong:** Subway explicitly uses exponential time decay (half-life 7 days, toggled via `USE_EXPONENTIAL_DECAY`). Without decay, old feedback dominates and the model does not reflect current reliability.
**Do this instead:** Port the `time_decay_weight()` function intact. Set `USE_EXPONENTIAL_DECAY = True`. The 7-day half-life is empirically tuned for Subway's feedback cadence.

### Anti-Pattern 5: Skipping Schema Validation on Ported Scripts

**What people do:** Port capture-feedback.js LSTM sequence additions directly into ThumbGate's capture path without running through feedback-schema.js validation.
**Why it's wrong:** The LSTM sequence file (feedback-sequences.jsonl) contains raw entries that may not match ThumbGate's typed schema. Sequence entries are training data, not storage entries — they bypass the validation gate.
**Do this instead:** Keep two separate write paths: (1) validated feedback → memory-log.jsonl (schema-gated), (2) raw sequence features → feedback-sequences.jsonl (not schema-gated, ML training corpus only).

---

## Scalability Considerations

This system is a local-first agentic ThumbGate system with a $10/month budget constraint. Scalability concerns are about developer session frequency, not user traffic.

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0-500 feedback entries | File-system JSONL is optimal. No DB overhead. All scripts work as-is. |
| 500-5000 entries | LanceDB hybrid search becomes valuable (keyword search on JSONL degrades). Activate LanceDB indexing. Thompson Sampling posteriors are statistically meaningful. |
| 5000+ entries | Consider partitioning feedback-log.jsonl by month. LanceDB ANN index auto-scales. Python training script may need chunked reads (currently loads all into memory). |

### Scaling Priorities

1. **First bottleneck:** JSONL file size for in-memory Python reads. Fix: add `--incremental` mode to `train_from_feedback.py` (already exists) and call it after every capture instead of full rebuild.
2. **Second bottleneck:** LanceDB FTS index rebuild time when indexing thousands of entries. Fix: use the existing `INDEX_STATE_FILE` (lance-index-state.json) to skip unchanged entries on re-index.

---

## Sources

- Direct code inspection: `/Users/ganapolsky_i/workspace/git/igor/ThumbGate/scripts/` (HIGH confidence — primary source)
- Direct code inspection: `/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/` (HIGH confidence — primary source)
- [LanceDB official documentation](https://lancedb.github.io/lancedb/) — LanceDB Node.js SDK, FTS support (MEDIUM confidence — verified via WebSearch)
- [LanceDB GitHub](https://github.com/lancedb/lancedb) — `@lancedb/lancedb` npm package (MEDIUM confidence)
- [Thompson Sampling Tutorial — Stanford](https://web.stanford.edu/~bvr/pubs/TS_Tutorial.pdf) — Beta-Bernoulli update rule (HIGH confidence — matches Subway implementation exactly)
- [HybridFlow ThumbGate Framework](https://arxiv.org/abs/2409.19256) — Decoupled actor/reward/critic architecture (LOW confidence for this specific system — academic reference only)
- PROJECT.md: `/Users/ganapolsky_i/workspace/git/igor/ThumbGate/.planning/PROJECT.md` (HIGH confidence — authoritative project spec)

---
*Architecture research for: Bidirectional ThumbGate Feature Sync*
*Researched: 2026-03-04*
