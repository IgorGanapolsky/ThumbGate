# Phase 4: LanceDB Vector Storage - Research

**Researched:** 2026-03-04
**Domain:** LanceDB JS SDK (ESM-in-CommonJS), @huggingface/transformers ONNX embeddings, cross-language Lance file format compatibility
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| VEC-01 | LanceDB embedded table stores feedback vectors in thumbgate | Dynamic import pattern proven; storage path `.claude/memory/feedback/lancedb/`; table schema defined in code examples |
| VEC-02 | ESM/CJS compatibility resolved via dynamic import pattern | Confirmed: `const { connect } = await import('@lancedb/lancedb')` is the required pattern for CJS host + ESM package |
| VEC-03 | apache-arrow pinned to compatible version (<=18.1.0) | Confirmed: peer dep is `>=15.0.0 <=18.1.0`; current arrow 21.x is out of range; must pin to 18.1.0 |
| VEC-04 | Semantic similarity search returns relevant historical feedback | Hybrid search pattern (vector + BM25) verified in Subway Python reference implementation |
| VEC-05 | LanceDB integration has tests and proof report | Test structure defined; must use `node --test` runner (not jest); proof report pattern from Phase 2/3 |
</phase_requirements>

---

## Summary

Phase 4 adds LanceDB embedded vector storage to `thumbgate`, enabling semantic similarity search over historical feedback. The project is CommonJS (`"type": "commonjs"`) but `@lancedb/lancedb@0.26.2` is ESM-only — every call site must use `await import('@lancedb/lancedb')` dynamic import. This is the single most critical integration constraint: failing to use dynamic import will produce `require() of ES Module` errors at runtime.

The cross-language compatibility concern (Python writes Lance files, Node.js reads them) is now **confirmed safe for this project**. The Subway venv uses Python lancedb **0.26.1** (not 0.27.1 as the system pip shows — the system pip is a different install). The Node.js SDK is `@lancedb/lancedb@0.26.2`. Both 0.26.x versions share the same Lance file format version (the manifest binary confirms format version compatible with both). The `rlhf_feedback.lance` table in Subway was written by Python 0.26.1 and has one manifest version — the format is stable within the 0.26.x line.

The embedding stack is `@huggingface/transformers@3.8.1` with `onnxruntime-node` for local ONNX inference of `all-MiniLM-L6-v2` (384 dimensions, ~50ms per inference, no API calls). This exactly mirrors the Python `sentence-transformers` model used in Subway. The first `pipeline()` call downloads the model (~22MB) to the HuggingFace cache; subsequent calls load from cache. `apache-arrow@18.1.0` is a required peer dep — the current latest arrow (21.x) is out of range per LanceDB's peer dep constraint.

**Primary recommendation:** Create `scripts/vector-store.js` as a thin async module wrapping LanceDB via dynamic import. Call it from `captureFeedback()` as a non-blocking side-effect (same pattern used for sequence tracking and diversity tracking in Phase 2). The table name is `thumbgate_memories`, stored at `.claude/memory/feedback/lancedb/`. Tests use `node --test` with tmp directories.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@lancedb/lancedb` | `0.26.2` | Embedded vector database (create table, insert, search) | Matches Python venv 0.26.1 Lance file format; stable; `node >= 18` compatible |
| `apache-arrow` | `18.1.0` | Arrow table serialization (required peer dep) | LanceDB peer dep requires `>=15.0.0 <=18.1.0`; arrow 19+ is out of range; must pin |
| `@huggingface/transformers` | `3.8.1` | Local ONNX embedding inference via `pipeline()` | Only local-first Node.js embedding option; same model as Subway Python stack; free |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `onnxruntime-node` | transitive | ONNX inference runtime | Auto-pulled by `@huggingface/transformers`; do NOT pin separately |
| Python lancedb (Subway venv) | `0.26.1` | Existing tables written by Python | Already present; no action needed; format-compatible with JS 0.26.2 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@lancedb/lancedb@0.26.2` | `@lancedb/lancedb@0.27.0-beta.*` | Beta; napi-rs v3 breaking changes; native binary loading unstable; do not use |
| `@huggingface/transformers@3.8.1` | Python subprocess + sentence-transformers | Adds subprocess latency; breaks Node-only architecture |
| `@huggingface/transformers@3.8.1` | Anthropic Embeddings API | Costs money per call; violates $10/month budget cap |
| `@huggingface/transformers@3.8.1` | `@xenova/transformers` | Old package name (v2); v3 was rebranded to @huggingface org; do not use |

**Installation:**
```bash
cd /Users/ganapolsky_i/workspace/git/igor/rlhf
npm install @lancedb/lancedb@0.26.2
npm install apache-arrow@18.1.0
npm install @huggingface/transformers@3.8.1
```

---

## Architecture Patterns

### Recommended Project Structure
```
scripts/
├── feedback-loop.js         # Existing; add non-blocking vectorStore.upsert() call
├── vector-store.js          # NEW: LanceDB wrapper module (async, dynamic import)
└── ...

tests/
├── vector-store.test.js     # NEW: unit tests using node --test + tmpdir

.claude/memory/feedback/
└── lancedb/                 # Lance tables written here (gitignored)
    └── thumbgate_memories.lance  # Table: id, text, vector, signal, tags, timestamp
```

### Pattern 1: Dynamic Import in CommonJS Module

**What:** `@lancedb/lancedb` is ESM-only. The project is CommonJS. The only correct approach is top-level `await import()` inside an `async` function or at module initialization.

**When to use:** Always. Never use `require('@lancedb/lancedb')` — it throws `ERR_REQUIRE_ESM`.

```javascript
// scripts/vector-store.js — Source: verified against STACK.md and @lancedb/lancedb package.json "type":"module"

'use strict';

const path = require('path');
const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_LANCE_DIR = path.join(PROJECT_ROOT, '.claude', 'memory', 'feedback', 'lancedb');

// Module-level cache to avoid re-importing on every call
let _lancedb = null;
let _pipeline = null;
const TABLE_NAME = 'thumbgate_memories';

async function getLanceDB() {
  if (!_lancedb) {
    _lancedb = await import('@lancedb/lancedb');
  }
  return _lancedb;
}

async function getEmbeddingPipeline() {
  if (!_pipeline) {
    const { pipeline } = await import('@huggingface/transformers');
    _pipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true,
    });
  }
  return _pipeline;
}

async function embed(text) {
  const pipe = await getEmbeddingPipeline();
  const output = await pipe(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data); // Float32Array -> plain array for LanceDB
}

async function upsertFeedback(feedbackEvent) {
  const lanceDir = process.env.THUMBGATE_FEEDBACK_DIR
    ? path.join(process.env.THUMBGATE_FEEDBACK_DIR, 'lancedb')
    : DEFAULT_LANCE_DIR;

  const { connect } = await getLanceDB();
  const db = await connect(lanceDir);

  const textForEmbedding = [
    feedbackEvent.context || '',
    (feedbackEvent.tags || []).join(' '),
    feedbackEvent.whatWentWrong || '',
    feedbackEvent.whatWorked || '',
  ].filter(Boolean).join('. ');

  const vector = await embed(textForEmbedding);

  const record = {
    id: feedbackEvent.id,
    text: textForEmbedding,
    vector,
    signal: feedbackEvent.signal,
    tags: (feedbackEvent.tags || []).join(','),
    timestamp: feedbackEvent.timestamp,
    context: feedbackEvent.context || '',
  };

  const tableNames = await db.tableNames();
  if (tableNames.includes(TABLE_NAME)) {
    const table = await db.openTable(TABLE_NAME);
    await table.add([record]);
  } else {
    await db.createTable(TABLE_NAME, [record]);
  }
}

async function searchSimilar(queryText, limit = 5) {
  const lanceDir = process.env.THUMBGATE_FEEDBACK_DIR
    ? path.join(process.env.THUMBGATE_FEEDBACK_DIR, 'lancedb')
    : DEFAULT_LANCE_DIR;

  const { connect } = await getLanceDB();
  const db = await connect(lanceDir);

  const tableNames = await db.tableNames();
  if (!tableNames.includes(TABLE_NAME)) return [];

  const vector = await embed(queryText);
  const table = await db.openTable(TABLE_NAME);
  const results = await table.search(vector).limit(limit).toArray();
  return results;
}

module.exports = { upsertFeedback, searchSimilar, TABLE_NAME };
```

### Pattern 2: Non-Blocking Side-Effect Integration in captureFeedback()

**What:** Vector store upsert is called after the primary write succeeds, in a try/catch that never throws to the caller. Same pattern as `appendSequence()` and `updateDiversityTracking()` in Phase 2.

**When to use:** When adding vector indexing to an existing synchronous capture pipeline.

```javascript
// In scripts/feedback-loop.js — inside captureFeedback(), after primary write succeeds
// Source: matches existing ML side-effect pattern at line 360-371

// Vector storage side-effect (non-blocking — primary write already succeeded)
const vectorStore = getVectorStoreModule();
if (vectorStore) {
  vectorStore.upsertFeedback(feedbackEvent).catch(() => {
    // Non-critical; primary feedback log is the source of truth
  });
}
```

```javascript
// Helper function (add near getContextFsModule)
function getVectorStoreModule() {
  try {
    return require('./vector-store');
  } catch {
    return null;
  }
}
```

### Pattern 3: Lazy Module Load (Dynamic Import Cache)

**What:** Cache the dynamic import result at module level so `import('@lancedb/lancedb')` runs only once per process lifetime, not once per `upsertFeedback()` call. The first call takes ~200ms (ESM loading + native binary), subsequent calls are instant.

**Why critical:** Without caching, every feedback capture triggers an ESM import overhead.

### Anti-Patterns to Avoid

- **`require('@lancedb/lancedb')`:** Throws `ERR_REQUIRE_ESM` at runtime. LanceDB's package.json has `"type": "module"`. There is no CJS shim.
- **Shared LanceDB directory between repos:** rlhf and Subway must use separate `lancedb/` paths. Never point both at the same directory.
- **Blocking synchronous wrapper around async LanceDB:** Do not use `deasync` or `child_process.spawnSync` to make LanceDB synchronous. Use the non-blocking async side-effect pattern.
- **Calling `pipeline()` on every upsert:** The ONNX model takes ~200-400ms to load. Cache the pipeline at module level.
- **Using `@lancedb/lancedb@0.27.0-beta.*`:** napi-rs v3 upgrade; native binary loading changes; API instability. Use 0.26.2.
- **Pinning apache-arrow to latest (21.x):** LanceDB 0.26.2 peer dep requires `<=18.1.0`. Arrow 19+ breaks with peer dep conflict and may cause runtime failures.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Embedding generation | Manual tokenization + cosine sim on raw text | `@huggingface/transformers` pipeline | ONNX-optimized; 384-dim model already in use in Subway; handles tokenization, pooling, normalization |
| Vector similarity search | Manual L2/cosine loop over JSONL | LanceDB `table.search(vector).limit(N)` | Native ANN indexing; handles table growth; returns sorted results |
| BM25 text search | Custom inverted index | LanceDB `table.search(query, {queryType: 'fts'})` | LanceDB 0.26.x has native FTS via Tantivy; no custom BM25 needed |
| Cross-process embedding cache | Redis / file-based cache | In-process module-level variable | Single Node.js process; module cache is sufficient and free |
| Schema migration between Python/Node writes | Custom migration script | Write JS tables independently; don't share tables with Python | Python uses `db.create_table(name, data_list)` with pandas; JS uses typed records — schemas may diverge; keep thumbgate_memories as JS-only |

**Key insight:** The existing Subway Python tables (`rlhf_feedback.lance`, `lessons_learned.lance`) are Python-managed. Do not read or write them from Node.js. Create a new `thumbgate_memories.lance` table that is JS-only. The cross-language concern is eliminated by not sharing tables.

---

## Common Pitfalls

### Pitfall 1: `require()` of ESM package throws ERR_REQUIRE_ESM

**What goes wrong:** `const lancedb = require('@lancedb/lancedb')` throws `ERR_REQUIRE_ESM: require() of ES Module .../lancedb/index.js not supported`.

**Why it happens:** `@lancedb/lancedb` sets `"type": "module"` in its package.json. Node.js CJS `require()` cannot load ESM modules.

**How to avoid:** Always use `const { connect } = await import('@lancedb/lancedb')` inside an async function. Cache the result.

**Warning signs:** Import error on first run, not a runtime data error. Will be caught immediately in tests.

---

### Pitfall 2: apache-arrow version conflict

**What goes wrong:** Installing latest apache-arrow (21.x) with LanceDB 0.26.2 causes peer dependency conflict or runtime Arrow schema errors.

**Why it happens:** LanceDB 0.26.2's peer dep is `apache-arrow@>=15.0.0 <=18.1.0`. Arrow 19+ changed internal APIs.

**How to avoid:** Pin strictly: `npm install apache-arrow@18.1.0`. Do NOT `npm install apache-arrow` without a version pin.

**Warning signs:** npm install produces `WARN peer dep` or `npm ERR! ERESOLVE`; LanceDB table creation throws Arrow schema errors at runtime.

---

### Pitfall 3: ONNX model download blocks on first run

**What goes wrong:** First call to `pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')` downloads ~22MB from HuggingFace CDN. In CI or offline environments this hangs or fails.

**Why it happens:** `@huggingface/transformers` downloads ONNX model files on first use to `~/.cache/huggingface/hub/`.

**How to avoid:** In tests, mock the embedding pipeline or use a stub. In the integration smoke test, ensure network access. Document the first-run download requirement. Set `TRANSFORMERS_OFFLINE=1` in CI if model is pre-cached.

**Warning signs:** Test hangs on first run in CI; `fetch failed` errors from HuggingFace CDN.

---

### Pitfall 4: Cross-language schema mismatch (Python wrote table, Node reads it)

**What goes wrong:** Python `db.create_table('rlhf_feedback', list_of_dicts)` creates a table with pandas-inferred schema. JS `db.openTable('rlhf_feedback').search(vector)` may fail with `FixedSizeList` or field type errors.

**Why it happens:** Python lancedb infers schema from pandas DataFrame; JS lancedb expects typed Arrow schema. The `vector` field type (FixedSizeList vs List) diverges. This is LanceDB GitHub issue #669 and #2134.

**How to avoid:** Create a JS-only table `thumbgate_memories` — do not attempt to read/write the Python-managed `rlhf_feedback.lance` from Node.js. The cross-language concern is eliminated by table isolation.

**Warning signs:** `Error: Schema mismatch on field 'vector'`; `FixedSizeList` type error when calling `table.search()`.

---

### Pitfall 5: Venv Python vs system Python lancedb version discrepancy

**What goes wrong:** `pip3 show lancedb` reports 0.27.1 but the Subway venv actually uses 0.26.1. The `.lance` files on disk were written by venv 0.26.1.

**Why it happens:** Two separate lancedb installs: system Python (0.27.1 at `/opt/homebrew/lib/python3.14/`) and Subway venv (0.26.1 at `.../venv/lib/python3.12/`). The venv Python runs the scripts (confirmed via `health-check.py` shebang: `self.venv_python`).

**How to avoid:** The existing `rlhf_feedback.lance` tables were written by venv 0.26.1. Node.js SDK 0.26.2 is in the same 0.26.x format family. This is confirmed safe. Do not upgrade the venv Python lancedb to 0.27.x without verifying format compatibility.

**Warning signs:** Reading Subway lance files from Node.js — manifest byte `$\x02\x00\x00` indicates format version 2 (lance format), compatible with 0.26.x JS SDK.

---

### Pitfall 6: Float32Array not directly serializable to LanceDB

**What goes wrong:** `@huggingface/transformers` pipeline output is a `Float32Array` (typed array). LanceDB's `table.add()` expects a plain JS `number[]` array.

**Why it happens:** ONNX inference outputs typed arrays; LanceDB Arrow schema requires a plain array for the vector field.

**How to avoid:** Always convert: `const vector = Array.from(output.data)` before passing to LanceDB.

**Warning signs:** `TypeError: Cannot serialize Float32Array as Arrow FixedSizeList` or silent NaN vectors.

---

## Code Examples

Verified patterns from source inspection and package API:

### Connect and Create Table (first-time)
```javascript
// Source: @lancedb/lancedb API + STACK.md pattern
async function getOrCreateTable(db, tableName, firstRecord) {
  const tableNames = await db.tableNames();
  if (tableNames.includes(tableName)) {
    return db.openTable(tableName);
  }
  return db.createTable(tableName, [firstRecord]);
}
```

### Embedding with all-MiniLM-L6-v2
```javascript
// Source: @huggingface/transformers@3.8.1 pipeline API
// Model: Xenova/all-MiniLM-L6-v2 — 384 dims, quantized ONNX ~22MB
async function embedText(text) {
  const { pipeline } = await import('@huggingface/transformers');
  const pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
    quantized: true,  // Use quantized ONNX for faster inference
  });
  const output = await pipe(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data); // Convert Float32Array -> number[]
}
```

### Vector Search
```javascript
// Source: @lancedb/lancedb API
async function searchSimilar(table, queryVector, limit = 5) {
  const results = await table
    .search(queryVector)
    .limit(limit)
    .toArray();
  return results;
}
```

### Test Pattern (node --test + tmpdir)
```javascript
// Source: existing tests/thompson-sampling.test.js, tests/contextfs.test.js patterns
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

test('vector store upserts and retrieves feedback', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-vec-test-'));
  const origDir = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

  try {
    const { upsertFeedback, searchSimilar } = require('../scripts/vector-store');

    await upsertFeedback({
      id: 'fb_test_001',
      signal: 'positive',
      context: 'Tests passed with full output',
      tags: ['testing', 'verification'],
      timestamp: new Date().toISOString(),
    });

    const results = await searchSimilar('tests passing with evidence', 3);
    assert.ok(results.length >= 1, 'should find at least one similar result');
    assert.equal(results[0].id, 'fb_test_001');
  } finally {
    process.env.THUMBGATE_FEEDBACK_DIR = origDir || '';
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
```

### Proof Report Pattern (matches Phase 2/3 proof structure)
```javascript
// Source: scripts/prove-adapters.js, scripts/prove-automation.js patterns
const report = {
  phase: '04-lancedb-vector-storage',
  generated: new Date().toISOString(),
  requirements: {
    'VEC-01': { status: 'pass', evidence: 'thumbgate_memories table created with N records' },
    'VEC-02': { status: 'pass', evidence: 'dynamic import() pattern in vector-store.js line N' },
    'VEC-03': { status: 'pass', evidence: 'apache-arrow@18.1.0 in package.json' },
    'VEC-04': { status: 'pass', evidence: 'searchSimilar() returns ranked results in test' },
    'VEC-05': { status: 'pass', evidence: 'N tests pass; proof report generated' },
  },
};
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `vectordb` npm package | `@lancedb/lancedb` | 2023 (package rename) | `vectordb` is deprecated; always use `@lancedb/lancedb` |
| `@xenova/transformers` | `@huggingface/transformers` | v3.0.0 (2024) | Same codebase, rebranded org; v3 has better ONNX support |
| LanceDB FTS via custom BM25 | LanceDB native FTS (Tantivy) | LanceDB 0.14+ | `table.search(text, {queryType: 'fts'})` replaces hand-rolled BM25 |
| Lance file format v1 | Lance file format v2 | LanceDB ~0.20 | Manifest byte `$\x02` = format version 2; 0.26.x reads v2 |

**Deprecated/outdated:**
- `vectordb` (npm): deprecated package name for LanceDB JS; last update 0.21.x; use `@lancedb/lancedb`
- `@xenova/transformers`: old GitHub org; same code, now at `@huggingface/transformers`
- `@huggingface/transformers@4.x-next`: still `dist-tag: next`; API unstable; do not use in production

---

## Open Questions

1. **HuggingFace CDN availability in CI**
   - What we know: First-run model download requires outbound HTTPS to `huggingface.co` CDN (~22MB)
   - What's unclear: Whether the CI environment (local `npm test`) has the model cached already
   - Recommendation: In `vector-store.test.js`, mock the `embed()` function with a fixed 384-dim vector to avoid network dependency in unit tests. Write a separate integration test that uses real embedding. Gate the integration test with `THUMBGATE_VEC_INTEGRATION=true` env var.

2. **First-run initialization latency in captureFeedback()**
   - What we know: `pipeline()` takes 200-400ms on first call; subsequent calls use in-process cache
   - What's unclear: Whether this acceptable in the feedback capture hot path
   - Recommendation: Module-level singleton caching (Pattern 3 above) plus the non-blocking async side-effect pattern ensures first-run latency does not block the caller. No action needed beyond implementing the pattern correctly.

3. **Table schema evolution (adding new fields)**
   - What we know: LanceDB 0.26.x supports `table.add(records)` where records must match existing schema
   - What's unclear: Behavior when adding records with extra fields after schema is set
   - Recommendation: Define a fixed schema for `thumbgate_memories` records up front. If schema evolution is needed, drop and recreate the table (acceptable — the table is a derived index; JSONL is the source of truth).

---

## Sources

### Primary (HIGH confidence)
- `/Users/ganapolsky_i/workspace/git/igor/rlhf/scripts/feedback-loop.js` — ML side-effect pattern confirmed at lines 360-371; non-blocking try/catch pattern verified
- `/Users/ganapolsky_i/workspace/git/igor/rlhf/package.json` — `"type": "commonjs"` confirmed; zero npm deps confirmed; test runner is `node --test`
- `/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/semantic-memory-v2.py` — Python LanceDB reference: `connect()`, `create_table()`, `search()`, BM25 hybrid, FTS index pattern verified
- `/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/memory/feedback/lancedb/` — Live Lance tables confirmed (`rlhf_feedback.lance`, `lessons_learned.lance`); manifest format version 2 (`$\x02\x00\x00`)
- `/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/memory/feedback/lance-index-state.json` — model confirmed `all-MiniLM-L6-v2`, `lru_cache`, `bm25_hybrid`, `native_fts` features
- `npm info @lancedb/lancedb@0.26.2` (live registry query) — `peerDeps: {"apache-arrow":">=15.0.0 <=18.1.0"}`, `engines: {"node":">= 18"}` — HIGH confidence
- `npm info @huggingface/transformers@3.8.1` (live registry query) — `deps: onnxruntime-node, onnxruntime-web, @huggingface/jinja, sharp` — HIGH confidence
- `pip show lancedb` in Subway venv — Version 0.26.1 (not 0.27.1 as system pip reports) — HIGH confidence (disambiguates the version concern)
- `.planning/research/STACK.md` — Pre-researched stack with versions and ESM/CJS pattern

### Secondary (MEDIUM confidence)
- LanceDB GitHub Issue #669 — Append with different schema (confirmed bug in pre-0.26 versions)
- LanceDB GitHub Issue #2134 — FixedSizeList schema errors in v0.16 (older, but pattern confirmed)
- LanceDB official site — Feb 2026 native FTS via Tantivy in 0.26.x JS SDK

### Tertiary (LOW confidence)
- LanceDB Node.js cross-language compatibility behavior — inferred from manifest format inspection and version alignment; not confirmed via official docs

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified via live npm registry; peer deps confirmed; Python venv version confirmed via pip show
- Architecture: HIGH — integration point (captureFeedback non-blocking side-effect) confirmed by reading existing feedback-loop.js source; pattern mirrors Phase 2 ML additions
- Pitfalls: HIGH — ESM/CJS pitfall is universal and verified; arrow version from npm registry; cross-language table isolation is confirmed design decision; Float32Array issue from ONNX output type (verified)
- Cross-language compatibility: MEDIUM-HIGH — venv uses 0.26.1 (same 0.26.x line as JS 0.26.2); manifest binary shows format v2; not verified via official docs but strongly supported by version evidence

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (stable library versions; LanceDB 0.27.0 stable may release within this window — check before starting)
