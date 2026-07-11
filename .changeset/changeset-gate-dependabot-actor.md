---
"thumbgate": patch
---

Fix the Dependabot bypass in the changeset gate keying on `github.actor` (who triggered the run) instead of `github.event.pull_request.user.login` (who authored the PR). Any human or agent that touched a Dependabot PR — a rebase, `gh pr update-branch`, a re-run — became the actor, so the bypass silently stopped applying and the gate demanded a changeset Dependabot will never write. Reproduced on #2766: the re-run reported `actor=IgorGanapolsky`, and `Verify changeset` went SUCCESS → FAILURE without the diff changing. This is the same class of failure the bypass was written for on 2026-05-12 ("6 stale PRs, oldest 16 days, traced to this single gate"), reintroduced by keying on a variable a rebase can change.
