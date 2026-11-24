# Change: an owner-console action queue, so two agents never repeat the same fix

Status: proposed, 2026-11-20. Owner: admin-truth builder session. Base commit: `6769580e1` on `main`.

Nothing in this spec is built. The console stays read-only (`GET` only, `405` for every other method) until this is
reviewed by a fresh-context reader and the owner agrees to ship it.

## Problem

The owner console reports findings (for example "207 acquisition leads, 0 measured activations") but has no place to
record what was decided about one, who is doing it, whether it was done, or whether it changed the number. Two agents
reading the same console can repeat the same work, and a fix that shipped is never compared to the metric it was meant
to move. Checked on 2026-11-20: `scripts/owner-admin.js` `parseAdminRoute` accepts only read sections, and
`src/api/server.js` returns `405` for any method other than `GET` and `HEAD` on `/v1/admin/*`.

## Goals and non-goals

- Goal: a finding becomes an action record with an owner, a receipt (proof it was done) and a measured result (the
  same metric read again after the change).
- Goal: two agents cannot both take the same action. One claim wins; the other sees who holds it.
- Goal: every write can be retried safely: the same request twice leaves one record.
- Not a goal: running the action. The queue records and coordinates; it never deploys, spends, sends or changes billing.
- Not a goal: a second place for tasks. Linear and GitHub remain the work trackers; a record links to them.
- Must stay true: the existing `GET /v1/admin/<section>` endpoints and `GET /v1/admin/summary` do not change shape.
- Must stay true: no write is reachable without the owner session the console already requires; a signed-out request
  keeps its private 404 and a non-owner keeps its 403.

## Alternatives considered

- Do nothing: agents keep repeating work and fixes are never measured. This is the cost the queue removes.
- Use Linear only: it has owners and states but no link to the metric that proves the change, and no claim that stops two
  agents starting at once. A record here links to the Linear issue instead of replacing it.
- A table in the hosted SQLite database: heavier to migrate and review than an append-only file; the record count is small.
- Let agents write the JSON files directly: no claim check, so two agents can both win.

## Requirements

- REQ-01: A finding creates a record whose id is derived from the finding, so creating it twice leaves one record.
  Check: `node --test tests/owner-actions.test.js` creates the same finding twice and reads back one record.
- REQ-02: A record carries finding, proposed action, owner, claim, receipt and measured result.
  Check: `node --test tests/owner-actions.test.js` asserts every field name in the Design section exists on a freshly created record.
- REQ-03: Two claims on one record: the first wins, the second gets `409` with the holder named. The same holder claiming
  again succeeds without changing the claim time.
  Check: `node --test tests/owner-actions.test.js` runs both claim orders.
- REQ-04: A claim that is not renewed before its lease ends can be taken by another agent.
  Check: `node --test tests/owner-actions.test.js` advances an injected clock past the lease and claims again as another agent.
- REQ-05: A receipt needs evidence (a commit, pull request, run or URL); an empty receipt is refused with `400`.
  Check: the test posts a receipt with no evidence and expects `400`.
- REQ-06: A measured result stores the metric key, the value before, the value after and when it was read, and is refused
  while the metric's source state is `unavailable` or `unresolved` (no result is inferred from a missing number).
  Check: the test posts a result against an `unavailable` field and expects `409`.
- REQ-07: Signed-out gets the private 404, a non-owner gets 403, and a non-`GET` request to any existing read section
  still gets 405.
  Check: `node --test tests/owner-actions.test.js tests/admin-board.test.js` passes.
- REQ-08: Every write is appended to an append-only log and never edits an earlier line, so the history is replayable.
  Check: the test reads the log file after three writes and finds three lines, the first unchanged.

## Design

Record shape (one JSON object per log line, state folded from the lines for one id):

- `id`: first 24 hex characters of the SHA-256 of `findingKey + '|' + actionKind + '|' + windowStart`. The same finding in
  the same window always gets the same id, so retries and duplicate agents converge on one record.
- `finding`: `{ key, summary, metricKeys, evidence }`. `metricKeys` are keys from `GET /v1/admin/summary` (for example
  `money.paying_customers`); `evidence` lists the source and observed time the summary reported.
- `proposedAction`: `{ kind, summary, reversible }`. `reversible: false` actions need the owner's decision before a claim.
- `owner`: the agent or person responsible, or `igor` for a decision only the owner can make.
- `claim`: `{ by, at, leaseUntil }`. A claim is a compare-and-set on the record: it succeeds when there is no claim, the
  claimant already holds it, or the lease has ended. Default lease 30 minutes, renewed by the holder.
- `receipt`: `{ by, at, evidence[] }` (commit SHA, pull request, run id or URL).
- `measuredResult`: `{ metricKey, before, after, measuredAt, sourceState }`, read from the summary at write time, never
  typed in by the caller.
- `status`: `proposed`, `claimed`, `done`, `measured`, `rejected`, folded from the log.

Endpoints, added only after review: `GET /v1/admin/actions` (read, same auth), `POST /v1/admin/actions` (create),
`POST /v1/admin/actions/<id>/claim`, `/receipt` and `/result`. Each write takes an `Idempotency-Key` header; the same key
returns the stored response. Writes append to `actions.jsonl` in the feedback directory with a single-writer lock.

Failure handling: a lost race returns `409` with the holder; a lock timeout returns `503` and writes nothing; a corrupt
last line is skipped on read and reported, never rewritten.

Rollback: delete the routes and the log file; the read endpoints are unaffected.

## Risks

- Stale claims block work: the lease expires, so a crashed agent releases the record on its own.
- The measured result is only as good as the metric: the result is refused while the source is unavailable or unresolved.
- The log grows without bound: records are small and one per action; a size cap with a visible "log full" error is part of
  the build, not silent truncation.
- A write endpoint widens the attack surface of an owner-only page: it reuses the existing owner check, accepts only the
  fields above, and does not read any caller-supplied path.

## Unknowns

- Whether agents will use claims in practice; the first review should check that a claim is cheaper than repeating the work.
- Whether Linear should be the source of the owner field instead of a free-text value.

## Files changed

- `scripts/owner-actions.js` (new)
- `tests/owner-actions.test.js` (new)
- `scripts/owner-admin.js`
- `src/api/server.js`
- `public/admin.html`

## Limits

Owner: the admin-truth builder session. Write scope: the files above only. Up to 3 review rounds, then a verifier against
this spec (up to 2). Test files run one at a time under `nice -n 15`. No endpoint ships before the review passes.

## Evidence

Filled in when the work is done.

| Requirement | Check run | Result | Commit | Where the output is |
|---|---|---|---|---|
| REQ-01 | | | | |
| REQ-02 | | | | |
| REQ-03 | | | | |
| REQ-04 | | | | |
| REQ-05 | | | | |
| REQ-06 | | | | |
| REQ-07 | | | | |
| REQ-08 | | | | |
