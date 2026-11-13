# Tech debt audit, 2026-11-13

Subtraction and tests only (sales sprint: no new features). Branch `chore/tech-debt-audit-20261113`, worktree
`~/workspace/.thumbgate-worktrees/tech-debt-audit`, base `origin/main` = `d04d08557`. Review report:
`docs/designs/tech-debt-audit-20261113-review.md`.

Why now: Igor's directive 2026-11-13. Payoff is small and measured honestly: the real metric is the orphan count in
`tests/capability-wiring-ratchet.test.js` (`MAX_ORPHANS = 42`) plus lines removed. Time-box: batches A and B first;
C, D, F only after; E only after `hygiene-done`. Outreach work is not displaced (this is a side lane).

## 0. Step zero (every session)

`git rev-parse HEAD` equals `d04d08557` (or the new main tip, recorded), `git status --porcelain` empty, run the fleet
check from AGENTS.md (`bash .claude/scripts/session-bootstrap/fleet-coordination-check.sh`) and claim the lease before the
first branch or PR. Run `npm test` three times on the base and record failures; a PR gate is "no new failures against that
baseline", not an absolute green.

## 1. Baseline (origin/main d04d08557)

| Metric | Value | Source |
|---|---|---|
| Tracked files | 2,788 | `git ls-files \| wc -l` |
| Tracked lines (all tracked, incl. any binary) | 693,150 | `git ls-files -z \| xargs -0 cat \| wc -l` |
| JS / MD / JSON / HTML / PY lines | 503,745 / 45,916 / 28,369 / 52,293 / 2,877 | `git ls-files "*.ext"` per extension |
| npm bundle files | 646 (2.7 MB); ratchet ceilings 655 in `tests/public-bundle-ratchet.test.js` and `tests/public-core-boundary.test.js:336` | `npm pack --dry-run` |
| Orphan ceiling | `MAX_ORPHANS = 42` | `tests/capability-wiring-ratchet.test.js:38` |
| `bin/agent-loop --health --json` | HEALTHY, requiredFailed [] | run 2026-11-13 |
| Lesson DB (shared checkout) | rawTotal 137, excludedTotal 0 | `npm run feedback:stats` |
| Coverage % | NOT MEASURED yet (run `npm run test:coverage > scratch file`; the first attempt was lost to a bad redirect) | to be filled before PR 1 |
| CI on main tip | not terminal at snapshot (CodeQL running); re-query before any report | `gh run list --branch main` |

## 2. Candidate method

Source of truth is the repo's own `findOrphans()` in `tests/capability-wiring-ratchet.test.js` (all of `scripts/`, tracked
text corpus outside `tests/`, `package.json` `files` not counted as a caller). My grep scan over `scripts/`, `src/`, `bin/`
(781 files) gave 72 files whose basename appears nowhere else; a stem re-check left 7 with zero references and about 65
with loose hits (package.json entry, one catch-all test, CHANGELOG line). Reconcile my list to `findOrphans()` output
before the first PR. Note: this plan names candidate files in a tracked `.md`, which counts as a reference in that ratchet's
corpus; each deletion PR therefore strikes the file name from this plan in the same commit.

## 3. Batches (at most 40 files and 1,000 changed lines excluding lockfiles per PR; draft PR first)

**A. Delete (4 files, 380 lines).** Evidence run 2026-11-13: no references in workflows, hooks, adapters, docs, tests,
`package.json`; no readdir or glob loader in `scripts/content-engine`, `scripts/gates`, `scripts/social-analytics`
(`git grep -nE "readdirSync|globSync|glob\(" -- <those dirs>`); the state files two of them write are read by nothing.

| Verb | File | Lines | Why |
|---|---|---|---|
| Delete | `scripts/content-engine/reddit-thread-finder.js` | 154 | self-references only; the npm scripts its comment names do not exist |
| Delete | `scripts/social-analytics/generate-applyops-instagram-card.js` | 73 | no ApplyOps workflow remains in `.github/workflows` |
| Delete | `scripts/social-analytics/publish-applyops-instagram.js` | 75 | same |
| Delete | `scripts/social-analytics/post-ledger.js` | 79 | writes `.thumbgate/post-ledger.json`, nothing reads it |

Kept, on purpose, with the reason (decision for Igor, not for this audit): `scripts/gates/cloud-egress-confirm.js` and
`scripts/post-action-verification-window.js` are complete, unwired features that look security-relevant (wire or delete is
a product decision); `scripts/publish-bluesky-direct.js` was edited 2026-11-12 (stays until its author says otherwise).
Gate: `npm test` no new failures, `npm run prove:adapters`, plus `tests/capability-wiring-ratchet`,
`public-repo-hygiene`, `no-internal-orchestration-leaks`, `no-real-estate-outbound`. Lower `MAX_ORPHANS` by the number of
removed orphans. None of the 4 is in `package.json` `files`, so bundle ceilings do not change.

**B. Ten scripts used only by one test.** Precondition: an evidence table (file, runtime importers outside `tests/`,
the test blocks that use it, decision) saved in this folder. The 10 are `agents-sdk-sandbox-plan`,
`ai-org-governance`, `artifact-agent-plan`, `data-table-agent`, `enterprise-agent-rollout`,
`experience-replay-governance`, `inference-economics`, `memory-store-governance`, `scaling-law-claims`,
`student-consistent-training` (all under `scripts/`). Mechanics: Modify `tests/high-roi-agent-workflows.test.js` (remove their
10 `require` lines and the test blocks that use them; the file keeps ~24 live modules and runs via `npm run test:high-roi`
inside `npm test`), then Delete the 10 scripts. Record test count before and after and run `npm run test:high-roi` both
times. Check README/site claims that name these features first; if a doc or page advertises one, that one stays. Lower
`MAX_ORPHANS` accordingly.

**C. Docs.** Run `/egm:egm-drift-report docs/` (plugin command). Delete or merge with one justification line each, only
after a pin check across `tests/`, `package.json` `files`, `.well-known/`, sitemap, `llms.txt`, `public/`. Never touch
CLAUDE.md, AGENTS.md, GEMINI.md, SKILL.md, `docs/VERIFICATION_EVIDENCE.md`, `MOAT.md`, `docs/agents/*`.

**D. Config and deps.** `npm audit --omit=dev --json`; patch-level fixes for security advisories only; a fix that needs a
minor or major bump is recorded and skipped. Env vars: `git grep -ohE "process\.env\.[A-Z0-9_]+"` set difference against
`.env.example`; removals only (no additions). Unused config files need the same pin check as C. The primary checkout has
local `package-lock.json` edits; this worktree starts from main so no lockfile conflict arises here.

**E. Lesson DB (report, not a PR; the data is git-ignored).** Runs only if `hygiene-done` appears in
`~/workspace/ThumbGate/.herdr-report.md`; otherwise skipped and reported as skipped. Steps: (1) find the repo's own dedupe
and prune scripts by `git grep` in `package.json` scripts (`feedback:*`); name the one used; (2) take the single-writer
lease (`npm run session:lease:check`); (3) back up `.claude/memory/feedback/` to a dated tarball outside the repo and prove
it restores into a temp dir; (4) run the script in dry-run first and save the output; (5) accept only if removed IDs are
listed, all are fixtures, transcripts or exact duplicates, and rawTotal before/after is recorded (baseline 137). Never
commit anything under `.claude/memory/` or `.thumbgate/`.

**F. Tests.** Run `npm test` three times (already done at step 0), list flakes, and fix or report each (no quarantine
without a note). Add tests only for modules the coverage report shows uncovered among: lesson DB read/write, API error
handling, recovery paths; at most 10 new test files. Tests use a temp directory via the existing feedback-dir env
override, never the live store; Pro-gated features inject the gate predicate (see CLAUDE.md Audit Lessons); feature-detect
coverage flags.

## 4. Per-PR procedure

Open as draft, mark ready only after `npm test` passes locally and the gate above passes, add `.changeset/<slug>.md` only if
a release-relevant path changed (deleting unbundled scripts does not), `npm run pr:manage` and `/trunk merge`, never approve
or bypass. No `package.json` version edits. Show `gh pr view` output before saying done.

## 5. After each merge (pass/fail)

1. `npm run feedback:summary` exits 0 and prints counts (run in a clean checkout of main, not in the primary checkout).
2. `echo '{"tool_name":"Bash","tool_input":{"command":"echo hi"}}' | node scripts/hook-pre-tool-use.js` exits 0 without a
   crash; compare output to the same command on the base commit.
3. `gh run list --branch main` shows the merge commit's required checks terminal success.
4. After `sleep 180`, `/health` version and `/dashboard` curl outputs shown (CLAUDE.md gate).
Any failure: revert that PR through a normal PR and record why. The revert needs its own CI and the same review path.

## 6. Alternatives rejected

Bulk deletion of every scan hit (loose matches hide intentionally dormant modules). knip (the repo's own ratchet is the
method). Editing the shared checkout (another agent is cleaning it).

## 7. Files this change touches

Now: this plan and its review report. Later: per batch tables above (verbs: Delete or Modify as listed).
