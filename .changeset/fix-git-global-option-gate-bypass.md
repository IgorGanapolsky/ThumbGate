---
"thumbgate": patch
---

Close a gate bypass via git global options

Git accepts global options between `git` and the subcommand — `git -C <dir> push`,
`git -c k=v clean`, `git --git-dir=<p> reset`. Every command-pattern gate is written against
the plain `git <subcommand>` form, so inserting a single option walked straight past them.

Verified against unmodified `main`, all three denied normally and **none** matched any gate
in the global-option form:

| command | before | after |
|---|---|---|
| `git -C <dir> push --force origin main` | no gate matched | deny |
| `git -C <dir> reset --hard HEAD~5` | no gate matched | deny |
| `git -c core.pager=cat clean -fd` | no gate matched | deny |

These are three of the four `CATASTROPHIC_DECLARATIVE_GATE_IDS` — the set documented in the
engine as effectively irreversible and explicitly exempted from the free-tier daily-cap
discount "regardless of tier or strict-mode setting". A one-token insertion defeated all of
them.

The same gap made `extractAffectedFiles()` return an empty list for those forms, which
silently disarmed `task-scope-required` and `protected-file-approval-required` as well — a
gate that evaluates no files raises no violation.

`canonicalizeGitCommand()` now strips the global-option prefix, and gate patterns are tested
against the original text **and** the canonical form. Because both are tried, this can only
ever add a match, never remove one. Subcommand options are untouched: `git add -p` still
means `--patch`, not the global `--paginate`.
