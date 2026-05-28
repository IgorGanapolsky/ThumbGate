# ThumbGate CI/CD Hygiene - May 2026

## Diagnosis

ThumbGate was hitting two different limits:

- GitHub GraphQL API exhaustion for human/agent PR operations.
- GitHub Actions minute and storage waste from too many workflows doing too much work per change.

The immediate May 28, 2026 rate-limit proof was:

```json
{
  "core": { "limit": 5000, "remaining": 4957 },
  "graphql": { "limit": 5000, "remaining": 0, "used": 10208 }
}
```

This means REST had capacity while GraphQL was exhausted. The fix is not "buy more CI" first. The fix is to stop routine CI from burning scarce user-scoped GraphQL budget and stop docs-only changes from running the full proof lane.

## Policy

Keep GitHub Actions for:

- PR merge gates.
- Main-branch deploy gates.
- Security scanning.
- Manual production diagnostics.

Move or keep outside GitHub Actions:

- Social publishing loops.
- Agent/autonomous loops.
- Repeated revenue polling.
- Browser-heavy diagnostics not required for merge.

Use Railway, local cron, or a dedicated runner for recurring business automation. GitHub's own 2026 Actions pricing guidance makes usage a first-class cost surface, including the Actions control-plane charge for private repos and self-hosted runner usage.

## Required Guardrails

- Prefer `github.token` for repository-scoped CI reads.
- Avoid `secrets.GH_PAT` in routine CI unless the workflow truly needs user-level permissions.
- Prefer REST for concrete branch checks; reserve GraphQL for queries that cannot be expressed safely with REST.
- Add `concurrency` with `cancel-in-progress` on PR checks.
- Add path or internal scope detection so docs-only and web-only changes do not run heavyweight suites.
- Keep artifact retention short. PR failure artifacts should be days, not months.
- Batch status reads. Do not poll `gh pr view` or GraphQL in tight loops.
- Keep required checks minimal. Advisory scanners can run, but should not all be required merge gates.

## Current Patch

This branch implements two high-ROI fixes:

- Branch protection congruence now reads REST first and falls back to GraphQL only if REST branch protection is unavailable.
- CI now has a `docs` mode for `.changeset`, `README.md`, `CLAUDE.md`, `docs/`, `reports/`, and `proof/`-only PRs. It skips dependency install, budget gates, branch-protection API calls, proof suites, and artifact upload.

## Sources

- GitHub Actions limits: https://docs.github.com/en/actions/reference/limits
- GitHub workflow concurrency syntax: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
- GitHub Actions billing: https://docs.github.com/en/billing/concepts/product-billing/github-actions
- GitHub 2026 Actions pricing changes: https://github.com/resources/insights/2026-pricing-changes-for-github-actions
- On the GitHub Actions Language: Usage, Evolution, and Workflow Reliability, 2026: https://arxiv.org/abs/2605.26825
- How Developers Adopt, Use, and Evolve CI/CD Caching, 2026: https://arxiv.org/abs/2604.13129
