# CI GitHub Actions ← Buildkite FORMAT (not a vendor)

Steal Buildkite pipeline architecture onto **existing** ThumbGate GitHub
Actions. Not affiliated. Do not add Buildkite.

## What transfers

| Buildkite | GitHub Actions here |
|-----------|---------------------|
| First failed **step** is the diagnosis unit | `ci-gha-buildkite-patterns --jobs-json` |
| fail-fast + concurrency groups | `concurrency` + `cancel-in-progress` on PRs, never `main` |
| `depends_on` / `wait` | `jobs.*.needs`; `continue-on-error` only on non-required monitors |
| skip / `if` / branch filters | `ci-scope` deps/web/full; `paths:` on E2E |
| Build annotations | `GITHUB_STEP_SUMMARY` via `--annotate` / CI step |
| Control plane vs compute | GitHub schedules; `ubuntu-latest` runs; no Buildkite agents |

## What does not transfer

Pipelines SaaS, hosted/self-hosted Buildkite agents, Test Engine
auto-quarantine, Package Registries, Mobile Delivery Cloud, MCP server, a
second required check, or a CI bill on this **public** repo.

## Commands

```bash
npx thumbgate ci-gha-buildkite-patterns --json --map-only
npx thumbgate ci-gha-buildkite-patterns --json --workflow=.github/workflows/ci.yml
npx thumbgate ci-gha-buildkite-patterns --json --jobs-json=jobs.json --strict
```

## Native wiring

- `.github/workflows/ci.yml` — `Annotate first failed step` on `failure()`
- `.github/workflows/e2e.yml` — shard `fail-fast: false` + `merge-reports` `needs: [e2e]` (`!cancelled()`) so the fan-in annotation still runs
