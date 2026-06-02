---
"thumbgate": patch
---

Add **functioning** Team/Enterprise Postgres + pgvector storage. Ships tenant-scoped schema generation (pgvector/HNSW cosine index, row-level-security policies), guarded `setup-postgres` / `migrate-to-postgres` CLI commands, local JSONL import SQL, and a storage adapter selected by `THUMBGATE_STORAGE=postgres` / `DATABASE_URL`.

Critically, the storage adapter is now **wired into the live capture path** (`feedback-loop.js`): when a central store is configured, every captured lesson is also persisted to Postgres + pgvector (shared org-wide, server-side vector search) — additively and non-fatally, so the local/free tier (SQLite + LanceDB) is unchanged. The adapter loads independently of the separate `brain` feature via `loadOptionalModule`. `postgres-db.js`, `storage-adapter.js`, `enterprise-postgres.js`, `migrate-to-postgres.js`, and `postgres-guard.js` ship in the bundle; `pg` is added as a dependency. Also fixes `postgres-guard` to stop flagging safe `INSERT … ON CONFLICT … DO UPDATE` upserts as unbounded updates.
