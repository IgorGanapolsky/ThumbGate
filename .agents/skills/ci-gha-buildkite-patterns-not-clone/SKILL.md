---
name: ci-gha-buildkite-patterns-not-clone
description: >
  Buildkite pipeline architecture is FORMAT, not a ThumbGate CI vendor.
  Steal first-fail step identity, PR fail-fast, needs:/wait honesty, skip
  conditions, and GITHUB_STEP_SUMMARY annotations onto existing GitHub
  Actions. Never add Buildkite Pipelines, agents, Test Engine, or a second
  required check. Slash: /ci-gha-buildkite-patterns-not-clone.
---

# CI GHA Buildkite patterns — compare, do not clone

## Goal

Fail-closed GitHub Actions diagnosis for whom: ThumbGate public CI — so a
red PR names the **first failed step**, cancels leftover PR runs, and never
grows a Buildkite bill.

## Constraints

| NEVER | ALWAYS |
| --- | --- |
| Migrate this public repo to Buildkite | Keep the required GHA contexts on `ubuntu-latest` |
| Dump `--log-failed` first | `npx thumbgate ci-gha-buildkite-patterns --jobs-json=…` |
| `gh run rerun` a queued job | Wait for Actions to drain |
| Test Engine auto-quarantine | First fail is a regression until proven otherwise |
| `cancel-in-progress: true` on `main` | Cancel PR reruns only |

HARD fail closed. REFUSE SKU clones. This is **not a Buildkite clone**.
Never migrate this public repo to Buildkite.

## Reference

- https://buildkite.com/docs/pipelines/best-practices/pipeline-design-and-structure
- https://buildkite.com/docs/pipelines/configure/annotations
- `scripts/ci-gha-buildkite-patterns.js`
- Complements `/ci-first-fail` (same FORMAT, global copy)

## Examples (show, don't tell)

Weak: "Buildkite is faster, add it as a required check."

Gold:

```bash
$ npx thumbgate ci-gha-buildkite-patterns --json --map-only
ok: true
$ npx thumbgate ci-gha-buildkite-patterns --json --migrate
ok: false  # migrate_vendor
```

## Procedures

```bash
npx thumbgate ci-gha-buildkite-patterns --json --map-only
npx thumbgate ci-gha-buildkite-patterns --json --workflow=.github/workflows/ci.yml
npx thumbgate ci-gha-buildkite-patterns --json --jobs-json=jobs.json
npm run test:ci-gha-buildkite-patterns
```

1. Name `first_fail.step` before opening logs.
2. Absent required contexts → githubstatus.com, not a code blame.
3. E2E shards stay `fail-fast: false` so merge-reports can still annotate (Buildkite `wait` + `continue_on_failure`).
4. Do not vendor `buildkite-agent`.

## Rubric

- `--map-only` → `ok=true`
- `--clone-buildkite` / `--migrate` / `--quarantine` / `--rerun-queued` → fail
- live `ci.yml` concurrency excludes `main`
- doctor tests PASS
- evidence: `--json` in the same turn
