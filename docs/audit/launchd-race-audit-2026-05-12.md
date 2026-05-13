# launchd Race Audit — 2026-05-12

Read-only audit of ThumbGate's launchd-based background-process scripts. Captured from a code-analyzer agent pass. No code changes proposed here — this is the finding doc only.

## Scope

- `scripts/bluesky-monitor-launchd.js`
- `scripts/reddit-monitor-launchd.js`
- `scripts/monitor-launchd-common.js`
- Supporting: `scripts/bluesky-monitor-cron.sh`, `scripts/reddit-monitor-cron.sh`

## Critical framing correction

These three `*-launchd.js` files are **installers and status reporters**, NOT the long-running daemons. The actual periodic work is spawned by launchd via `StartInterval` (e.g. 900s), invoking short-lived `*-cron.sh` shell scripts that run a single Node iteration and exit.

This eliminates most "long-poll loop" failure modes from this audit's scope:
- No SIGTERM-handler-on-poll-loop bug (there is no poll loop here)
- No unbounded in-memory growth across iterations (each tick is a fresh process)
- No monotonic-clock dedup bug (state-decisions live in `social-reply-monitor*.js`, out of scope)
- No long-running `fetch()` timeout bug (no network I/O in these three files)

Real race surface shifts to: (a) the install/bootstrap path, and (b) state files co-written across overlapping launchd-triggered child runs.

---

## Finding 1 — bootout → bootstrap window is non-atomic (MEDIUM)

**Files / lines:**
- `monitor-launchd-common.js:78-97` (`loadLaunchAgent`)
- `bluesky-monitor-launchd.js:229-248` (duplicated copy)
- `reddit-monitor-launchd.js:79-98` (duplicated copy)

**Pattern:** Sequence is `bootout` (ignore failure) → `bootstrap` → `enable`. Between writing the new plist (`fs.writeFileSync(plistPath, plist, 'utf8')` at `monitor-launchd-common.js:104`) and the subsequent `bootstrap`, two install invocations launched concurrently (e.g. CEO runs install in one terminal while a CI smoke test re-installs) can interleave:

- Process A writes plist v1, bootouts, bootstraps v1
- Process B writes plist v2 *between* A's bootout and A's bootstrap — A then bootstraps the v2 file it didn't author
- Or: B bootouts the agent A just bootstrapped, leaving the agent unloaded with no error surfaced

**Concrete failure mode:** Silent "install succeeded" exit while the LaunchAgent is actually unloaded, or the on-disk plist differs from the one in use after `launchctl print`. CEO sees `installed: true` from `status` (which only checks `fs.existsSync(plistPath)`) but the agent isn't actually running.

**Suggested fix:** Wrap install with an exclusive lockfile (`fs.openSync(lockPath, 'wx')` at the start, `fs.unlinkSync` in a `finally`) keyed off the `label`. Alternative: write plist to a sibling temp path and `fs.renameSync` into place (atomic on the same volume) before the bootstrap pair runs serially under the lock.

**Severity:** Medium — only triggers under concurrent install (rare but real during agent-architect-kit re-install flows + CI smoke tests). Failure mode is silent.

---

## Finding 2 — TOCTOU between `existsSync` and `readFileSync` (LOW — tidiness only)

**Files / lines:** `bluesky-monitor-launchd.js:107-125` (`parseInstalledPlist`), plus `readJsonFile` (148-155), `countJsonlRows` (127-146), `readLastNonEmptyLine` (157-168).

**Pattern:** Classic `fs.existsSync(path)` → `fs.readFileSync(path, 'utf8')`. If the file is removed between calls, `readFileSync` throws.

**Concrete failure mode:** Already caught — each function wraps in `try/catch` and returns `null`/`0`. Downstream callers handle the null. So the TOCTOU is real but its impact is graceful degradation, not data corruption.

**Suggested fix:** Drop the pre-check; just `try { readFileSync } catch { return null }`. Removes a redundant syscall and the (harmless) race window.

**Severity:** Low — current behavior is correct; this is cleanup, not a bug fix.

---

## Verified clean (false alarms from the standard checklist)

These were on the worry-list but don't apply to this audit scope. Recording so the next auditor doesn't re-flag.

1. **Missing SIGTERM handlers on long poll loops** — N/A. launchd uses `StartInterval` to fork a fresh short-lived process per tick.
2. **Unbounded in-memory growth** — N/A. Each tick is a new process. `countJsonlRows` does materialize the full JSONL array in memory per status call, but that's ephemeral and bounded by file size. Probably fine until the JSONL crosses ~100k rows — at that point, swap to a streaming counter.
3. **`fetch()` / `https.request()` without timeout** — N/A. No network I/O in these three files. Network calls live in the downstream `social-reply-monitor*` scripts (out of scope).
4. **Dedup that depends on `Date.now()` / clock skew** — N/A in these files. They read state JSON for display; they don't make decisions on `lastCheck` timestamps. The dedup logic that uses timestamps lives in `social-reply-monitor*.js` (out of scope).
5. **State files in gitignored paths breaking cross-machine continuity** — Confirmed but intentional. State is written under `${repoDir}/.thumbgate/`, which CLAUDE.md explicitly lists as "Files You Must Not Commit." launchd is a per-machine scheduler — per-machine state is the correct scope. NOT the same class of bug as the daily-revenue-loop / weekly-social-post workflow bugs (those run on different runners and need shared state).

---

## Informational (not bugs, worth a follow-up issue)

- **Helper duplication.** `escapePlistString`, `runLaunchctl`, `loadLaunchAgent`, `parseArgs`, `plistPathForLabel` exist in all three files. `monitor-launchd-common.js` was clearly created to centralize them, but neither launchd file actually `require()`s from it. Drift risk is real (the bluesky version has slightly different helpers; the reddit version is older). Follow-up: `require('./monitor-launchd-common')` in both consumers.

- **`process.getuid` branch is dead code on macOS.** `loadLaunchAgent` has a branch for the `process.getuid` undefined case (line 79-89). On macOS — the only target since these write to `~/Library/LaunchAgents` — `process.getuid` is always defined. Harmless dead code; safe to keep as a non-Unix guard.

- **`RunAtLoad=true` + `StartInterval` interaction.** launchd will trigger an immediate run on bootstrap AND every interval. If the cron script takes longer than `StartInterval`, launchd won't stack runs — it skips the next tick. So no concurrent-monitor-from-launchd-itself race. Concurrent runs only happen if the user manually invokes the monitor while the agent ticks. That risk is real but is a property of `social-reply-monitor*.js`, not these files.

---

## Recommendation

- File Finding 1 as a real issue. Apply the lockfile fix when bandwidth allows. Currently low-frequency trigger, so not urgent.
- Defer Finding 2 (cleanup only).
- Spin up the helper-deduplication refactor as a separate small PR.
