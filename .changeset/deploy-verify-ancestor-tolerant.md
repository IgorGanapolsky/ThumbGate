---
"thumbgate": patch
---

Stop the release-identity guard from reporting normal progress as deploy drift.

The guard required the published npm version's gitHead to equal the commit
under verification. Between releases that is never true: main is simply ahead
of the last published version, so every content-only merge turned the check red
until someone cut a release. It now passes when the published release commit is
an ancestor of HEAD, and still fails when the published version came from a
commit that is not in this history. Ancestry is resolved with local git, so the
guard needs no network and no credentials; an ancestry it cannot prove is
treated as drift, so the check fails closed on a shallow clone.
