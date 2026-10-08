# Scoped lesson graph

ThumbGate's optional `lesson-graph.sqlite` stores identity and lineage beside the JSONL lesson store. The Reliability Gateway retrieves content only from the authorized, sanitized JSONL corpus. Graph titles cannot supply missing replacement content.

Every graph relation requires the same complete entity, project, process, and session scope. Exact hashes, fuzzy duplicates, correction references, and traversal share this rule. A reused opaque ID with different scope fails instead of replacing its owner. Incomplete legacy scopes remain independent. Explicitly shared memories still follow the retrieval caller's `includeShared` policy; they do not authorize cross-scope edges.

The graph distinguishes `duplicate_of`, `supersedes`, `refines`, and `contradicts` edges. Traversal has a 32-hop limit and detects cycles. Registration is transactional and idempotent. Fully scoped captures in an opted-in store append source records without flat synthesis; the graph resolves duplicates and corrections afterward.

The hybrid guard counts one canonical event across raw and attributed sources. Raw event totals remain available. Compiled artifacts carry graph generation/revision and requested-scope provenance, including the shared-memory policy. An incompatible artifact is ignored before evaluating its block decision. Graph resolution does not bypass the existing entropy suppression or strict conflict policy.

To preview migration, run:

```sh
node scripts/migrate-lesson-graph.js --feedback-dir /path/to/store --dry-run --json
```

To activate or rebuild the overlay, omit `--dry-run`. Existing SQLite state receives a consistent `.bak-<uuid>` backup before the transactional rebuild. JSONL files stay byte-identical. No live store was migrated as part of this recovery.

Validation commands:

```sh
npm run test:lesson-graph
node scripts/perf-budget-check.js
```

The recovered tests cover scope boundaries, missing authorized replacement content, correction chains, duplicate ingest, migration idempotency, stale compiled guards, and real scoped capture. See [verification evidence](../../VERIFICATION_EVIDENCE.md) for the repository-wide evidence contract. These local checks do not establish production deployment.
