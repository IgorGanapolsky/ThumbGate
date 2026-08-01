---
"thumbgate": patch
---

Stop the billing summary from reporting a crash as `$0 revenue`.

`node bin/cli.js cfo --today` returns:

```json
"source": "hosted",
"error": "billing_summary_error",
"message": "Cannot create a string longer than 0x1fffffe8 characters",
"revenue": { "total": 0, "mrr": 0, "events": [] }
```

`0x1fffffe8` is V8's maximum string length (~512MB). `loadJsonlRecords` called `fs.readFileSync(path, 'utf-8')` on append-only ledgers that have no rotation; once one passes that cap the read throws, `getBillingSummary` catches it, and the response carries `revenue.total: 0`.

**That zero is the failure default, not a measurement.** It is worse than an outage, because every consumer — the session-start revenue bootstrap, the CFO command, any operator reading the dashboard — renders it as "we have no revenue" rather than "the query failed." Auth was never the issue (`THUMBGATE_OPERATOR_KEY` and `THUMBGATE_API_KEY` both present).

`readJsonlRowsStreaming()` reads in fixed 1MB chunks and parses line by line, so peak string size is one chunk plus one line regardless of ledger size. Lines spanning a chunk boundary are carried forward rather than dropped.

Full-file semantics are preserved deliberately. `readJsonlSinceTail` from `jsonl-window.js` would also bound memory, but it reads a tail window — that trades a loud wrong number for a quiet one by silently dropping older revenue events.

Six tests, including a 500-row ledger read with 64-byte chunks so nearly every row straddles a seam, and an equivalence check against the whole-file read it replaces. `test:billing` 83 pass, `test:funnel-invariants` 17 pass, `test:jsonl-window` 3 pass, all 0 fail.

Not addressed here: the ledgers still have no rotation, so they will keep growing. This makes the read survive that; it does not stop it.
