---
"thumbgate": patch
---

Add local state backup, and harden the release/incident path

**`scripts/state-backup.js`** — rolling snapshots of `~/.thumbgate`, exposed as
`npm run state:backup`, `state:backup:verify` and `state:restore`.

On 2026-07-26 a ThumbGate home directory went from ~50 files to 4. The lessons database,
feedback log, gate statistics, governance state and audit trail were lost and **not**
recoverable — no `.bak` files existed and Time Machine returned "Operation not permitted".
Nothing alerted; it was found by accident. That corpus is the entire accumulated value of a
self-improving firewall, and losing it silently is worse than a crash, because the product
keeps running and quietly knows nothing.

Snapshots cover the small irreplaceable files only, deliberately skipping `runtime/`
(reinstallable from npm) and `logs/` (bulky, low value). Two behaviours matter as much as the
copying:

- `--verify` exits **non-zero** when there is no snapshot or the newest is stale, so "no
  backup" is a failure rather than silence.
- An **empty snapshot is refused** rather than recorded. A snapshot holding nothing looks like
  protection and provides none — the same absence-read-as-success failure that caused the
  incident it guards against.

Proven end to end against the real incident shape: seed state → snapshot → delete every file →
restore → content round-trips.

Also in this change:

- **`docs/INCIDENT-HOTFIX.md`** — documents `THUMBGATE_HOTFIX_BYPASS=1`, which was previously
  discoverable only by reading `bin/cli.js`. Documented accurately: it is a *scoped* bypass,
  not a kill switch, because `runHardFloor()` still runs first. Also covers the failure mode
  where a missing `~/.thumbgate/bin/thumbgate-hook` makes every PreToolUse hook **fail open**.
- **All 33 workflows SHA-pinned.** Tags are mutable, and 2026 saw repeated npm and GitHub
  Actions supply-chain compromises. Tag retained as a trailing comment so Dependabot can still
  propose updates.
- **`enforcement-drift-watch.yml`** — runs the evasion matrix against the *published tarball*
  every 6h and opens a P0 issue naming the exact `npm dist-tag add` rollback command. Tests
  prove the source is correct; this proves the artifact users receive is correct, which is a
  different claim and was the one that went unverified.
