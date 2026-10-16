# Hotdata DB × ThumbGate — LanceDB Vector Store Swap POC

> **Branch**: `poc/hotdata-lancedb-swap`  
> **Partners**: Hotdata Inc. ([https://www.hotdata.dev](https://www.hotdata.dev)) × ThumbGate ([https://thumbgate.ai](https://thumbgate.ai))  
> **Authors**: Igor Ganapolsky (Founder & CTO, ThumbGate) & Eddie A. Tejeda (Co-Founder & CTO, Hotdata)

---

## 1. Overview: Swapping Local LanceDB for Hotdata DB

In standard ThumbGate deployments, `scripts/vector-store.js` stores and queries 384-dimensional feedback and lesson embeddings in a local `@lancedb/lancedb` directory (`.thumbgate/lancedb`), which creates local file-lock contention (`EBUSY`) when multiple concurrent coding agents (`Claude Code`, `Cursor`, `Codex`, `LangGraph`, `n8n`) access memory simultaneously.

This POC swaps `@lancedb/lancedb` for **Hotdata DB** (`adapters/hotdata/hotdata-vector-store.js`), giving every agent fleet:
1. **Ultra-High Concurrency Execution (Rust + Apache DataFusion + Apache Arrow)**: Zero local file-lock contention across concurrent agent streams.
2. **Unified HotSQL Vector + Relational Search (`POST /v1/query`)**: Combines HNSW/IVF cosine nearest-neighbor search (`vector_search(...)`) with relational tag/signal filters in a single HotSQL query.
3. **Sub-0.1ms `PreToolUse` Execution Diode**:
   - `gate:hotdata:runaway_query_loop`: Interdicts agents that hallucinate a column name and retry identical failing `hotdata query` calls $\ge 5$ times.
   - `gate:hotdata:destructive_write_boundary`: Allows fast read-only exploration on Hotdata snapshots while hard-blocking unbounded `DROP` / `DELETE` / `TRUNCATE` mutations on downstream production databases.

```mermaid
flowchart LR
    A[Multi-Agent Fleet<br/>Claude Code / Cursor / LangGraph] --> B[scripts/vector-store.js<br/>THUMBGATE_VECTOR_BACKEND=hotdata]
    B --> C[ThumbGate PreToolUse Diode<br/>&lt;0.1ms Loop &amp; Write-Boundary Check]
    C -->|upsertFeedback| D[POST /v1/databases/.../loads<br/>mode: replace / upsert · key: id]
    C -->|searchSimilar| E[POST /v1/query · dialect: hotsql<br/>SELECT ... FROM vector_search&#40;...&#41;]
    D --> F[Hotdata Engine<br/>Rust · DataFusion · Arrow · HNSW]
    E --> F
```

---

## 2. Quick Start (Zero Caller Changes)

```bash
# 1. Configure Hotdata credentials & select the hotdata vector backend
export THUMBGATE_VECTOR_BACKEND=hotdata
export HOTDATA_API_KEY="hd_live_..."
export HOTDATA_WORKSPACE_ID="work..."
export HOTDATA_DATABASE_ID="dbid..."
export HOTDATA_CONNECTION_ID="conn..."

# 2. Run the integration test suite (verifies upsertFeedback, searchSimilar,
#    413 presigned upload fallback, and <0.1ms PreToolUse loop interdiction)
node --test tests/hotdata-vector-store.test.js

# 3. Run the interactive CLI demo
node scripts/demo-hotdata-eddie.js
```

---

## 3. Hotdata v1 API Endpoints Wired in `adapters/hotdata/hotdata-vector-store.js`

| Operation | Hotdata Endpoint | Details |
| :--- | :--- | :--- |
| **Table Publish / Upsert** | `POST /v1/databases/{db_id}/schemas/main/tables/thumbgate_memories/loads` | First load uses `mode: "replace"`; subsequent updates use `mode: "upsert"` with `key: ["id"]` and `idempotency_key`. Automatically branches on `413 INLINE_DATA_TOO_LARGE` to `/v1/uploads` presigned PUT + `/finalize`. |
| **Vector Index Build** | `POST /v1/connections/{conn_id}/tables/main/thumbgate_memories/indexes` | Builds `{ index_name: "thumbgate_memories_vector_idx", index_type: "vector", algorithm: "hnsw", columns: ["vector"], metric: "cosine", vector_precision: "float32" }`. |
| **Nearest-Neighbor Search** | `POST /v1/query` (`X-Database-Id`, `dialect: "hotsql"`) | Executes `SELECT id, text, vector, signal, tags, timestamp, context, _distance FROM vector_search('default.main.thumbgate_memories', 'vector', '[...]', 50) ORDER BY _distance ASC LIMIT <k>`. |

---

## 4. Live Cloud Verification Receipt ([Hotdata Console](https://app.hotdata.dev/databases/work3kgcef3w9om5zsxbmkz77ndwh7/) · [API Reference](https://www.hotdata.dev/docs/api-reference))

> **Note on REST API URLs**: `https://api.hotdata.dev/v1/...` is an authenticated REST API prefix (opening bare `/v1` in a browser without `Authorization: Bearer <token>` and `X-Workspace-Id` headers returns `HTTP 404`). Use the clickable console links below in a browser, or run the authenticated `curl` command to inspect the live database directly.

### Clickable Web Console Links
- **Live Databases Console (`thumbgate-memories`)**: [https://app.hotdata.dev/databases/work3kgcef3w9om5zsxbmkz77ndwh7/](https://app.hotdata.dev/databases/work3kgcef3w9om5zsxbmkz77ndwh7/)
- **Live Observability Dashboard**: [https://app.hotdata.dev/observability/work3kgcef3w9om5zsxbmkz77ndwh7/](https://app.hotdata.dev/observability/work3kgcef3w9om5zsxbmkz77ndwh7/)
- **Hotdata Public API Docs**: [https://www.hotdata.dev/docs/api-reference](https://www.hotdata.dev/docs/api-reference)

### Reproducible CLI / `curl` Verification
```bash
HOTDATA_API_KEY="$(security find-generic-password -a thumbgate -s HOTDATA_API_KEY -w)"
curl -s \
  -H "Authorization: Bearer $HOTDATA_API_KEY" \
  -H "X-Workspace-Id: work3kgcef3w9om5zsxbmkz77ndwh7" \
  https://api.hotdata.dev/v1/databases | jq .
```

Verified end-to-end against live Hotdata Cloud (`2026-10-15T19:42Z`):

| Resource / Operation | Live Receipt ID / Metric |
| :--- | :--- |
| **Workspace ID** | [`work3kgcef3w9om5zsxbmkz77ndwh7`](https://app.hotdata.dev/databases/work3kgcef3w9om5zsxbmkz77ndwh7/) |
| **Database ID (`thumbgate-memories`)** | `dbid4wjx1vw06kr9peb8bqm31g5ydf` |
| **Connection ID** | `connlbq6hvrqmn65wkulu4yq5npw13` |
| **HNSW Vector Index** | `thumbgate_memories_vector_idx` (`status: "ready"`, `metric: "cosine"`, `vector_precision: "float32"`, `algorithm: "hnsw"`) |
| **Live SQL Query Run ID** | `qrunwwg1njv8sb3n749vhhjnn8irej` (`result_id: rslt1n0pjaagq5sojzfpt34sgf0ggs`, `execution_time_ms: 339`) |
| **Live `vector_search` Query Run ID** | `qrunix49fvkmnql25mnoplvp5v5fql` (`result_id: rslt5gdb55p23edmizr0u6dg5ljt31`) |
| **384-dim `Xenova/all-MiniLM-L6-v2` Cosine Ranking** | Top match `fb_e2e_live_1` (`_distance: 0.216993`) vs `fb_e2e_live_2` (`_distance: 0.939921`) |
| **ThumbGate `PreToolUse` Gate Overhead** | `0.08ms` on local CPU (`gate:hotdata:runaway_query_loop` & `gate:hotdata:destructive_write_boundary`) |

### Production Adapter Hardening Notes
1. **Arrow Timestamp Precision Normalization (`timestamp_s` vs `timestamp_ms`)**: Hotdata's Arrow schema inference returns `409 Conflict` if an initial load uses second-precision ISO strings (`YYYY-MM-DDTHH:MM:SSZ` $\rightarrow$ `timestamp_s`) and a subsequent load uses millisecond ISO strings (`YYYY-MM-DDTHH:MM:SS.sssZ` $\rightarrow$ `timestamp_ms`). `serializeRecordsToCsv()` normalizes all ISO timestamps to second precision (`.replace(/\.\d+Z$/, 'Z')`).
2. **Content-Addressed `idempotency_key`**: Re-using a record-ID-only `idempotency_key` when upserting modified text/vectors returns `409 IDEMPOTENCY_KEY_CONFLICT`. `HotdataTable.add()` computes `tg_${sha256(mode + '::' + csvData).slice(0, 32)}` so exact retries are idempotent while updated rows never collide.
3. **Presigned `/v1/uploads` Load Payload**: When loading via `upload_id` after `POST /v1/uploads/{id}/finalize`, `idempotency_key` is omitted (`upload_id` is natively idempotent per Hotdata API spec).
